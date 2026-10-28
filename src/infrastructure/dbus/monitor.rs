use anyhow::{Context, Result};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Notify, RwLock};
use tokio::time;

use crate::application::ports::{MonitorControl, PortFuture};
use crate::domain::monitoring::MonitorStatus;

const BUS_NAME: &str = "io.github.tomorilab.Kucheat.Monitor";
const OBJECT_PATH: &str = "/io/github/tomorilab/Kucheat/Monitor";

struct MonitorObject {
    refresh: Arc<Notify>,
    status: Arc<RwLock<MonitorStatus>>,
}

#[zbus::interface(name = "io.github.tomorilab.Kucheat.Monitor")]
impl MonitorObject {
    async fn refresh(&self) {
        if !self.status.read().await.checking {
            self.refresh.notify_one();
        }
    }

    async fn status(&self) -> zbus::fdo::Result<String> {
        serde_json::to_string(&*self.status.read().await)
            .map_err(|error| zbus::fdo::Error::Failed(error.to_string()))
    }
}

pub(super) struct MonitorLease {
    _connection: zbus::Connection,
}

impl MonitorLease {
    pub(super) async fn acquire(
        refresh: Arc<Notify>,
        status: Arc<RwLock<MonitorStatus>>,
    ) -> Result<Self> {
        let connection = zbus::connection::Builder::session()?
            .serve_at(OBJECT_PATH, MonitorObject { refresh, status })?
            .build()
            .await?;
        connection
            .request_name_with_flags(BUS_NAME, zbus::fdo::RequestNameFlags::DoNotQueue.into())
            .await?;
        Ok(Self {
            _connection: connection,
        })
    }
}

pub struct DbusMonitorClient;

impl MonitorControl for DbusMonitorClient {
    fn status(&self) -> PortFuture<'_, MonitorStatus> {
        Box::pin(async {
            time::timeout(Duration::from_secs(3), async {
                let connection = zbus::Connection::session().await?;
                let bus = zbus::fdo::DBusProxy::new(&connection).await?;
                if !bus.name_has_owner(BUS_NAME.try_into()?).await? {
                    return Ok(MonitorStatus::default());
                }
                let proxy = zbus::Proxy::new(&connection, BUS_NAME, OBJECT_PATH, BUS_NAME).await?;
                let serialized: String = proxy.call("Status", &()).await?;
                Ok::<_, anyhow::Error>(serde_json::from_str(&serialized)?)
            })
            .await
            .context("Monitoring service did not respond")?
        })
    }

    fn refresh(&self) -> PortFuture<'_, ()> {
        Box::pin(async {
            time::timeout(Duration::from_secs(3), async {
                let connection = zbus::Connection::session().await?;
                let proxy = zbus::Proxy::new(&connection, BUS_NAME, OBJECT_PATH, BUS_NAME).await?;
                let _: () = proxy.call("Refresh", &()).await?;
                Ok::<_, anyhow::Error>(())
            })
            .await
            .context("Monitoring service did not respond")?
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "Requires an isolated session bus: dbus-run-session cargo test -- --ignored"]
    async fn dbus_monitor_has_one_owner_and_accepts_refresh() {
        let refresh = Arc::new(Notify::new());
        let status = Arc::new(RwLock::new(MonitorStatus {
            running: true,
            host: Some("test".to_owned()),
            ..Default::default()
        }));
        let owner = MonitorLease::acquire(refresh.clone(), status.clone())
            .await
            .unwrap();
        let duplicate = MonitorLease::acquire(Arc::new(Notify::new()), status).await;
        assert!(
            duplicate.is_err(),
            "A second monitor must not acquire the bus name"
        );
        let client = DbusMonitorClient;
        assert_eq!(client.status().await.unwrap().host.as_deref(), Some("test"));
        client.refresh().await.unwrap();
        time::timeout(Duration::from_secs(2), refresh.notified())
            .await
            .unwrap();
        drop(owner);
    }
}
