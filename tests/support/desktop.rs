use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use anyhow::{Result, ensure};
use kucheat::application::ports::{
    AutoStartManager, BrowserLauncher, MonitorControl, NotificationSender, PortFuture,
};
use kucheat::domain::channel::LiveStatus;
use kucheat::domain::monitoring::MonitorStatus;

use super::{EventLog, PortEvent};

pub struct FakeDesktop {
    pub auto_start: AtomicBool,
    pub fail_status: AtomicBool,
    pub fail_notifications: AtomicBool,
    events: Arc<EventLog>,
}

impl FakeDesktop {
    pub fn new(events: Arc<EventLog>) -> Self {
        Self {
            auto_start: AtomicBool::new(false),
            fail_status: AtomicBool::new(false),
            fail_notifications: AtomicBool::new(false),
            events,
        }
    }
}

impl AutoStartManager for FakeDesktop {
    fn is_enabled(&self) -> Result<bool> {
        ensure!(
            !self.fail_status.load(Ordering::Relaxed),
            "Autostart unavailable"
        );
        Ok(self.auto_start.load(Ordering::Relaxed))
    }

    fn set_enabled(&self, enabled: bool) -> Result<()> {
        self.auto_start.store(enabled, Ordering::Relaxed);
        Ok(())
    }
}

impl MonitorControl for FakeDesktop {
    fn status(&self) -> PortFuture<'_, MonitorStatus> {
        Box::pin(async move {
            ensure!(
                !self.fail_status.load(Ordering::Relaxed),
                "Monitor unavailable"
            );
            Ok(MonitorStatus::default())
        })
    }

    fn refresh(&self) -> PortFuture<'_, ()> {
        Box::pin(async move {
            self.events.push(PortEvent::MonitorRefresh);
            Ok(())
        })
    }
}

impl BrowserLauncher for FakeDesktop {
    fn open<'a>(&'a self, url: &'a str) -> PortFuture<'a, ()> {
        Box::pin(async move {
            self.events.push(PortEvent::BrowserOpened(url.to_owned()));
            Ok(())
        })
    }
}

impl NotificationSender for FakeDesktop {
    fn live<'a>(&'a self, identifier: &'a str, _status: &'a LiveStatus) -> PortFuture<'a, ()> {
        Box::pin(async move {
            self.events
                .push(PortEvent::LiveNotification(identifier.to_owned()));
            ensure!(
                !self.fail_notifications.load(Ordering::Relaxed),
                "Notifications unavailable"
            );
            Ok(())
        })
    }

    fn offline<'a>(&'a self, channel_name: &'a str) -> PortFuture<'a, ()> {
        Box::pin(async move {
            self.events
                .push(PortEvent::OfflineNotification(channel_name.to_owned()));
            Ok(())
        })
    }

    fn test(&self) -> PortFuture<'_, ()> {
        Box::pin(async move {
            self.events.push(PortEvent::TestNotification);
            Ok(())
        })
    }
}
