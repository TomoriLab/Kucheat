use anyhow::{Context, Result};
use std::time::Duration;
use tauri::Manager;

const BUS_NAME: &str = "io.github.tomorilab.Kucheat.Desktop";
const OBJECT_PATH: &str = "/io/github/tomorilab/Kucheat";

pub(super) struct DesktopInstance {
    connection: zbus::Connection,
}

impl DesktopInstance {
    pub(super) fn acquire_or_activate() -> Result<Option<Self>> {
        let result = tauri::async_runtime::block_on(async {
            let connection = zbus::Connection::session().await?;
            connection
                .request_name_with_flags(BUS_NAME, zbus::fdo::RequestNameFlags::DoNotQueue.into())
                .await?;
            Ok::<_, zbus::Error>(connection)
        });
        match result {
            Ok(connection) => Ok(Some(Self { connection })),
            Err(zbus::Error::NameTaken) => {
                tauri::async_runtime::block_on(Self::activate_existing())?;
                Ok(None)
            }
            Err(error) => Err(error).context("A desktop session D-Bus connection is required"),
        }
    }

    pub(super) async fn attach(&self, application: tauri::AppHandle) -> Result<()> {
        // Object-server creation must occur inside the async runtime, not before entering it.
        self.connection
            .object_server()
            .at(OBJECT_PATH, GuiActivation { application })
            .await?;
        Ok(())
    }

    async fn activate_existing() -> Result<()> {
        let connection = zbus::Connection::session().await?;
        let proxy = zbus::Proxy::new(&connection, BUS_NAME, OBJECT_PATH, BUS_NAME).await?;
        for attempt in 0..20 {
            let result: zbus::Result<()> = proxy.call("Activate", &()).await;
            match result {
                Ok(()) => return Ok(()),
                Err(error) if attempt == 19 => return Err(error.into()),
                Err(_) => tokio::time::sleep(Duration::from_millis(100)).await,
            }
        }
        unreachable!()
    }
}

struct GuiActivation {
    application: tauri::AppHandle,
}

#[zbus::interface(name = "io.github.tomorilab.Kucheat.Desktop")]
impl GuiActivation {
    fn activate(&self) -> zbus::fdo::Result<()> {
        let application = self.application.clone();
        self.application
            .run_on_main_thread(move || {
                if let Some(window) = application.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    // Wayland compositors decide whether an application may take keyboard focus.
                    if let Err(error) = window.set_focus() {
                        tracing::debug!("Window activation was not granted: {error}");
                    }
                }
            })
            .map_err(|error| zbus::fdo::Error::Failed(error.to_string()))
    }
}
