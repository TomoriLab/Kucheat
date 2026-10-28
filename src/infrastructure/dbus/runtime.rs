use anyhow::Result;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Notify, RwLock, watch};

use super::monitor::MonitorLease;
use crate::application::ports::{ConfigurationRepository, StateRepository};
use crate::application::services::MonitoringService;
use crate::domain::monitoring::MonitorStatus;
use crate::domain::state::AppState;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum MonitorHost {
    Gui,
    Daemon,
}

impl MonitorHost {
    fn label(self) -> &'static str {
        match self {
            Self::Gui => "gui",
            Self::Daemon => "daemon",
        }
    }
}

pub struct MonitoringRuntime {
    service: Arc<MonitoringService>,
    configuration: Arc<dyn ConfigurationRepository>,
    states: Arc<dyn StateRepository>,
}

impl MonitoringRuntime {
    pub fn new(
        service: Arc<MonitoringService>,
        configuration: Arc<dyn ConfigurationRepository>,
        states: Arc<dyn StateRepository>,
    ) -> Self {
        Self {
            service,
            configuration,
            states,
        }
    }

    pub async fn run(
        &self,
        host: MonitorHost,
        sender: Option<watch::Sender<AppState>>,
    ) -> Result<()> {
        loop {
            match self.run_owned(host, sender.clone()).await {
                Err(error)
                    if error
                        .downcast_ref::<zbus::Error>()
                        .is_some_and(|error| matches!(error, zbus::Error::NameTaken)) =>
                {
                    if let Some(sender) = &sender {
                        let _ = sender.send(self.states.load().unwrap_or_default());
                    }
                }
                Err(error) if host == MonitorHost::Gui => {
                    tracing::error!("Monitoring service failed: {error:#}")
                }
                result => return result,
            }
            // A waiting process takes ownership only after the current owner releases its D-Bus name.
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    }

    async fn run_owned(
        &self,
        host: MonitorHost,
        sender: Option<watch::Sender<AppState>>,
    ) -> Result<()> {
        let config = self.configuration.load()?;
        let refresh = Arc::new(Notify::new());
        let status = Arc::new(RwLock::new(MonitorStatus {
            running: true,
            host: Some(host.label().to_owned()),
            ..Default::default()
        }));
        let _lease = MonitorLease::acquire(refresh.clone(), status.clone()).await?;
        tracing::info!(host = host.label(), "Monitoring service acquired");
        self.service.run(config, refresh, status, sender).await
    }
}
