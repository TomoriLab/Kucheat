mod commands;
mod instance;

use anyhow::{Context, Result};
use std::sync::Arc;
use tauri::Manager;

use crate::application::ApplicationServices;
use crate::infrastructure::dbus::{MonitorHost, MonitoringRuntime};
use crate::presentation::tray::{StateSource, TrayApplication};
use instance::DesktopInstance;

pub struct GuiApplication {
    services: ApplicationServices,
    monitoring: Arc<MonitoringRuntime>,
    tray: Arc<TrayApplication>,
}

impl GuiApplication {
    pub fn new(
        services: ApplicationServices,
        monitoring: Arc<MonitoringRuntime>,
        tray: Arc<TrayApplication>,
    ) -> Self {
        Self {
            services,
            monitoring,
            tray,
        }
    }

    pub fn run(self) -> Result<()> {
        let Some(instance) = DesktopInstance::acquire_or_activate()? else {
            return Ok(());
        };
        let monitoring = self.monitoring;
        let tray = self.tray;
        tauri::Builder::default()
            .manage(self.services)
            .setup(move |application| {
                tauri::async_runtime::block_on(instance.attach(application.handle().clone()))?;
                application.manage(instance);
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = tray.run(StateSource::File).await {
                        tracing::error!("Tray service failed: {error:#}");
                    }
                });
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = monitoring.run(MonitorHost::Gui, None).await {
                        tracing::error!("Monitoring service failed: {error:#}");
                    }
                });
                Ok(())
            })
            .invoke_handler(tauri::generate_handler![
                commands::get_dashboard,
                commands::add_channel,
                commands::remove_channel,
                commands::save_settings,
                commands::set_auto_launch,
                commands::refresh_channels,
                commands::open_channel,
                commands::send_test_notification
            ])
            .run(tauri::generate_context!())
            .context("Failed to run the desktop application")?;
        Ok(())
    }
}
