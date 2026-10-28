use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use crate::domain::channel::{ChannelInfo, LiveStatus};
use crate::domain::config::{ApiConfig, Config};
use crate::domain::monitoring::MonitorStatus;
use crate::domain::state::AppState;
use anyhow::Result;

pub type PortFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T>> + Send + 'a>>;
pub type ConfigurationMutation<'a> = dyn FnMut(&mut Config) -> Result<()> + 'a;

pub trait ConfigurationRepository: Send + Sync {
    fn load(&self) -> Result<Config>;
    /// Implementations apply a mutation exactly once against the latest configuration atomically.
    fn update(&self, mutation: &mut ConfigurationMutation<'_>) -> Result<()>;
}

pub trait StateRepository: Send + Sync {
    fn load(&self) -> Result<AppState>;
    fn save(&self, state: &AppState) -> Result<()>;
}

pub trait ChannelGateway: Send + Sync {
    fn channel_info<'a>(&'a self, identifier: &'a str) -> PortFuture<'a, ChannelInfo>;
    fn live_status<'a>(&'a self, identifier: &'a str) -> PortFuture<'a, LiveStatus>;
}

pub trait ChannelGatewayFactory: Send + Sync {
    fn create(&self, credentials: &ApiConfig) -> Result<Arc<dyn ChannelGateway>>;
}

pub trait NotificationSender: Send + Sync {
    fn live<'a>(&'a self, identifier: &'a str, status: &'a LiveStatus) -> PortFuture<'a, ()>;
    fn offline<'a>(&'a self, channel_name: &'a str) -> PortFuture<'a, ()>;
    fn test(&self) -> PortFuture<'_, ()>;
}

pub trait AutoStartManager: Send + Sync {
    fn is_enabled(&self) -> Result<bool>;
    fn set_enabled(&self, enabled: bool) -> Result<()>;
}

pub trait BrowserLauncher: Send + Sync {
    fn open<'a>(&'a self, url: &'a str) -> PortFuture<'a, ()>;
}

pub trait MonitorControl: Send + Sync {
    fn status(&self) -> PortFuture<'_, MonitorStatus>;
    fn refresh(&self) -> PortFuture<'_, ()>;
}
