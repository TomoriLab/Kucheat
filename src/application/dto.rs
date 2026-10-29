use serde::{Deserialize, Serialize};

use crate::domain::config::{ChannelConfig, Settings};
use crate::domain::localization::LanguagePreference;
use crate::domain::monitoring::MonitorStatus;
use crate::domain::state::ChannelState;

#[derive(Serialize)]
pub struct Dashboard {
    pub channels: Vec<ChannelView>,
    pub settings: Settings,
    pub api: ApiView,
    pub auto_launch: bool,
    pub auto_launch_error: Option<String>,
    pub monitor: MonitorStatus,
    pub session_type: String,
    pub version: &'static str,
}

#[derive(Serialize)]
pub struct ApiView {
    pub client_id: String,
    pub has_client_secret: bool,
}

#[derive(Serialize)]
pub struct ChannelView {
    pub id: String,
    pub name: String,
    pub channel_image_url: Option<String>,
    pub is_live: Option<bool>,
    pub live_title: Option<String>,
    pub category: Option<String>,
    pub viewer_count: Option<i64>,
    pub last_checked: Option<String>,
    pub went_live_at: Option<String>,
}

impl ChannelView {
    pub fn from_state(channel: &ChannelConfig, status: Option<&ChannelState>) -> Self {
        Self {
            id: channel.id.clone(),
            name: channel.name.clone(),
            channel_image_url: status.and_then(|value| value.channel_image_url.clone()),
            is_live: status.map(|value| value.is_live),
            live_title: status.and_then(|value| value.live_title.clone()),
            category: status.and_then(|value| value.category.clone()),
            viewer_count: status.and_then(|value| value.viewer_count),
            last_checked: status.map(|value| value.last_checked.to_rfc3339()),
            went_live_at: status.and_then(|value| value.went_live_at.map(|date| date.to_rfc3339())),
        }
    }
}

#[derive(Deserialize)]
pub struct SettingsInput {
    pub check_interval_secs: u64,
    pub notify_offline: bool,
    pub client_id: String,
    pub client_secret: Option<String>,
    #[serde(default)]
    pub clear_client_secret: bool,
    #[serde(default)]
    pub language: Option<LanguagePreference>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_snapshot_never_serializes_the_secret() {
        let value = ApiView {
            client_id: "client".to_owned(),
            has_client_secret: true,
        };
        let serialized = serde_json::to_value(value).unwrap();
        assert_eq!(serialized.as_object().unwrap().len(), 2);
        assert!(serialized.get("client_secret").is_none());
    }
}
