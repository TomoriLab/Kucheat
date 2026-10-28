use anyhow::{Context, Result};
use std::fs;
use std::path::PathBuf;

use super::atomic_file::write_atomic;
use crate::application::ports::StateRepository;
use crate::domain::state::AppState;

pub struct FileStateRepository {
    directory: PathBuf,
}

impl FileStateRepository {
    pub fn new(directory: PathBuf) -> Self {
        Self { directory }
    }

    fn path(&self) -> Result<PathBuf> {
        fs::create_dir_all(&self.directory)?;
        Ok(self.directory.join("state.json"))
    }
}

impl StateRepository for FileStateRepository {
    fn load(&self) -> Result<AppState> {
        let path = self.path()?;
        if path.exists() {
            let content = fs::read_to_string(path).context("Failed to read state file")?;
            serde_json::from_str(&content).context("Failed to parse state file")
        } else {
            Ok(AppState::default())
        }
    }

    fn save(&self, state: &AppState) -> Result<()> {
        let path = self.path()?;
        let content = serde_json::to_string_pretty(state).context("Failed to serialize state")?;
        write_atomic(&path, content.as_bytes()).context("Failed to write state file")
    }
}
