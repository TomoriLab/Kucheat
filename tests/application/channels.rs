use std::sync::atomic::Ordering;

use kucheat::application::ports::{ConfigurationRepository, StateRepository};
use kucheat::domain::config::Config;

use crate::support::{CHANNEL, OTHER_CHANNEL, PortEvent, TestApplication};

#[tokio::test]
async fn invalid_and_duplicate_channels_do_not_reach_the_gateway() {
    let mut config = Config::default();
    config.add_channel(CHANNEL, "Existing");
    let application = TestApplication::new(config);
    let service = application.channels();
    assert!(service.add("invalid", None).await.is_err());
    assert!(
        service
            .add(OTHER_CHANNEL, Some("x".repeat(101)))
            .await
            .is_err()
    );
    assert!(service.add(CHANNEL, None).await.is_err());
    assert_eq!(application.gateways.creations.load(Ordering::Relaxed), 0);
    assert!(application.events.snapshot().is_empty());
}

#[tokio::test]
async fn registration_rechecks_duplicates_against_the_latest_configuration() {
    let application = TestApplication::new(Config::default());
    let mut concurrent = Config::default();
    concurrent.add_channel(CHANNEL, "Concurrent registration");
    application
        .configuration
        .replace_before_next_update(concurrent.clone());
    assert!(application.channels().add(CHANNEL, None).await.is_err());
    assert_eq!(application.configuration.load().unwrap(), concurrent);
    assert!(application.events.snapshot().is_empty());
}

#[tokio::test]
async fn registration_preserves_concurrent_settings_and_cli_replacement() {
    let application = TestApplication::new(Config::default());
    let mut concurrent = Config::default();
    concurrent.api.client_secret = "Concurrent secret".to_owned();
    concurrent.add_channel(OTHER_CHANNEL, "Other channel");
    application
        .configuration
        .replace_before_next_update(concurrent);
    let service = application.channels();
    let channel = service
        .add(&CHANNEL.to_uppercase(), Some(" Custom name ".to_owned()))
        .await
        .unwrap();
    assert_eq!(channel.id, CHANNEL);
    assert_eq!(channel.name, "Custom name");
    assert_eq!(
        application.events.snapshot(),
        [PortEvent::ConfigurationSaved, PortEvent::MonitorRefresh]
    );
    service
        .upsert(CHANNEL, Some("Replacement".to_owned()))
        .await
        .unwrap();
    let saved = application.configuration.load().unwrap();
    assert_eq!(saved.api.client_secret, "Concurrent secret");
    assert_eq!(saved.channels.len(), 2);
    assert_eq!(saved.channels[1].name, "Replacement");
}

#[tokio::test]
async fn status_and_removal_do_not_persist_monitor_owned_state() {
    let mut config = Config::default();
    config.add_channel(CHANNEL, "Offline");
    config.add_channel(OTHER_CHANNEL, "Unknown");
    let application = TestApplication::new(config);
    application.gateway.set_live(CHANNEL, false);
    let service = application.channels();
    let status = service.status().await.unwrap();
    assert_eq!(status[0].is_live, Some(false));
    assert_eq!(status[1].is_live, None);
    assert!(application.states.load().unwrap().channels.is_empty());
    assert!(application.events.snapshot().is_empty());
    service.remove_required(CHANNEL).await.unwrap();
    assert_eq!(
        application.events.snapshot(),
        [PortEvent::ConfigurationSaved, PortEvent::MonitorRefresh]
    );
    assert!(application.states.load().unwrap().channels.is_empty());
}

#[tokio::test]
async fn browser_navigation_requires_a_registered_normalized_channel() {
    let mut config = Config::default();
    config.add_channel(CHANNEL, "Channel");
    let application = TestApplication::new(config);
    let service = application.channels();
    assert!(service.open("https://evil.example/", true).await.is_err());
    assert!(service.open(OTHER_CHANNEL, true).await.is_err());
    assert!(application.events.snapshot().is_empty());
    service.open(&CHANNEL.to_uppercase(), true).await.unwrap();
    assert_eq!(
        application.events.snapshot(),
        [PortEvent::BrowserOpened(format!(
            "https://chzzk.naver.com/live/{CHANNEL}"
        ))]
    );
}
