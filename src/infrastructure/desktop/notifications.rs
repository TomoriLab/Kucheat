use notify_rust::{Notification, Urgency};
use std::sync::{Arc, OnceLock};

use crate::application::ports::{NotificationSender, PortFuture};
use crate::domain::channel::LiveStatus;
use crate::infrastructure::localization::{Catalog, NativeLocalizer, format_count, interpolate};

const ICON_PNG: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/assets/icons/kucheat.png"
));

pub struct DesktopNotificationSender {
    icon: OnceLock<String>,
    localizer: Arc<NativeLocalizer>,
}

impl DesktopNotificationSender {
    pub fn new(localizer: Arc<NativeLocalizer>) -> Self {
        Self {
            icon: OnceLock::new(),
            localizer,
        }
    }

    fn icon(&self) -> &str {
        self.icon.get_or_init(|| {
            if let Some(directory) = dirs::data_dir() {
                let installed = directory.join("icons/hicolor/512x512/apps/kucheat.png");
                if installed.exists() {
                    return installed.to_string_lossy().into_owned();
                }
            }
            // The notification daemon needs a file path when no installed icon is available.
            let temporary_path = std::env::temp_dir().join("kucheat-notification-icon.png");
            if std::fs::write(&temporary_path, ICON_PNG).is_ok() {
                return temporary_path.to_string_lossy().into_owned();
            }
            "video-display".to_owned()
        })
    }
}

impl NotificationSender for DesktopNotificationSender {
    fn live<'a>(&'a self, identifier: &'a str, status: &'a LiveStatus) -> PortFuture<'a, ()> {
        Box::pin(async move {
            let messages = self.localizer.catalog();
            let (summary, body) = live_content(messages, status);
            let icon = self.icon().to_owned();
            let live_url = format!("https://chzzk.naver.com/live/{identifier}");
            let handle = tokio::task::spawn_blocking(move || {
                Notification::new()
                    .summary(&summary)
                    .body(&body)
                    .icon(&icon)
                    .urgency(Urgency::Normal)
                    .timeout(10_000)
                    .action("live", messages.watch_live)
                    .action("channel", messages.open_channel)
                    .show()
            })
            .await??;
            // Waiting for notification actions must not delay the monitoring cycle.
            tokio::task::spawn_blocking(move || {
                handle.wait_for_action(|action| match action {
                    "live" => {
                        let _ = open::that(&live_url);
                    }
                    "channel" => {
                        let _ = open::that(live_url.replace("/live/", "/"));
                    }
                    _ => {}
                });
            });
            Ok(())
        })
    }

    fn offline<'a>(&'a self, channel_name: &'a str) -> PortFuture<'a, ()> {
        Box::pin(async move {
            let summary = interpolate(
                self.localizer.catalog().notification_offline,
                &[("name", channel_name)],
            );
            let icon = self.icon().to_owned();
            tokio::task::spawn_blocking(move || {
                Notification::new()
                    .summary(&summary)
                    .icon(&icon)
                    .urgency(Urgency::Low)
                    .timeout(5_000)
                    .show()
            })
            .await??;
            Ok(())
        })
    }

    fn test(&self) -> PortFuture<'_, ()> {
        Box::pin(async move {
            let icon = self.icon().to_owned();
            let messages = self.localizer.catalog();
            tokio::task::spawn_blocking(move || {
                Notification::new()
                    .appname("Kucheat")
                    .summary(messages.notification_test_title)
                    .body(messages.notification_test_body)
                    .icon(&icon)
                    .timeout(5_000)
                    .show()
            })
            .await??;
            Ok(())
        })
    }
}

fn live_content(messages: &Catalog, status: &LiveStatus) -> (String, String) {
    let summary = interpolate(
        messages.notification_live,
        &[("name", &status.channel_name)],
    );
    let mut parts = Vec::new();
    if let Some(title) = &status.live_title {
        parts.push(title.clone());
    }
    if let Some(category) = &status.category {
        parts.push(interpolate(
            messages.notification_category,
            &[("category", category)],
        ));
    }
    if let Some(count) = status.viewer_count {
        parts.push(interpolate(
            messages.notification_viewers,
            &[("count", &format_count(count))],
        ));
    }
    (summary, parts.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::localization::Locale;
    use crate::infrastructure::localization::catalog_for;

    #[test]
    fn notification_content_is_localized_without_translating_streamer_data() {
        let status = LiveStatus {
            is_live: true,
            channel_name: "Streamer {count}".to_owned(),
            channel_image_url: None,
            live_title: Some("Original title".to_owned()),
            category: Some("Original category".to_owned()),
            viewer_count: Some(1234),
        };
        for (locale, expected) in [
            (Locale::Korean, "Streamer {count} 방송 시작"),
            (Locale::English, "Streamer {count} is live"),
            (Locale::Japanese, "Streamer {count} が配信を開始しました"),
            (Locale::TraditionalChinese, "Streamer {count} 開始直播了"),
        ] {
            let (summary, body) = live_content(catalog_for(locale), &status);
            assert_eq!(summary, expected);
            assert!(body.contains("Original title"));
            assert!(body.contains("Original category"));
            assert!(body.contains("1,234"));
        }
    }
}
