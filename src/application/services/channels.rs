use anyhow::{Result, ensure};
use std::sync::Arc;

use crate::application::dto::ChannelView;
use crate::application::ports::{
    BrowserLauncher, ChannelGatewayFactory, ConfigurationRepository, MonitorControl,
    StateRepository,
};
use crate::domain::channel::ChannelId;
use crate::domain::config::ChannelConfig;
use crate::domain::state::ChannelState;

#[derive(Clone, Copy, PartialEq, Eq)]
enum RegistrationMode {
    Create,
    Upsert,
}

pub struct ChannelService {
    configuration: Arc<dyn ConfigurationRepository>,
    states: Arc<dyn StateRepository>,
    gateways: Arc<dyn ChannelGatewayFactory>,
    browser: Arc<dyn BrowserLauncher>,
    monitor: Arc<dyn MonitorControl>,
}

impl ChannelService {
    pub fn new(
        configuration: Arc<dyn ConfigurationRepository>,
        states: Arc<dyn StateRepository>,
        gateways: Arc<dyn ChannelGatewayFactory>,
        browser: Arc<dyn BrowserLauncher>,
        monitor: Arc<dyn MonitorControl>,
    ) -> Self {
        Self {
            configuration,
            states,
            gateways,
            browser,
            monitor,
        }
    }

    pub async fn add(&self, input: &str, name: Option<String>) -> Result<ChannelConfig> {
        let name = name
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        ensure!(
            name.as_ref()
                .is_none_or(|value| value.chars().count() <= 100),
            "Channel name exceeds 100 characters"
        );
        let channel = self.register(input, name, RegistrationMode::Create).await?;
        let _ = self.monitor.refresh().await;
        Ok(channel)
    }

    /// CLI registration preserves its existing replace-in-place behavior.
    pub async fn upsert(&self, input: &str, name: Option<String>) -> Result<ChannelConfig> {
        self.register(input, name, RegistrationMode::Upsert).await
    }

    async fn register(
        &self,
        input: &str,
        name: Option<String>,
        mode: RegistrationMode,
    ) -> Result<ChannelConfig> {
        let identifier = ChannelId::parse(input)?;
        let config = self.configuration.load()?;
        if mode == RegistrationMode::Create {
            ensure!(
                !config
                    .channels
                    .iter()
                    .any(|channel| channel.id == identifier.as_str()),
                "Channel is already registered"
            );
        }
        let gateway = self.gateways.create(&config.api)?;
        let information = gateway.channel_info(identifier.as_str()).await?;
        let channel = ChannelConfig {
            id: identifier.into_string(),
            name: name.unwrap_or(information.channel_name),
        };
        self.configuration.update(&mut |config| {
            if mode == RegistrationMode::Create {
                ensure!(
                    !config.channels.iter().any(|value| value.id == channel.id),
                    "Channel is already registered"
                );
            }
            config.add_channel(&channel.id, &channel.name);
            Ok(())
        })?;
        Ok(channel)
    }

    pub fn remove(&self, identifier: &str) -> Result<bool> {
        let mut removed = false;
        self.configuration.update(&mut |config| {
            removed = config.remove_channel(identifier);
            Ok(())
        })?;
        Ok(removed)
    }

    pub async fn remove_required(&self, identifier: &str) -> Result<()> {
        ensure!(self.remove(identifier)?, "Channel is not registered");
        let _ = self.monitor.refresh().await;
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<ChannelConfig>> {
        Ok(self.configuration.load()?.channels)
    }

    pub async fn status(&self) -> Result<Vec<ChannelView>> {
        let config = self.configuration.load()?;
        if config.channels.is_empty() {
            return Ok(Vec::new());
        }
        let mut state = self.states.load().unwrap_or_default();
        let missing: Vec<_> = config
            .channels
            .iter()
            .filter(|channel| !state.channels.contains_key(&channel.id))
            .collect();
        if !missing.is_empty() {
            let gateway = self.gateways.create(&config.api)?;
            for channel in missing {
                match gateway.live_status(&channel.id).await {
                    Ok(live) => {
                        state.channels.insert(
                            channel.id.clone(),
                            ChannelState::from_live_status(&live, None),
                        );
                    }
                    Err(error) => tracing::error!("Failed to check {}: {error}", channel.id),
                }
            }
        }
        // A status query never writes transition state owned by the live monitor.
        Ok(config
            .channels
            .iter()
            .map(|channel| ChannelView::from_state(channel, state.channels.get(&channel.id)))
            .collect())
    }

    pub async fn open(&self, input: &str, live: bool) -> Result<()> {
        let identifier = ChannelId::parse(input)?;
        ensure!(
            self.configuration
                .load()?
                .channels
                .iter()
                .any(|channel| channel.id == identifier.as_str()),
            "Channel is not registered"
        );
        let path = if live { "live/" } else { "" };
        self.browser
            .open(&format!(
                "https://chzzk.naver.com/{path}{}",
                identifier.as_str()
            ))
            .await
    }
}
