use anyhow::Result;

const BUS_NAME: &str = "io.github.tomorilab.Kucheat.Tray";

pub(crate) struct TrayLease {
    _connection: zbus::Connection,
}

impl TrayLease {
    pub(crate) async fn try_acquire() -> Result<Option<Self>> {
        let connection = zbus::Connection::session().await?;
        match connection
            .request_name_with_flags(BUS_NAME, zbus::fdo::RequestNameFlags::DoNotQueue.into())
            .await
        {
            Ok(_) => Ok(Some(Self {
                _connection: connection,
            })),
            Err(zbus::Error::NameTaken) => Ok(None),
            Err(error) => Err(error.into()),
        }
    }
}
