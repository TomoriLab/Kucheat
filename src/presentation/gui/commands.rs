use crate::application::ApplicationServices;
use crate::application::dto::{Dashboard, SettingsInput};

type CommandResult<T> = Result<T, String>;

fn command_error(error: anyhow::Error) -> String {
    format!("{error:#}")
}

#[tauri::command]
pub async fn get_dashboard(
    services: tauri::State<'_, ApplicationServices>,
) -> CommandResult<Dashboard> {
    services.dashboard.load().await.map_err(command_error)
}

#[tauri::command]
pub async fn add_channel(
    channel_id: String,
    name: Option<String>,
    services: tauri::State<'_, ApplicationServices>,
) -> CommandResult<Dashboard> {
    services
        .channels
        .add(&channel_id, name)
        .await
        .map_err(command_error)?;
    services.dashboard.load().await.map_err(command_error)
}

#[tauri::command]
pub async fn remove_channel(
    channel_id: String,
    services: tauri::State<'_, ApplicationServices>,
) -> CommandResult<Dashboard> {
    services
        .channels
        .remove_required(&channel_id)
        .await
        .map_err(command_error)?;
    services.dashboard.load().await.map_err(command_error)
}

#[tauri::command]
pub async fn save_settings(
    settings: SettingsInput,
    services: tauri::State<'_, ApplicationServices>,
) -> CommandResult<Dashboard> {
    services
        .settings
        .update(settings)
        .await
        .map_err(command_error)?;
    services.dashboard.load().await.map_err(command_error)
}

#[tauri::command]
pub async fn set_auto_launch(
    enabled: bool,
    services: tauri::State<'_, ApplicationServices>,
) -> CommandResult<Dashboard> {
    services
        .settings
        .set_auto_launch(enabled)
        .map_err(command_error)?;
    services.dashboard.load().await.map_err(command_error)
}

#[tauri::command]
pub async fn refresh_channels(
    services: tauri::State<'_, ApplicationServices>,
) -> CommandResult<()> {
    services.dashboard.refresh().await.map_err(command_error)
}

#[tauri::command]
pub async fn open_channel(
    channel_id: String,
    live: bool,
    services: tauri::State<'_, ApplicationServices>,
) -> CommandResult<()> {
    services
        .channels
        .open(&channel_id, live)
        .await
        .map_err(command_error)
}

#[tauri::command]
pub async fn send_test_notification(
    services: tauri::State<'_, ApplicationServices>,
) -> CommandResult<()> {
    services
        .settings
        .send_test_notification()
        .await
        .map_err(command_error)
}
