use anyhow::Result;
use clap::Parser;
use std::sync::Arc;

use crate::application::ApplicationServices;
use crate::application::ports::{
    AutoStartManager, BrowserLauncher, ChannelGatewayFactory, ConfigurationRepository,
    MonitorControl, NotificationSender, StateRepository,
};
use crate::application::services::{
    ChannelService, DashboardService, MonitoringService, SettingsService,
};
use crate::infrastructure::chzzk::ChzzkGatewayFactory;
use crate::infrastructure::dbus::{DbusMonitorClient, MonitoringRuntime};
use crate::infrastructure::desktop::{
    DesktopNotificationSender, SystemBrowserLauncher, XdgAutoStartManager,
};
use crate::infrastructure::persistence::{
    ApplicationPaths, FileConfigurationRepository, FileStateRepository,
};
use crate::presentation::cli::{Cli, CliApplication, Commands};
use crate::presentation::tray::TrayApplication;

struct ApplicationComponents {
    services: ApplicationServices,
    monitoring: Arc<MonitoringRuntime>,
    tray: Arc<TrayApplication>,
}

impl ApplicationComponents {
    fn new() -> Result<Self> {
        let paths = ApplicationPaths::discover()?;
        let configuration: Arc<dyn ConfigurationRepository> = Arc::new(
            FileConfigurationRepository::new(paths.configuration_directory),
        );
        let states: Arc<dyn StateRepository> =
            Arc::new(FileStateRepository::new(paths.state_directory));
        let gateways: Arc<dyn ChannelGatewayFactory> = Arc::new(ChzzkGatewayFactory);
        let browser: Arc<dyn BrowserLauncher> = Arc::new(SystemBrowserLauncher);
        let autostart: Arc<dyn AutoStartManager> =
            Arc::new(XdgAutoStartManager::new(std::env::current_exe()?));
        let notifications: Arc<dyn NotificationSender> =
            Arc::new(DesktopNotificationSender::default());
        let monitor: Arc<dyn MonitorControl> = Arc::new(DbusMonitorClient);
        let session_type = if std::env::var_os("WAYLAND_DISPLAY").is_some() {
            "wayland"
        } else if std::env::var_os("DISPLAY").is_some() {
            "x11"
        } else {
            "unknown"
        };
        let service = Arc::new(MonitoringService::new(
            configuration.clone(),
            states.clone(),
            gateways.clone(),
            notifications.clone(),
        ));
        Ok(Self {
            services: ApplicationServices {
                channels: Arc::new(ChannelService::new(
                    configuration.clone(),
                    states.clone(),
                    gateways,
                    browser.clone(),
                    monitor.clone(),
                )),
                dashboard: Arc::new(DashboardService::new(
                    configuration.clone(),
                    states.clone(),
                    autostart.clone(),
                    monitor.clone(),
                    session_type.to_owned(),
                )),
                settings: Arc::new(SettingsService::new(
                    configuration.clone(),
                    autostart,
                    notifications,
                    monitor,
                )),
            },
            monitoring: Arc::new(MonitoringRuntime::new(
                service,
                configuration.clone(),
                states.clone(),
            )),
            tray: Arc::new(TrayApplication::new(configuration, states, browser)),
        })
    }
}

pub fn run() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "kucheat=info".parse().unwrap()),
        )
        .init();
    let command = Cli::parse().command.unwrap_or(Commands::Gui);
    tracing::debug!(command = ?command, "CLI parsed");
    #[cfg(not(feature = "gui"))]
    if matches!(command, Commands::Gui) {
        anyhow::bail!("GUI support is disabled; rebuild with the default features");
    }
    let components = ApplicationComponents::new()?;
    #[cfg(feature = "gui")]
    if matches!(command, Commands::Gui) {
        return crate::presentation::gui::GuiApplication::new(
            components.services,
            components.monitoring,
        )
        .run();
    }
    let application =
        CliApplication::new(components.services, components.monitoring, components.tray);
    tokio::runtime::Runtime::new()?.block_on(application.run(command))
}
