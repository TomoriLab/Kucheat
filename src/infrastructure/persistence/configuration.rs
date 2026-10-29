use std::fs::{self, File, OpenOptions};
use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;

use super::atomic_file::write_atomic;
use crate::application::ports::{ConfigurationMutation, ConfigurationRepository};
use crate::domain::config::Config;
use anyhow::{Context, Result};

pub struct FileConfigurationRepository {
    directory: PathBuf,
}

impl FileConfigurationRepository {
    pub fn new(directory: PathBuf) -> Self {
        Self { directory }
    }

    fn write_lock(&self) -> Result<File> {
        fs::create_dir_all(&self.directory)?;
        let file = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .open(self.directory.join("config.lock"))?;
        file.lock().context("Failed to lock configuration")?;
        Ok(file)
    }

    fn load_unlocked(&self) -> Result<Config> {
        if let Some(config) = self.load_existing()? {
            Ok(config)
        } else {
            let config = Config::default();
            self.save(&config)?;
            tracing::info!(
                "Created default config at {:?}",
                self.directory.join("config.toml")
            );
            Ok(config)
        }
    }

    fn save(&self, config: &Config) -> Result<()> {
        config.settings.validate()?;
        let content = toml::to_string_pretty(config).context("Failed to serialize config")?;
        write_atomic(&self.directory.join("config.toml"), content.as_bytes())
            .context("Failed to write config file")
    }
}

impl ConfigurationRepository for FileConfigurationRepository {
    fn load(&self) -> Result<Config> {
        let _lock = self.write_lock()?;
        self.load_unlocked()
    }

    fn load_existing(&self) -> Result<Option<Config>> {
        // Atomic replacement allows read-only locale discovery without creating files or locks.
        let content = match fs::read_to_string(self.directory.join("config.toml")) {
            Ok(content) => content,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error).context("Failed to read config file"),
        };
        let config: Config = toml::from_str(&content).context("Failed to parse config file")?;
        config.settings.validate()?;
        Ok(Some(config))
    }

    fn update(&self, mutation: &mut ConfigurationMutation<'_>) -> Result<()> {
        // The lock covers reading and mutation so another process cannot lose an intervening edit.
        let _lock = self.write_lock()?;
        let mut config = self.load_unlocked()?;
        let previous = config.clone();
        mutation(&mut config)?;
        if config != previous {
            self.save(&config)?;
        }
        Ok(())
    }
}
