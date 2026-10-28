use anyhow::{Context, Result};
use std::path::PathBuf;

pub struct ApplicationPaths {
    pub configuration_directory: PathBuf,
    pub state_directory: PathBuf,
}

impl ApplicationPaths {
    pub fn discover() -> Result<Self> {
        Ok(Self {
            configuration_directory: dirs::config_dir()
                .context("Failed to find config directory")?
                .join("kucheat"),
            state_directory: dirs::state_dir()
                .or_else(dirs::data_local_dir)
                .context("Failed to find state directory")?
                .join("kucheat"),
        })
    }
}
