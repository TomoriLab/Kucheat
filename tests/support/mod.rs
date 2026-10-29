mod desktop;
mod gateway;
mod repositories;

use std::sync::{Arc, Mutex};

use kucheat::application::services::{
    ChannelSearchService, ChannelService, DashboardService, MonitoringService, SettingsService,
};
use kucheat::domain::config::Config;

pub use desktop::FakeDesktop;
pub use gateway::{FakeChannelGateway, FakeGatewayFactory};
pub use repositories::{MemoryConfiguration, MemoryState};

pub const CHANNEL: &str = "0123456789abcdef0123456789abcdef";
pub const OTHER_CHANNEL: &str = "fedcba9876543210fedcba9876543210";

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PortEvent {
    ConfigurationSaved,
    StateSaved,
    MonitorRefresh,
    LiveNotification(String),
    OfflineNotification(String),
    TestNotification,
    BrowserOpened(String),
}

#[derive(Default)]
pub struct EventLog(Mutex<Vec<PortEvent>>);

impl EventLog {
    pub fn push(&self, event: PortEvent) {
        self.0.lock().unwrap().push(event);
    }

    pub fn snapshot(&self) -> Vec<PortEvent> {
        self.0.lock().unwrap().clone()
    }

    pub fn clear(&self) {
        self.0.lock().unwrap().clear();
    }
}

pub struct TestApplication {
    pub configuration: Arc<MemoryConfiguration>,
    pub states: Arc<MemoryState>,
    pub gateway: Arc<FakeChannelGateway>,
    pub gateways: Arc<FakeGatewayFactory>,
    pub desktop: Arc<FakeDesktop>,
    pub events: Arc<EventLog>,
}

impl TestApplication {
    pub fn new(config: Config) -> Self {
        let events = Arc::new(EventLog::default());
        let gateway = Arc::new(FakeChannelGateway::default());
        Self {
            configuration: Arc::new(MemoryConfiguration::new(config, events.clone())),
            states: Arc::new(MemoryState::new(events.clone())),
            gateways: Arc::new(FakeGatewayFactory::new(gateway.clone())),
            gateway,
            desktop: Arc::new(FakeDesktop::new(events.clone())),
            events,
        }
    }

    pub fn search(&self) -> ChannelSearchService {
        ChannelSearchService::new(self.configuration.clone(), self.gateways.clone())
    }

    pub fn channels(&self) -> ChannelService {
        ChannelService::new(
            self.configuration.clone(),
            self.states.clone(),
            self.gateways.clone(),
            self.desktop.clone(),
            self.desktop.clone(),
        )
    }

    pub fn settings(&self) -> SettingsService {
        SettingsService::new(
            self.configuration.clone(),
            self.desktop.clone(),
            self.desktop.clone(),
            self.desktop.clone(),
        )
    }

    pub fn dashboard(&self) -> DashboardService {
        DashboardService::new(
            self.configuration.clone(),
            self.states.clone(),
            self.desktop.clone(),
            self.desktop.clone(),
            "wayland".to_owned(),
        )
    }

    pub fn monitoring(&self) -> MonitoringService {
        MonitoringService::new(
            self.configuration.clone(),
            self.states.clone(),
            self.gateways.clone(),
            self.desktop.clone(),
        )
    }
}
