use notify_rust::{Notification, Urgency};
use std::sync::OnceLock;

use crate::application::ports::{NotificationSender, PortFuture};
use crate::domain::channel::LiveStatus;

const ICON_PNG: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/assets/icons/kucheat.png"
));

#[derive(Default)]
pub struct DesktopNotificationSender {
    icon: OnceLock<String>,
}

impl DesktopNotificationSender {
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
            let summary = format!("🔴 {} 방송 시작!", status.channel_name);
            let mut parts = Vec::new();
            if let Some(title) = &status.live_title {
                parts.push(title.clone());
            }
            if let Some(category) = &status.category {
                parts.push(format!("카테고리: {category}"));
            }
            if let Some(count) = status.viewer_count {
                parts.push(format!("시청자: {count}명"));
            }
            let body = parts.join("\n");
            let icon = self.icon().to_owned();
            let live_url = format!("https://chzzk.naver.com/live/{identifier}");
            let handle = tokio::task::spawn_blocking(move || {
                Notification::new()
                    .summary(&summary)
                    .body(&body)
                    .icon(&icon)
                    .urgency(Urgency::Normal)
                    .timeout(10_000)
                    .action("live", "라이브 보기")
                    .action("channel", "채널 페이지")
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
            let name = channel_name.to_owned();
            let icon = self.icon().to_owned();
            tokio::task::spawn_blocking(move || {
                Notification::new()
                    .summary(&format!("⚫ {name} 방송 종료"))
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
            tokio::task::spawn_blocking(move || {
                Notification::new()
                    .appname("Kucheat")
                    .summary("Kucheat 알림 테스트")
                    .body("라이브 알림이 이 위치에 표시됩니다.")
                    .icon(&icon)
                    .timeout(5_000)
                    .show()
            })
            .await??;
            Ok(())
        })
    }
}
