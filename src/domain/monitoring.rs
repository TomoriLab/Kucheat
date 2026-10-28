use serde::{Deserialize, Serialize};

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct MonitorStatus {
    pub running: bool,
    pub checking: bool,
    pub last_error: Option<String>,
    pub last_checked: Option<String>,
    pub host: Option<String>,
}
