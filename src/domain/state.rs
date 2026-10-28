use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::channel::LiveStatus;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AppState {
    pub channels: HashMap<String, ChannelState>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChannelState {
    pub is_live: bool,
    pub channel_name: String,
    #[serde(default)]
    pub channel_image_url: Option<String>,
    pub live_title: Option<String>,
    pub category: Option<String>,
    pub viewer_count: Option<i64>,
    pub last_checked: DateTime<Utc>,
    pub went_live_at: Option<DateTime<Utc>>,
}

impl ChannelState {
    /// Build a `ChannelState` from a `LiveStatus`, preserving `went_live_at`
    /// from the previous state when applicable.
    pub fn from_live_status(status: &LiveStatus, previous: Option<&ChannelState>) -> Self {
        let now = Utc::now();
        let was_live = previous.is_some_and(|s| s.is_live);

        Self {
            is_live: status.is_live,
            channel_name: status.channel_name.clone(),
            channel_image_url: status.channel_image_url.clone(),
            live_title: status.live_title.clone(),
            category: status.category.clone(),
            viewer_count: status.viewer_count,
            last_checked: now,
            went_live_at: if status.is_live && !was_live {
                Some(now)
            } else {
                previous.and_then(|s| s.went_live_at)
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn live_status(is_live: bool, image: Option<&str>) -> LiveStatus {
        LiveStatus {
            is_live,
            channel_name: "Channel".to_owned(),
            channel_image_url: image.map(str::to_owned),
            live_title: None,
            category: None,
            viewer_count: None,
        }
    }

    #[test]
    fn legacy_state_without_a_profile_image_remains_readable() {
        let serialized = serde_json::json!({
            "is_live": false,
            "channel_name": "Channel",
            "live_title": null,
            "category": null,
            "viewer_count": null,
            "last_checked": "2025-09-18T00:00:00Z",
            "went_live_at": null
        });
        let state: ChannelState = serde_json::from_value(serialized).unwrap();
        assert!(state.channel_image_url.is_none());
        assert!(!state.is_live);
    }

    #[test]
    fn live_and_offline_profiles_survive_state_serialization() {
        let image = "https://nng-phinf.pstatic.net/profile.png";
        for is_live in [true, false] {
            let state = ChannelState::from_live_status(&live_status(is_live, Some(image)), None);
            let serialized = serde_json::to_value(&state).unwrap();
            assert_eq!(serialized["channel_image_url"], image);
            let restored: ChannelState = serde_json::from_value(serialized).unwrap();
            assert_eq!(restored.channel_image_url.as_deref(), Some(image));
            assert_eq!(restored.is_live, is_live);
        }
    }

    #[test]
    fn changed_or_removed_profiles_replace_the_previous_image() {
        let previous = ChannelState::from_live_status(&live_status(true, Some("old")), None);
        let updated =
            ChannelState::from_live_status(&live_status(true, Some("new")), Some(&previous));
        assert_eq!(updated.channel_image_url.as_deref(), Some("new"));
        assert_eq!(updated.went_live_at, previous.went_live_at);
        let removed = ChannelState::from_live_status(&live_status(true, None), Some(&updated));
        assert!(removed.channel_image_url.is_none());
    }
}
