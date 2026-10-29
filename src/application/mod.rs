pub mod dto;
pub mod ports;
pub mod services;

use services::{ChannelSearchService, ChannelService, DashboardService, SettingsService};
use std::sync::Arc;

#[derive(Clone)]
pub struct ApplicationServices {
    pub search: Arc<ChannelSearchService>,
    pub channels: Arc<ChannelService>,
    pub dashboard: Arc<DashboardService>,
    pub settings: Arc<SettingsService>,
}
