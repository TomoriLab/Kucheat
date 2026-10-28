use std::sync::atomic::Ordering;

use kucheat::application::dto::SettingsInput;
use kucheat::application::ports::ConfigurationRepository;
use kucheat::domain::config::Config;

use crate::support::{CHANNEL, PortEvent, TestApplication};

fn input(secret: Option<&str>, clear: bool) -> SettingsInput {
    SettingsInput {
        check_interval_secs: 120,
        notify_offline: true,
        client_id: " client ".to_owned(),
        client_secret: secret.map(str::to_owned),
        clear_client_secret: clear,
    }
}

#[tokio::test]
async fn settings_preserve_channels_and_write_only_credentials() {
    let mut config = Config::default();
    config.add_channel(CHANNEL, "Channel");
    config.api.client_secret = "Existing secret".to_owned();
    let application = TestApplication::new(config);
    let service = application.settings();
    for secret in [None, Some("")] {
        service.update(input(secret, false)).await.unwrap();
        let saved = application.configuration.load().unwrap();
        assert_eq!(saved.api.client_id, "client");
        assert_eq!(saved.api.client_secret, "Existing secret");
        assert_eq!(saved.channels.len(), 1);
    }
    service
        .update(input(Some("Replacement"), false))
        .await
        .unwrap();
    assert_eq!(
        application.configuration.load().unwrap().api.client_secret,
        "Replacement"
    );
    service
        .update(input(Some("Ignored replacement"), true))
        .await
        .unwrap();
    assert!(
        application
            .configuration
            .load()
            .unwrap()
            .api
            .client_secret
            .is_empty()
    );
    assert_eq!(
        &application.events.snapshot()[..2],
        [PortEvent::ConfigurationSaved, PortEvent::MonitorRefresh]
    );
}

#[tokio::test]
async fn invalid_settings_neither_persist_nor_refresh_the_monitor() {
    let config = Config::default();
    let application = TestApplication::new(config.clone());
    let mut candidates = vec![
        input(None, false),
        input(None, false),
        input(Some(&"x".repeat(1025)), false),
    ];
    candidates[0].check_interval_secs = 14;
    candidates[1].client_id = "x".repeat(257);
    for candidate in candidates {
        assert!(application.settings().update(candidate).await.is_err());
        assert_eq!(application.configuration.load().unwrap(), config);
    }
    assert!(application.events.snapshot().is_empty());
}

#[tokio::test]
async fn desktop_actions_use_the_injected_ports() {
    let application = TestApplication::new(Config::default());
    application.settings().set_auto_launch(true).unwrap();
    application
        .settings()
        .send_test_notification()
        .await
        .unwrap();
    application.dashboard().refresh().await.unwrap();
    assert!(application.desktop.auto_start.load(Ordering::Relaxed));
    assert_eq!(
        application.events.snapshot(),
        [PortEvent::TestNotification, PortEvent::MonitorRefresh]
    );
}
