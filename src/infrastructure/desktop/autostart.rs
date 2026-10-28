use crate::application::ports::AutoStartManager;
use anyhow::{Context, Result};
use auto_launch::{AutoLaunch, AutoLaunchBuilder, LinuxLaunchMode};
use std::path::PathBuf;

pub struct XdgAutoStartManager {
    executable: PathBuf,
}

impl XdgAutoStartManager {
    pub fn new(executable: PathBuf) -> Self {
        Self { executable }
    }

    fn profile(&self) -> Result<AutoLaunch> {
        let path = self
            .executable
            .to_str()
            .context("Executable path is not valid UTF-8")?;
        Ok(AutoLaunchBuilder::new()
            .set_app_name("Kucheat")
            .set_app_path(path)
            .set_args(&["daemon"])
            .set_linux_launch_mode(LinuxLaunchMode::XdgAutostart)
            .build()?)
    }
}

impl AutoStartManager for XdgAutoStartManager {
    fn is_enabled(&self) -> Result<bool> {
        Ok(self.profile()?.is_enabled()?)
    }

    fn set_enabled(&self, enabled: bool) -> Result<()> {
        let profile = self.profile()?;
        if enabled {
            profile.enable()?;
        } else {
            profile.disable()?;
        }
        Ok(())
    }
}
