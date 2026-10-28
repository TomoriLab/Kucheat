use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use anyhow::Result;
use kucheat::application::ports::{ChannelGateway, ChannelGatewayFactory, PortFuture};
use kucheat::domain::channel::{ChannelInfo, LiveStatus};
use kucheat::domain::config::ApiConfig;

#[derive(Default)]
pub struct FakeChannelGateway {
    statuses: Mutex<HashMap<String, LiveStatus>>,
    pub information_requests: Mutex<Vec<String>>,
    pub status_requests: Mutex<Vec<String>>,
}

impl FakeChannelGateway {
    pub fn set_live(&self, identifier: &str, is_live: bool) {
        self.statuses.lock().unwrap().insert(
            identifier.to_owned(),
            LiveStatus {
                is_live,
                channel_name: "Resolved name".to_owned(),
                channel_image_url: Some("https://nng-phinf.pstatic.net/profile.png".to_owned()),
                live_title: is_live.then(|| "Live title".to_owned()),
                category: None,
                viewer_count: is_live.then_some(42),
            },
        );
    }
}

impl ChannelGateway for FakeChannelGateway {
    fn channel_info<'a>(&'a self, identifier: &'a str) -> PortFuture<'a, ChannelInfo> {
        Box::pin(async move {
            self.information_requests
                .lock()
                .unwrap()
                .push(identifier.to_owned());
            Ok(ChannelInfo {
                channel_id: identifier.to_owned(),
                channel_name: "Resolved name".to_owned(),
                channel_image_url: None,
                open_live: false,
            })
        })
    }

    fn live_status<'a>(&'a self, identifier: &'a str) -> PortFuture<'a, LiveStatus> {
        Box::pin(async move {
            self.status_requests
                .lock()
                .unwrap()
                .push(identifier.to_owned());
            self.statuses
                .lock()
                .unwrap()
                .get(identifier)
                .cloned()
                .ok_or_else(|| anyhow::anyhow!("Channel unavailable"))
        })
    }
}

pub struct FakeGatewayFactory {
    gateway: Arc<FakeChannelGateway>,
    pub creations: AtomicUsize,
}

impl FakeGatewayFactory {
    pub fn new(gateway: Arc<FakeChannelGateway>) -> Self {
        Self {
            gateway,
            creations: AtomicUsize::new(0),
        }
    }
}

impl ChannelGatewayFactory for FakeGatewayFactory {
    fn create(&self, _credentials: &ApiConfig) -> Result<Arc<dyn ChannelGateway>> {
        self.creations.fetch_add(1, Ordering::Relaxed);
        Ok(self.gateway.clone())
    }
}
