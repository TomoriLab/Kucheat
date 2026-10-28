use std::sync::atomic::Ordering;

use kucheat::application::ports::{ChannelGateway, StateRepository};
use kucheat::domain::config::Config;
use kucheat::domain::state::{AppState, ChannelState};

use crate::support::{CHANNEL, OTHER_CHANNEL, TestApplication};

#[tokio::test]
async fn dashboard_filters_removed_channels_and_never_exposes_secrets() {
    let mut config = Config::default();
    config.add_channel(CHANNEL, "Offline");
    config.add_channel(OTHER_CHANNEL, "Unknown");
    config.api.client_secret = "Private secret sentinel".to_owned();
    let application = TestApplication::new(config);
    application.gateway.set_live(CHANNEL, false);
    let live = application.gateway.live_status(CHANNEL).await.unwrap();
    let mut state = AppState::default();
    state.channels.insert(
        CHANNEL.to_owned(),
        ChannelState::from_live_status(&live, None),
    );
    state.channels.insert(
        "removed".to_owned(),
        ChannelState::from_live_status(&live, None),
    );
    application.states.save(&state).unwrap();
    application.events.clear();
    let dashboard = application.dashboard().load().await.unwrap();
    assert_eq!(dashboard.channels.len(), 2);
    assert_eq!(dashboard.channels[0].is_live, Some(false));
    assert_eq!(dashboard.channels[1].is_live, None);
    assert!(live.channel_image_url.is_some());
    assert_eq!(
        dashboard.channels[0].channel_image_url,
        live.channel_image_url
    );
    assert!(dashboard.channels[1].channel_image_url.is_none());
    assert!(dashboard.api.has_client_secret);
    assert_eq!(dashboard.session_type, "wayland");
    let serialized = serde_json::to_string(&dashboard).unwrap();
    assert!(!serialized.contains("Private secret sentinel"));
    assert!(
        serde_json::to_value(&dashboard).unwrap()["api"]
            .get("client_secret")
            .is_none()
    );
    assert!(application.events.snapshot().is_empty());
}

#[tokio::test]
async fn desktop_status_failures_do_not_hide_the_configuration() {
    let mut config = Config::default();
    config.add_channel(CHANNEL, "Channel");
    let application = TestApplication::new(config);
    application
        .desktop
        .fail_status
        .store(true, Ordering::Relaxed);
    let dashboard = application.dashboard().load().await.unwrap();
    assert_eq!(dashboard.channels.len(), 1);
    assert!(!dashboard.auto_launch);
    assert_eq!(
        dashboard.auto_launch_error.as_deref(),
        Some("Autostart unavailable")
    );
    assert_eq!(
        dashboard.monitor.last_error.as_deref(),
        Some("Monitor unavailable")
    );
}
