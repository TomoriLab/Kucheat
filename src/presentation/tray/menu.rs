use crate::application::ports::BrowserLauncher;
use crate::domain::config::ChannelConfig;
use crate::domain::state::{AppState, ChannelState};
use crate::infrastructure::localization::{NativeLocalizer, format_count, interpolate};
use std::sync::{Arc, Mutex as StdMutex};

// ---------------------------------------------------------------------------
// Tray data — holds everything the menu needs to render
// ---------------------------------------------------------------------------

pub(super) struct TrayData {
    pub(super) channels: Vec<ChannelConfig>,
    pub(super) state: AppState,
}

// ---------------------------------------------------------------------------
// Embedded icon from assets/icons/kucheat.png
// ---------------------------------------------------------------------------

static ICON_PNG: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/assets/icons/kucheat.png"
));

/// Decode the embedded PNG once and cache the ARGB pixmap.
fn make_icon_pixmap() -> Vec<ksni::Icon> {
    use std::sync::LazyLock;

    static PIXMAP: LazyLock<Vec<ksni::Icon>> = LazyLock::new(|| {
        let img = image::load_from_memory_with_format(ICON_PNG, image::ImageFormat::Png)
            .expect("embedded icon.png is invalid")
            .into_rgba8();

        let width = img.width() as i32;
        let height = img.height() as i32;

        let mut argb = Vec::with_capacity((width * height * 4) as usize);
        for pixel in img.pixels() {
            let [r, g, b, a] = pixel.0;
            argb.extend_from_slice(&[a, r, g, b]);
        }

        vec![ksni::Icon {
            width,
            height,
            data: argb,
        }]
    });

    PIXMAP.clone()
}

// ---------------------------------------------------------------------------
// Menu builder helpers — reduce ksni boilerplate
// ---------------------------------------------------------------------------

fn label_item<T: ksni::Tray>(text: String) -> ksni::MenuItem<T> {
    ksni::MenuItem::Standard(ksni::menu::StandardItem {
        label: text,
        enabled: false,
        ..Default::default()
    })
}

fn link_item<T: ksni::Tray>(
    label: String,
    url: String,
    browser: Arc<dyn BrowserLauncher>,
) -> ksni::MenuItem<T> {
    ksni::MenuItem::Standard(ksni::menu::StandardItem {
        label,
        activate: Box::new(move |_| {
            let browser = Arc::clone(&browser);
            let url = url.clone();
            tokio::spawn(async move {
                let _ = browser.open(&url).await;
            });
        }),
        ..Default::default()
    })
}

fn chzzk_url(path: &str, channel_id: &str) -> String {
    if path.is_empty() {
        format!("https://chzzk.naver.com/{channel_id}")
    } else {
        format!("https://chzzk.naver.com/{path}/{channel_id}")
    }
}

// ---------------------------------------------------------------------------
// ksni Tray implementation (0.3 API)
// ---------------------------------------------------------------------------

pub(super) struct TrayMenu {
    data: Arc<StdMutex<TrayData>>,
    browser: Arc<dyn BrowserLauncher>,
    localizer: Arc<NativeLocalizer>,
}

impl ksni::Tray for TrayMenu {
    fn id(&self) -> String {
        "kucheat".to_string()
    }

    fn title(&self) -> String {
        self.localizer.catalog().tray_title.to_owned()
    }

    fn category(&self) -> ksni::Category {
        ksni::Category::Communications
    }

    fn status(&self) -> ksni::Status {
        ksni::Status::Active
    }

    fn icon_name(&self) -> String {
        String::new()
    }

    fn icon_pixmap(&self) -> Vec<ksni::Icon> {
        make_icon_pixmap()
    }

    fn tool_tip(&self) -> ksni::ToolTip {
        let data = self.data.lock().unwrap();
        let messages = self.localizer.catalog();
        let live_count = data
            .channels
            .iter()
            .filter(|ch| data.state.channels.get(&ch.id).is_some_and(|s| s.is_live))
            .count();

        let description = if live_count > 0 {
            interpolate(
                messages.tray_live_count,
                &[("count", &live_count.to_string())],
            )
        } else {
            messages.tray_no_live.to_owned()
        };

        ksni::ToolTip {
            icon_name: String::new(),
            icon_pixmap: Vec::new(),
            title: "Kucheat".to_string(),
            description,
        }
    }

    fn menu(&self) -> Vec<ksni::MenuItem<Self>> {
        let data = self.data.lock().unwrap();
        let messages = self.localizer.catalog();
        let mut items: Vec<ksni::MenuItem<Self>> = Vec::new();

        if data.channels.is_empty() {
            items.push(label_item(messages.tray_no_channels.into()));
        } else {
            let (live, offline): (Vec<_>, Vec<_>) = data
                .channels
                .iter()
                .partition(|ch| data.state.channels.get(&ch.id).is_some_and(|s| s.is_live));

            // ── Live channels ──────────────────────────────────────
            if !live.is_empty() {
                items.push(label_item(interpolate(
                    messages.tray_live_section,
                    &[("count", &live.len().to_string())],
                )));

                for ch in &live {
                    let cs = data.state.channels.get(&ch.id);
                    items.push(self.build_live_submenu(ch, cs, messages));
                }
            }

            // ── Offline channels ───────────────────────────────────
            if !offline.is_empty() {
                items.push(label_item(interpolate(
                    messages.tray_offline_section,
                    &[("count", &offline.len().to_string())],
                )));

                for ch in &offline {
                    items.push(self.build_offline_submenu(ch, messages));
                }
            }
        }

        items.push(ksni::MenuItem::Separator);
        items.push(ksni::MenuItem::Standard(ksni::menu::StandardItem {
            label: messages.quit.to_owned(),
            activate: Box::new(|_| std::process::exit(0)),
            ..Default::default()
        }));

        items
    }

    fn watcher_offline(&self, reason: ksni::OfflineReason) -> bool {
        tracing::warn!("StatusNotifierWatcher offline: {reason:?}");
        true
    }
}

impl TrayMenu {
    pub(super) fn new(
        data: Arc<StdMutex<TrayData>>,
        browser: Arc<dyn BrowserLauncher>,
        localizer: Arc<NativeLocalizer>,
    ) -> Self {
        Self {
            data,
            browser,
            localizer,
        }
    }
    fn build_live_submenu(
        &self,
        ch: &ChannelConfig,
        cs: Option<&ChannelState>,
        messages: &crate::infrastructure::localization::Catalog,
    ) -> ksni::MenuItem<Self> {
        let name = cs.map_or(&ch.name as &str, |s| &s.channel_name);
        let mut sub: Vec<ksni::MenuItem<Self>> = Vec::new();

        if let Some(title) = cs.and_then(|s| s.live_title.as_deref()) {
            sub.push(label_item(format!("📺 {title}")));
        }
        if let Some(count) = cs.and_then(|s| s.viewer_count) {
            sub.push(label_item(interpolate(
                messages.notification_viewers,
                &[("count", &format_count(count))],
            )));
        }

        sub.push(ksni::MenuItem::Separator);
        sub.push(link_item(
            messages.watch_live.into(),
            chzzk_url("live", &ch.id),
            Arc::clone(&self.browser),
        ));
        sub.push(link_item(
            messages.open_channel.into(),
            chzzk_url("", &ch.id),
            Arc::clone(&self.browser),
        ));

        ksni::MenuItem::SubMenu(ksni::menu::SubMenu {
            label: format!("🔴 {name}"),
            submenu: sub,
            ..Default::default()
        })
    }

    fn build_offline_submenu(
        &self,
        ch: &ChannelConfig,
        messages: &crate::infrastructure::localization::Catalog,
    ) -> ksni::MenuItem<Self> {
        ksni::MenuItem::SubMenu(ksni::menu::SubMenu {
            label: format!("⚫ {}", ch.name),
            submenu: vec![link_item(
                messages.open_channel.into(),
                chzzk_url("", &ch.id),
                Arc::clone(&self.browser),
            )],
            ..Default::default()
        })
    }
}
