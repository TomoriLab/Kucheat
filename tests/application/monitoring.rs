use std::sync::atomic::Ordering;

use kucheat::application::ports::StateRepository;
use kucheat::domain::config::Config;
use kucheat::domain::state::AppState;

use crate::support::{CHANNEL, PortEvent, TestApplication};

fn configuration() -> Config {
    let mut config = Config::default();
    config.add_channel(CHANNEL, "Channel");
    config.settings.notify_offline = true;
    config
}

#[tokio::test]
async fn transitions_persist_before_notification_and_survive_handoff() {
    let config = configuration();
    let application = TestApplication::new(config.clone());
    application.gateway.set_live(CHANNEL, true);
    let mut state = AppState::default();
    let errors = application
        .monitoring()
        .check_cycle(&config, application.gateway.as_ref(), &mut state, None)
        .await;
    assert!(errors.is_empty());
    assert_eq!(
        application.events.snapshot(),
        [
            PortEvent::StateSaved,
            PortEvent::LiveNotification(CHANNEL.to_owned()),
            PortEvent::StateSaved
        ]
    );
    let mut handed_off = application.states.load().unwrap();
    assert_eq!(
        handed_off.channels[CHANNEL].channel_image_url.as_deref(),
        Some("https://nng-phinf.pstatic.net/profile.png")
    );
    application.events.clear();
    assert!(
        application
            .monitoring()
            .check_cycle(&config, application.gateway.as_ref(), &mut handed_off, None)
            .await
            .is_empty()
    );
    assert_eq!(
        application.events.snapshot(),
        [PortEvent::StateSaved, PortEvent::StateSaved]
    );
    application.events.clear();
    application.gateway.set_live(CHANNEL, false);
    assert!(
        application
            .monitoring()
            .check_cycle(&config, application.gateway.as_ref(), &mut handed_off, None)
            .await
            .is_empty()
    );
    assert_eq!(
        application.events.snapshot(),
        [
            PortEvent::StateSaved,
            PortEvent::OfflineNotification("Resolved name".to_owned()),
            PortEvent::StateSaved
        ]
    );
}

#[tokio::test]
async fn persistence_failure_suppresses_notification_and_allows_retry() {
    let config = configuration();
    let application = TestApplication::new(config.clone());
    application.gateway.set_live(CHANNEL, true);
    application
        .states
        .fail_writes
        .store(true, Ordering::Relaxed);
    let mut state = AppState::default();
    let errors = application
        .monitoring()
        .check_cycle(&config, application.gateway.as_ref(), &mut state, None)
        .await;
    assert!(!errors.is_empty());
    assert!(state.channels.is_empty());
    assert!(application.events.snapshot().is_empty());
    application
        .states
        .fail_writes
        .store(false, Ordering::Relaxed);
    assert!(
        application
            .monitoring()
            .check_cycle(&config, application.gateway.as_ref(), &mut state, None)
            .await
            .is_empty()
    );
    assert!(
        application
            .events
            .snapshot()
            .contains(&PortEvent::LiveNotification(CHANNEL.to_owned()))
    );
}

#[tokio::test]
async fn notification_failure_does_not_replay_a_persisted_transition() {
    let config = configuration();
    let application = TestApplication::new(config.clone());
    application.gateway.set_live(CHANNEL, true);
    application
        .desktop
        .fail_notifications
        .store(true, Ordering::Relaxed);
    let mut state = AppState::default();
    assert!(
        !application
            .monitoring()
            .check_cycle(&config, application.gateway.as_ref(), &mut state, None)
            .await
            .is_empty()
    );
    application.events.clear();
    application
        .desktop
        .fail_notifications
        .store(false, Ordering::Relaxed);
    let mut handed_off = application.states.load().unwrap();
    assert!(
        application
            .monitoring()
            .check_cycle(&config, application.gateway.as_ref(), &mut handed_off, None)
            .await
            .is_empty()
    );
    assert_eq!(
        application.events.snapshot(),
        [PortEvent::StateSaved, PortEvent::StateSaved]
    );
}
