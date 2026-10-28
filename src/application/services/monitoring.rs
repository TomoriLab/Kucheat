use anyhow::Result;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Notify, RwLock, watch};
use tokio::time::{self, MissedTickBehavior};

use crate::application::ports::{
    ChannelGateway, ChannelGatewayFactory, ConfigurationRepository, NotificationSender,
    StateRepository,
};
use crate::domain::channel::LiveStatus;
use crate::domain::config::Config;
use crate::domain::monitoring::MonitorStatus;
use crate::domain::state::{AppState, ChannelState};

pub struct MonitoringService {
    configuration: Arc<dyn ConfigurationRepository>,
    states: Arc<dyn StateRepository>,
    gateways: Arc<dyn ChannelGatewayFactory>,
    notifications: Arc<dyn NotificationSender>,
}

impl MonitoringService {
    pub fn new(
        configuration: Arc<dyn ConfigurationRepository>,
        states: Arc<dyn StateRepository>,
        gateways: Arc<dyn ChannelGatewayFactory>,
        notifications: Arc<dyn NotificationSender>,
    ) -> Self {
        Self {
            configuration,
            states,
            gateways,
            notifications,
        }
    }

    pub async fn run(
        &self,
        mut config: Config,
        refresh: Arc<Notify>,
        status: Arc<RwLock<MonitorStatus>>,
        sender: Option<watch::Sender<AppState>>,
    ) -> Result<()> {
        let mut gateway = self.gateways.create(&config.api)?;
        let mut state = self.states.load().unwrap_or_default();
        let mut ticker = time::interval(Duration::from_secs(config.settings.check_interval_secs));
        ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
        let mut configuration_poll = time::interval(Duration::from_secs(2));
        configuration_poll.set_missed_tick_behavior(MissedTickBehavior::Skip);
        configuration_poll.tick().await;
        loop {
            tokio::select! {
                _ = ticker.tick() => {}
                _ = refresh.notified() => {}
                _ = configuration_poll.tick() => {
                    match self.configuration.load() {
                        Ok(current) if current == config => continue,
                        Ok(_) => {}
                        Err(error) => {
                            status.write().await.last_error = Some(format!("{error:#}"));
                            continue;
                        }
                    }
                }
            }
            let current = match self.configuration.load() {
                Ok(current) => current,
                Err(error) => {
                    status.write().await.last_error = Some(format!("{error:#}"));
                    continue;
                }
            };
            if current.api != config.api {
                gateway = self.gateways.create(&current.api)?;
            }
            if current.settings.check_interval_secs != config.settings.check_interval_secs {
                ticker = time::interval(Duration::from_secs(current.settings.check_interval_secs));
                ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
            }
            ticker.reset();
            config = current;
            {
                let mut current_status = status.write().await;
                current_status.checking = true;
                current_status.last_error = None;
            }
            let errors = self
                .check_cycle(&config, gateway.as_ref(), &mut state, sender.as_ref())
                .await;
            let mut current_status = status.write().await;
            current_status.checking = false;
            current_status.last_checked = Some(chrono::Utc::now().to_rfc3339());
            if !errors.is_empty() {
                let message = errors.join("\n");
                tracing::warn!("Channel check failed: {message}");
                current_status.last_error = Some(message);
            }
        }
    }

    pub async fn check_cycle(
        &self,
        config: &Config,
        gateway: &dyn ChannelGateway,
        state: &mut AppState,
        sender: Option<&watch::Sender<AppState>>,
    ) -> Vec<String> {
        state.channels.retain(|identifier, _| {
            config
                .channels
                .iter()
                .any(|channel| channel.id == *identifier)
        });
        let mut errors = Vec::new();
        for channel in &config.channels {
            match gateway.live_status(&channel.id).await {
                Ok(live) => {
                    let was_live = match record_channel_state(state, &channel.id, &live, |value| {
                        self.states.save(value)
                    }) {
                        Ok(was_live) => was_live,
                        Err(error) => {
                            errors.push(format!("{}: {error:#}", channel.name));
                            time::sleep(Duration::from_millis(500)).await;
                            continue;
                        }
                    };
                    let notification = if live.is_live && !was_live {
                        self.notifications.live(&channel.id, &live).await
                    } else if !live.is_live && was_live && config.settings.notify_offline {
                        self.notifications.offline(&live.channel_name).await
                    } else {
                        Ok(())
                    };
                    if let Err(error) = notification {
                        errors.push(format!("{}: {error:#}", channel.name));
                    }
                    if let Some(sender) = sender {
                        let _ = sender.send(state.clone());
                    }
                }
                Err(error) => errors.push(format!("{}: {error:#}", channel.name)),
            }
            time::sleep(Duration::from_millis(500)).await;
        }
        // Configuration may change while slow requests are in progress.
        if let Ok(current) = self.configuration.load() {
            state.channels.retain(|identifier, _| {
                current
                    .channels
                    .iter()
                    .any(|channel| channel.id == *identifier)
            });
        }
        if let Err(error) = self.states.save(state) {
            errors.push(format!("{error:#}"));
        }
        errors
    }
}

/// Saving transitions before notification delivery prevents replay during process handoff.
fn record_channel_state(
    state: &mut AppState,
    identifier: &str,
    live: &LiveStatus,
    persist: impl FnOnce(&AppState) -> Result<()>,
) -> Result<bool> {
    let previous = state.channels.get(identifier).cloned();
    let was_live = previous.as_ref().is_some_and(|value| value.is_live);
    state.channels.insert(
        identifier.to_owned(),
        ChannelState::from_live_status(live, previous.as_ref()),
    );
    if let Err(error) = persist(state) {
        if let Some(previous) = previous {
            state.channels.insert(identifier.to_owned(), previous);
        } else {
            state.channels.remove(identifier);
        }
        return Err(error);
    }
    Ok(was_live)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn live_status() -> LiveStatus {
        LiveStatus {
            is_live: true,
            channel_name: "Channel".to_owned(),
            channel_image_url: None,
            live_title: None,
            category: None,
            viewer_count: None,
        }
    }

    #[test]
    fn persisted_transition_is_not_replayed_after_handoff() {
        let mut state = AppState::default();
        let mut persisted = AppState::default();
        assert!(
            !record_channel_state(&mut state, "channel", &live_status(), |value| {
                persisted = value.clone();
                Ok(())
            })
            .unwrap()
        );
        assert!(persisted.channels["channel"].is_live);
        assert!(
            record_channel_state(&mut persisted, "channel", &live_status(), |_| Ok(())).unwrap()
        );
    }

    #[test]
    fn failed_persistence_preserves_the_previous_transition() {
        let mut state = AppState::default();
        assert!(
            record_channel_state(&mut state, "channel", &live_status(), |_| anyhow::bail!(
                "Disk unavailable"
            ))
            .is_err()
        );
        assert!(state.channels.is_empty());
        assert!(!record_channel_state(&mut state, "channel", &live_status(), |_| Ok(())).unwrap());
    }
}
