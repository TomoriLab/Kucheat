use anyhow::Result;
use std::sync::Arc;

use super::{AutoLaunchCommand, Commands};
use crate::application::ApplicationServices;
use crate::domain::channel::ChannelId;
use crate::domain::state::AppState;
use crate::infrastructure::dbus::{MonitorHost, MonitoringRuntime};
use crate::presentation::tray::{StateSource, TrayApplication};

pub struct CliApplication {
    services: ApplicationServices,
    monitoring: Arc<MonitoringRuntime>,
    tray: Arc<TrayApplication>,
}

impl CliApplication {
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

    pub async fn run(&self, command: Commands) -> Result<()> {
        match command {
            Commands::Gui => anyhow::bail!("GUI runs on the main thread"),
            Commands::Daemon => {
                let (sender, receiver) = tokio::sync::watch::channel(AppState::default());
                let tray = Arc::clone(&self.tray);
                tokio::spawn(async move {
                    if let Err(error) = tray.run(StateSource::Watch(receiver)).await {
                        tracing::error!("Tray error: {error}");
                    }
                });
                self.monitoring
                    .run(MonitorHost::Daemon, Some(sender))
                    .await?;
            }
            Commands::Tray => self.tray.run(StateSource::File).await?,
            Commands::Add { channel_id, name } => {
                let identifier = ChannelId::parse(&channel_id)?;
                let channel = self
                    .services
                    .channels
                    .upsert(identifier.as_str(), name)
                    .await
                    .unwrap_or_else(|error| {
                        eprintln!("❌ 유효하지 않은 채널 ID입니다: {}", identifier.as_str());
                        eprintln!("   오류: {error}");
                        std::process::exit(1);
                    });
                println!("✅ 채널 추가: {} ({})", channel.name, channel.id);
            }
            Commands::Remove { channel_id } => {
                if self.services.channels.remove(&channel_id)? {
                    println!("🗑️  채널 제거: {channel_id}");
                } else {
                    println!("⚠️  해당 채널을 찾을 수 없습니다: {channel_id}");
                }
            }
            Commands::List => {
                let channels = self.services.channels.list()?;
                if channels.is_empty() {
                    println!("등록된 채널이 없습니다.");
                } else {
                    println!("모니터링 채널 목록:");
                    for channel in channels {
                        println!("  • {} ({})", channel.name, channel.id);
                    }
                }
            }
            Commands::Status => {
                let channels = self.services.channels.status().await?;
                if channels.is_empty() {
                    println!("등록된 채널이 없습니다.");
                } else {
                    println!("채널 상태:");
                    for channel in channels {
                        let (icon, extra) = match channel.is_live {
                            Some(true) => (
                                "🔴 LIVE",
                                channel
                                    .live_title
                                    .as_deref()
                                    .map(|title| format!(" 「{title}」"))
                                    .unwrap_or_default(),
                            ),
                            Some(false) => ("⚫ Offline", String::new()),
                            None => ("❓ Unknown", String::new()),
                        };
                        println!("  {icon} {} ({}){extra}", channel.name, channel.id);
                    }
                }
            }
            Commands::AutoLaunch { command } => {
                let enabled = matches!(command, AutoLaunchCommand::Install);
                self.services.settings.set_auto_launch(enabled)?;
                println!(
                    "{}",
                    if enabled {
                        "자동 실행이 활성화되었습니다."
                    } else {
                        "자동 실행이 비활성화되었습니다."
                    }
                );
            }
        }
        Ok(())
    }
}
