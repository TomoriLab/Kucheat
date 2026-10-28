use anyhow::Result;
use std::sync::Arc;

use crate::application::dto::{ApiView, ChannelView, Dashboard};
use crate::application::ports::{
    AutoStartManager, ConfigurationRepository, MonitorControl, StateRepository,
};
use crate::domain::monitoring::MonitorStatus;

pub struct DashboardService {
    configuration: Arc<dyn ConfigurationRepository>,
    states: Arc<dyn StateRepository>,
    autostart: Arc<dyn AutoStartManager>,
    monitor: Arc<dyn MonitorControl>,
    session_type: String,
}

impl DashboardService {
    pub fn new(
        configuration: Arc<dyn ConfigurationRepository>,
        states: Arc<dyn StateRepository>,
        autostart: Arc<dyn AutoStartManager>,
        monitor: Arc<dyn MonitorControl>,
        session_type: String,
    ) -> Self {
        Self {
            configuration,
            states,
            autostart,
            monitor,
            session_type,
        }
    }

    pub async fn load(&self) -> Result<Dashboard> {
        let config = self.configuration.load()?;
        let state = self.states.load()?;
        let channels = config
            .channels
            .iter()
            .map(|channel| ChannelView::from_state(channel, state.channels.get(&channel.id)))
            .collect();
        let (auto_launch, auto_launch_error) = match self.autostart.is_enabled() {
            Ok(enabled) => (enabled, None),
            Err(error) => (false, Some(format!("{error:#}"))),
        };
        let monitor = self
            .monitor
            .status()
            .await
            .unwrap_or_else(|error| MonitorStatus {
                last_error: Some(format!("{error:#}")),
                ..Default::default()
            });
        Ok(Dashboard {
            channels,
            settings: config.settings,
            api: ApiView {
                client_id: config.api.client_id,
                has_client_secret: !config.api.client_secret.is_empty(),
            },
            auto_launch,
            auto_launch_error,
            monitor,
            session_type: self.session_type.clone(),
            version: env!("CARGO_PKG_VERSION"),
        })
    }

    pub async fn refresh(&self) -> Result<()> {
        self.monitor.refresh().await
    }
}
