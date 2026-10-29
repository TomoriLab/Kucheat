use std::collections::HashMap;
use std::sync::Arc;

use kucheat::application::ports::{ConfigurationRepository, NotificationSender};
use kucheat::domain::config::Config;
use kucheat::domain::localization::{LanguagePreference, Locale};
use kucheat::infrastructure::desktop::DesktopNotificationSender;
use kucheat::infrastructure::localization::NativeLocalizer;
use tokio::sync::mpsc;
use zbus::zvariant::OwnedValue;

use crate::support::TestApplication;

struct NotificationReceipt {
    summary: String,
    body: String,
}

struct NotificationServer(mpsc::UnboundedSender<NotificationReceipt>);

#[zbus::interface(name = "org.freedesktop.Notifications")]
impl NotificationServer {
    fn get_capabilities(&self) -> Vec<String> {
        vec!["body".to_owned(), "actions".to_owned()]
    }

    fn get_server_information(&self) -> (String, String, String, String) {
        (
            "Test server".to_owned(),
            "Kucheat".to_owned(),
            "1".to_owned(),
            "1.2".to_owned(),
        )
    }

    // The desktop notification protocol fixes the number and order of these arguments.
    #[allow(clippy::too_many_arguments)]
    fn notify(
        &self,
        _app_name: String,
        _replaces_id: u32,
        _app_icon: String,
        summary: String,
        body: String,
        _actions: Vec<String>,
        _hints: HashMap<String, OwnedValue>,
        _expire_timeout: i32,
    ) -> u32 {
        self.0.send(NotificationReceipt { summary, body }).unwrap();
        1
    }

    fn close_notification(&self, _identifier: u32) {}
}

#[tokio::test]
#[ignore = "Requires an isolated session bus: dbus-run-session cargo test localized_notification_delivery -- --ignored"]
async fn localized_notification_delivery_follows_saved_language_without_restarting() {
    let (sender, mut receiver) = mpsc::unbounded_channel();
    let _connection = zbus::connection::Builder::session()
        .unwrap()
        .name("org.freedesktop.Notifications")
        .unwrap()
        .serve_at("/org/freedesktop/Notifications", NotificationServer(sender))
        .unwrap()
        .build()
        .await
        .unwrap();
    let application = TestApplication::new(Config::default());
    let localizer = Arc::new(NativeLocalizer::new(
        application.configuration.clone(),
        Locale::English,
    ));
    let notifications = DesktopNotificationSender::new(localizer);
    for (language, title, body) in [
        (
            LanguagePreference::Korean,
            "Kucheat 알림 테스트",
            "라이브 알림이 이 위치에 표시됩니다.",
        ),
        (
            LanguagePreference::English,
            "Kucheat notification test",
            "Live notifications appear here.",
        ),
        (
            LanguagePreference::Japanese,
            "Kucheat 通知テスト",
            "ライブ通知はここに表示されます。",
        ),
        (
            LanguagePreference::TraditionalChinese,
            "Kucheat 通知測試",
            "直播通知會顯示在這裡。",
        ),
    ] {
        application
            .configuration
            .update(&mut |config| {
                config.settings.language = language;
                Ok(())
            })
            .unwrap();
        notifications.test().await.unwrap();
        let notification = tokio::time::timeout(std::time::Duration::from_secs(5), receiver.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(notification.summary, title);
        assert_eq!(notification.body, body);
    }
}
