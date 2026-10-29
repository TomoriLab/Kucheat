use anyhow::Result;
use serde::{Deserialize, Serialize};

use super::localization::LanguagePreference;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct Config {
    pub api: ApiConfig,
    pub settings: Settings,
    #[serde(default)]
    pub channels: Vec<ChannelConfig>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct ApiConfig {
    /// CHZZK Open API Client ID (leave empty to use unofficial API)
    #[serde(default)]
    pub client_id: String,
    /// CHZZK Open API Client Secret
    #[serde(default)]
    pub client_secret: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct Settings {
    /// Interval between live checks in seconds
    #[serde(default = "default_check_interval")]
    pub check_interval_secs: u64,
    /// Whether to send notification when a stream goes offline
    #[serde(default)]
    pub notify_offline: bool,
    #[serde(default)]
    pub language: LanguagePreference,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct ChannelConfig {
    pub id: String,
    pub name: String,
}

fn default_check_interval() -> u64 {
    60
}

impl Settings {
    pub fn validate(&self) -> Result<()> {
        anyhow::ensure!(
            (15..=86_400).contains(&self.check_interval_secs),
            "Check interval must be between 15 and 86400 seconds"
        );
        Ok(())
    }
}

impl Default for Config {
    fn default() -> Self {
        Self {
            api: ApiConfig {
                client_id: String::new(),
                client_secret: String::new(),
            },
            settings: Settings {
                check_interval_secs: 60,
                notify_offline: false,
                language: LanguagePreference::System,
            },
            channels: Vec::new(),
        }
    }
}

impl Config {
    pub fn add_channel(&mut self, id: &str, name: &str) {
        tracing::debug!(
            channel_id = id,
            channel_name = name,
            "Adding channel to config"
        );
        self.channels.retain(|ch| ch.id != id);
        self.channels.push(ChannelConfig {
            id: id.to_string(),
            name: name.to_string(),
        });
    }

    pub fn remove_channel(&mut self, id: &str) -> bool {
        tracing::debug!(channel_id = id, "Removing channel from config");
        let before = self.channels.len();
        self.channels.retain(|ch| ch.id != id);
        let removed = self.channels.len() < before;
        tracing::debug!(channel_id = id, removed = removed, "Channel removal result");
        removed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_configuration_round_trips() {
        let config = Config::default();
        let serialized = toml::to_string_pretty(&config).unwrap();
        assert_eq!(toml::from_str::<Config>(&serialized).unwrap(), config);
    }

    #[test]
    fn validates_monitoring_interval_boundaries() {
        for interval in [15, 60, 86_400] {
            assert!(
                Settings {
                    check_interval_secs: interval,
                    notify_offline: false,
                    language: LanguagePreference::System,
                }
                .validate()
                .is_ok()
            );
        }
        for interval in [0, 14, 86_401, u64::MAX] {
            assert!(
                Settings {
                    check_interval_secs: interval,
                    notify_offline: false,
                    language: LanguagePreference::System,
                }
                .validate()
                .is_err()
            );
        }
    }
}
