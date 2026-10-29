use anyhow::{Result, ensure};
use std::sync::Arc;

use crate::application::dto::SettingsInput;
use crate::application::ports::{
    AutoStartManager, ConfigurationRepository, MonitorControl, NotificationSender,
};
use crate::domain::config::{Config, Settings};

pub struct SettingsService {
    configuration: Arc<dyn ConfigurationRepository>,
    autostart: Arc<dyn AutoStartManager>,
    notifications: Arc<dyn NotificationSender>,
    monitor: Arc<dyn MonitorControl>,
}

impl SettingsService {
    pub fn new(
        configuration: Arc<dyn ConfigurationRepository>,
        autostart: Arc<dyn AutoStartManager>,
        notifications: Arc<dyn NotificationSender>,
        monitor: Arc<dyn MonitorControl>,
    ) -> Self {
        Self {
            configuration,
            autostart,
            notifications,
            monitor,
        }
    }

    pub async fn update(&self, input: SettingsInput) -> Result<()> {
        self.configuration
            .update(&mut |config| Self::apply(config, &input))?;
        let _ = self.monitor.refresh().await;
        Ok(())
    }

    fn apply(config: &mut Config, input: &SettingsInput) -> Result<()> {
        let settings = Settings {
            check_interval_secs: input.check_interval_secs,
            notify_offline: input.notify_offline,
            language: input.language.unwrap_or(config.settings.language),
        };
        settings.validate()?;
        ensure!(input.client_id.len() <= 256, "Client ID exceeds 256 bytes");
        ensure!(
            input
                .client_secret
                .as_ref()
                .is_none_or(|value| value.len() <= 1024),
            "Client secret exceeds 1024 bytes"
        );
        config.settings = settings;
        config.api.client_id = input.client_id.trim().to_owned();
        if input.clear_client_secret {
            config.api.client_secret.clear();
        } else if let Some(secret) = input
            .client_secret
            .as_ref()
            .filter(|value| !value.is_empty())
        {
            config.api.client_secret = secret.clone();
        }
        Ok(())
    }

    pub fn set_auto_launch(&self, enabled: bool) -> Result<()> {
        self.autostart.set_enabled(enabled)
    }

    pub async fn send_test_notification(&self) -> Result<()> {
        self.notifications.test().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings(secret: Option<&str>, clear: bool) -> SettingsInput {
        SettingsInput {
            check_interval_secs: 120,
            notify_offline: true,
            client_id: "client".to_owned(),
            client_secret: secret.map(str::to_owned),
            clear_client_secret: clear,
            language: None,
        }
    }

    #[test]
    fn blank_secret_preserves_existing_credentials_and_channels() {
        let mut config = Config::default();
        config.api.client_secret = "existing-secret".to_owned();
        config.add_channel("channel", "Name");
        SettingsService::apply(&mut config, &settings(None, false)).unwrap();
        assert_eq!(config.api.client_secret, "existing-secret");
        assert_eq!(config.channels.len(), 1);
        SettingsService::apply(&mut config, &settings(Some(""), false)).unwrap();
        assert_eq!(config.api.client_secret, "existing-secret");
        SettingsService::apply(&mut config, &settings(Some("replacement"), false)).unwrap();
        assert_eq!(config.api.client_secret, "replacement");
        SettingsService::apply(&mut config, &settings(None, true)).unwrap();
        assert!(config.api.client_secret.is_empty());
    }
}
