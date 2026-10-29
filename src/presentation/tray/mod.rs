mod menu;

use anyhow::Result;
use ksni::TrayMethods;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::watch;

use crate::application::ports::{BrowserLauncher, ConfigurationRepository, StateRepository};
use crate::domain::config::ChannelConfig;
use crate::domain::state::AppState;
use crate::infrastructure::localization::NativeLocalizer;
use menu::{TrayData, TrayMenu};

pub enum StateSource {
    Watch(watch::Receiver<AppState>),
    File,
}

pub struct TrayApplication {
    configuration: Arc<dyn ConfigurationRepository>,
    states: Arc<dyn StateRepository>,
    browser: Arc<dyn BrowserLauncher>,
    localizer: Arc<NativeLocalizer>,
}

impl TrayApplication {
    pub fn new(
        configuration: Arc<dyn ConfigurationRepository>,
        states: Arc<dyn StateRepository>,
        browser: Arc<dyn BrowserLauncher>,
        localizer: Arc<NativeLocalizer>,
    ) -> Self {
        Self {
            configuration,
            states,
            browser,
            localizer,
        }
    }

    pub async fn run(&self, source: StateSource) -> Result<()> {
        let config = self.configuration.load()?;
        let mut last_language = config.settings.language;
        let mut last_identifiers: Vec<_> = config
            .channels
            .iter()
            .map(|channel| channel.id.clone())
            .collect();
        let data = Arc::new(Mutex::new(TrayData {
            channels: config.channels,
            state: AppState::default(),
        }));
        let handle = TrayMenu::new(
            Arc::clone(&data),
            Arc::clone(&self.browser),
            Arc::clone(&self.localizer),
        )
        .assume_sni_available(true)
        .spawn()
        .await
        .map_err(|error| anyhow::anyhow!("Failed to spawn tray: {error}"))?;
        match source {
            StateSource::Watch(mut receiver) => {
                let mut configuration_poll = tokio::time::interval(Duration::from_secs(2));
                configuration_poll.tick().await;
                loop {
                    tokio::select! {
                        result = receiver.changed() => {
                            if result.is_err() { break; }
                            let state = receiver.borrow_and_update().clone();
                            let config = self.configuration.load().unwrap_or_default();
                            last_identifiers = config.channels.iter().map(|channel| channel.id.clone()).collect();
                            last_language = config.settings.language;
                            Self::replace(&data, config.channels, state);
                            handle.update(|_| {}).await;
                        }
                        _ = configuration_poll.tick() => {
                            let config = self.configuration.load().unwrap_or_default();
                            let identifiers: Vec<_> = config.channels.iter().map(|channel| channel.id.clone()).collect();
                            if identifiers != last_identifiers || config.settings.language != last_language {
                                last_identifiers = identifiers;
                                last_language = config.settings.language;
                                Self::replace(&data, config.channels, receiver.borrow().clone());
                                handle.update(|_| {}).await;
                            }
                        }
                    }
                }
            }
            StateSource::File => loop {
                let config = self.configuration.load().unwrap_or_default();
                let state = self.states.load().unwrap_or_default();
                Self::replace(&data, config.channels, state);
                handle.update(|_| {}).await;
                tokio::time::sleep(Duration::from_secs(3)).await;
            },
        }
        Ok(())
    }

    fn replace(data: &Mutex<TrayData>, channels: Vec<ChannelConfig>, state: AppState) {
        let mut data = data.lock().unwrap();
        data.channels = channels;
        data.state = state;
    }
}
