use std::sync::Arc;
use std::time::Duration;

use kucheat::domain::config::Config;
use kucheat::domain::localization::Locale;
use kucheat::domain::state::AppState;
use kucheat::infrastructure::localization::NativeLocalizer;
use kucheat::presentation::tray::{StateSource, TrayApplication};
use tokio::sync::{mpsc, watch};

use crate::support::TestApplication;

struct TrayWatcher(mpsc::UnboundedSender<String>);

#[zbus::interface(name = "org.kde.StatusNotifierWatcher")]
impl TrayWatcher {
    fn register_status_notifier_item(&self, service: String) {
        self.0.send(service).unwrap();
    }

    #[zbus(property)]
    fn is_status_notifier_host_registered(&self) -> bool {
        true
    }

    #[zbus(property)]
    fn protocol_version(&self) -> i32 {
        0
    }
}

async fn start_watcher(sender: mpsc::UnboundedSender<String>) -> zbus::Connection {
    zbus::connection::Builder::session()
        .unwrap()
        .name("org.kde.StatusNotifierWatcher")
        .unwrap()
        .serve_at("/StatusNotifierWatcher", TrayWatcher(sender))
        .unwrap()
        .build()
        .await
        .unwrap()
}

async fn wait_for_items(connection: &zbus::Connection, count: usize) -> Vec<String> {
    let bus = zbus::fdo::DBusProxy::new(connection).await.unwrap();
    tokio::time::timeout(Duration::from_secs(8), async {
        loop {
            let items: Vec<_> = bus
                .list_names()
                .await
                .unwrap()
                .into_iter()
                .filter(|name| name.starts_with("org.kde.StatusNotifierItem-"))
                .map(|name| name.to_string())
                .collect();
            if items.len() == count {
                return items;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .expect("Unexpected number of tray items on the isolated bus")
}

async fn registration(receiver: &mut mpsc::UnboundedReceiver<String>) -> String {
    tokio::time::timeout(Duration::from_secs(8), receiver.recv())
        .await
        .expect("The tray did not register with the watcher")
        .unwrap()
}

#[tokio::test]
#[ignore = "Requires an isolated session bus: dbus-run-session cargo test dbus_tray -- --ignored"]
async fn dbus_tray_registers_after_host_start_and_restart_without_duplicates_and_hands_off() {
    let connection = zbus::Connection::session().await.unwrap();
    let bus = zbus::fdo::DBusProxy::new(&connection).await.unwrap();
    assert!(
        !bus.name_has_owner("org.kde.StatusNotifierWatcher".try_into().unwrap())
            .await
            .unwrap()
    );
    let application = TestApplication::new(Config::default());
    let localizer = Arc::new(NativeLocalizer::new(
        application.configuration.clone(),
        Locale::English,
    ));
    let tray = Arc::new(TrayApplication::new(
        application.configuration.clone(),
        application.states.clone(),
        application.desktop.clone(),
        localizer,
    ));
    let (first_sender, first_receiver) = watch::channel(AppState::default());
    let first_tray = tray.clone();
    let first =
        tokio::spawn(async move { first_tray.run(StateSource::Watch(first_receiver)).await });
    let original_items = wait_for_items(&connection, 1).await;
    assert!(
        !first.is_finished(),
        "A missing host must not stop the tray task"
    );
    let (_second_sender, second_receiver) = watch::channel(AppState::default());
    let second = tokio::spawn(async move { tray.run(StateSource::Watch(second_receiver)).await });
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(wait_for_items(&connection, 1).await, original_items);

    let (sender, mut receiver) = mpsc::unbounded_channel();
    let watcher = start_watcher(sender.clone()).await;
    let original = registration(&mut receiver).await;
    assert_eq!(original_items.as_slice(), std::slice::from_ref(&original));
    let item = zbus::Proxy::new(
        &connection,
        original.as_str(),
        "/StatusNotifierItem",
        "org.kde.StatusNotifierItem",
    )
    .await
    .unwrap();
    assert_eq!(item.get_property::<String>("Id").await.unwrap(), "kucheat");
    assert_eq!(
        item.get_property::<String>("Status").await.unwrap(),
        "Active"
    );
    let icons: Vec<(i32, i32, Vec<u8>)> = item.get_property("IconPixmap").await.unwrap();
    assert!(icons.iter().any(|(width, height, data)| *width == 512
        && *height == 512
        && data.len() == 512 * 512 * 4));
    let menu: zbus::zvariant::OwnedObjectPath = item.get_property("Menu").await.unwrap();
    assert!(!menu.as_str().is_empty());

    watcher.close().await.unwrap();
    let replacement_watcher = start_watcher(sender).await;
    assert_eq!(registration(&mut receiver).await, original);
    tokio::time::sleep(Duration::from_millis(2200)).await;
    assert_eq!(
        wait_for_items(&connection, 1).await.as_slice(),
        std::slice::from_ref(&original)
    );
    assert!(
        receiver.try_recv().is_err(),
        "The waiting process must not register a duplicate icon"
    );

    drop(first_sender);
    tokio::time::timeout(Duration::from_secs(5), first)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let successor = registration(&mut receiver).await;
    assert_ne!(successor, original);
    assert_eq!(wait_for_items(&connection, 1).await, [successor]);
    assert!(
        !bus.name_has_owner(original.as_str().try_into().unwrap())
            .await
            .unwrap()
    );

    second.abort();
    assert!(second.await.unwrap_err().is_cancelled());
    wait_for_items(&connection, 0).await;
    tokio::time::timeout(Duration::from_secs(5), async {
        while bus
            .name_has_owner("io.github.tomorilab.Kucheat.Tray".try_into().unwrap())
            .await
            .unwrap()
        {
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .unwrap();
    replacement_watcher.close().await.unwrap();
}
