use std::sync::atomic::Ordering;

use kucheat::application::ports::{ConfigurationRepository, StateRepository};
use kucheat::domain::config::Config;
use kucheat::domain::search::{ChannelSearchEntry, ChannelSearchPage};

use crate::support::{CHANNEL, OTHER_CHANNEL, TestApplication};

fn entry(identifier: &str) -> ChannelSearchEntry {
    ChannelSearchEntry {
        id: identifier.to_owned(),
        name: "Streamer 日本語".to_owned(),
        channel_image_url: Some("https://nng-phinf.pstatic.net/profile.png".to_owned()),
        is_live: true,
        follower_count: Some(1234),
    }
}

#[tokio::test]
async fn invalid_searches_are_rejected_before_creating_a_gateway() {
    let application = TestApplication::new(Config::default());
    let service = application.search();
    for (query, offset) in [
        ("".to_owned(), 0),
        ("  ".to_owned(), 0),
        ("字".repeat(101), 0),
        ("Streamer".to_owned(), 1001),
    ] {
        assert!(service.search(&query, offset).await.is_err());
    }
    assert_eq!(application.gateways.creations.load(Ordering::Relaxed), 0);
    assert!(application.events.snapshot().is_empty());
}

#[tokio::test]
async fn searches_trim_unicode_input_preserve_metadata_and_never_persist_or_notify() {
    let mut config = Config::default();
    config.add_channel(CHANNEL, "Existing");
    config.api.client_secret = "Secret sentinel".to_owned();
    let application = TestApplication::new(config.clone());
    *application.gateway.search_result.lock().unwrap() = Some(ChannelSearchPage {
        channels: vec![entry(CHANNEL), entry(OTHER_CHANNEL)],
        next_offset: Some(20),
    });
    let result = application
        .search()
        .search("  日本語 & 스트리머  ", 0)
        .await
        .unwrap();
    assert_eq!(
        *application.gateway.search_requests.lock().unwrap(),
        [("日本語 & 스트리머".to_owned(), 0)]
    );
    assert_eq!(result.next_offset, Some(20));
    assert_eq!(result.channels.len(), 2);
    assert!(result.channels[0].registered);
    assert!(!result.channels[1].registered);
    assert_eq!(result.channels[1].name, "Streamer 日本語");
    assert_eq!(result.channels[1].follower_count, Some(1234));
    assert!(result.channels[1].is_live);
    assert!(result.channels[1].channel_image_url.is_some());
    assert!(
        !serde_json::to_string(&result)
            .unwrap()
            .contains("Secret sentinel")
    );
    assert_eq!(application.configuration.load().unwrap(), config);
    assert!(application.states.load().unwrap().channels.is_empty());
    assert!(application.events.snapshot().is_empty());
}

#[tokio::test]
async fn search_character_limits_count_unicode_scalars_and_accept_single_character_names() {
    let application = TestApplication::new(Config::default());
    *application.gateway.search_result.lock().unwrap() = Some(ChannelSearchPage::default());
    assert!(application.search().search("字", 0).await.is_ok());
    assert!(
        application
            .search()
            .search(&"🎮".repeat(100), 1000)
            .await
            .is_ok()
    );
    assert!(
        application
            .search()
            .search(&"🎮".repeat(101), 0)
            .await
            .is_err()
    );
    assert_eq!(application.gateway.search_requests.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn search_registration_flags_use_the_latest_configuration_after_the_request() {
    let application = TestApplication::new(Config::default());
    *application.gateway.search_result.lock().unwrap() = Some(ChannelSearchPage {
        channels: vec![entry(CHANNEL)],
        next_offset: None,
    });
    let configuration = application.configuration.clone();
    *application.gateway.before_search_returns.lock().unwrap() = Some(Box::new(move || {
        configuration
            .update(&mut |config| {
                config.add_channel(CHANNEL, "Concurrent registration");
                Ok(())
            })
            .unwrap();
    }));
    let result = application.search().search("Streamer", 0).await.unwrap();
    assert!(result.channels[0].registered);
}

#[tokio::test]
async fn search_results_normalize_ids_remove_duplicates_and_reject_invalid_cursors() {
    let application = TestApplication::new(Config::default());
    let mut missing_name = entry(OTHER_CHANNEL);
    missing_name.name = String::new();
    missing_name.follower_count = Some(-1);
    let entries = vec![
        entry(&CHANNEL.to_uppercase()),
        entry(CHANNEL),
        entry("invalid"),
        missing_name,
    ];
    for cursor in [Some(0), Some(20), Some(1001), None] {
        *application.gateway.search_result.lock().unwrap() = Some(ChannelSearchPage {
            channels: entries.clone(),
            next_offset: cursor,
        });
        let result = application.search().search("Streamer", 20).await.unwrap();
        assert_eq!(result.channels.len(), 2);
        assert_eq!(result.channels[0].id, CHANNEL);
        assert_eq!(result.channels[1].name, OTHER_CHANNEL);
        assert!(result.channels[1].follower_count.is_none());
        assert!(result.next_offset.is_none());
    }
    assert!(application.events.snapshot().is_empty());
}

#[tokio::test]
async fn search_results_are_limited_to_twenty_and_empty_results_remain_empty() {
    let application = TestApplication::new(Config::default());
    *application.gateway.search_result.lock().unwrap() = Some(ChannelSearchPage {
        channels: (0..30)
            .map(|value| entry(&format!("{value:032x}")))
            .collect(),
        next_offset: Some(40),
    });
    let result = application.search().search("Streamer", 20).await.unwrap();
    assert_eq!(result.channels.len(), 20);
    assert_eq!(result.next_offset, Some(40));
    *application.gateway.search_result.lock().unwrap() = Some(ChannelSearchPage::default());
    let result = application.search().search("No match", 0).await.unwrap();
    assert!(result.channels.is_empty());
    assert!(result.next_offset.is_none());
}

#[tokio::test]
async fn search_errors_propagate_without_fabricating_results_or_mutating_state() {
    let application = TestApplication::new(Config::default());
    let result = application.search().search("Streamer", 0).await;
    assert!(result.is_err());
    assert_eq!(result.err().unwrap().to_string(), "Search unavailable");
    assert!(application.events.snapshot().is_empty());
}

#[tokio::test]
async fn searching_without_configuration_does_not_create_files() {
    use kucheat::application::services::ChannelSearchService;
    use kucheat::infrastructure::persistence::FileConfigurationRepository;
    use std::sync::Arc;

    let directory = std::env::temp_dir().join(format!(
        "kucheat-read-only-search-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let application = TestApplication::new(Config::default());
    *application.gateway.search_result.lock().unwrap() = Some(ChannelSearchPage::default());
    let service = ChannelSearchService::new(
        Arc::new(FileConfigurationRepository::new(directory.clone())),
        application.gateways.clone(),
    );
    assert!(
        service
            .search("Streamer", 0)
            .await
            .unwrap()
            .channels
            .is_empty()
    );
    assert!(!directory.exists());
    *application.gateway.search_result.lock().unwrap() = None;
    assert!(service.search("Streamer", 0).await.is_err());
    assert!(!directory.exists());
}
