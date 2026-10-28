use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use anyhow::{Result, ensure};
use kucheat::application::ports::{
    ConfigurationMutation, ConfigurationRepository, StateRepository,
};
use kucheat::domain::config::Config;
use kucheat::domain::state::AppState;

use super::{EventLog, PortEvent};

pub struct MemoryConfiguration {
    value: Mutex<Config>,
    concurrent_update: Mutex<Option<Config>>,
    events: Arc<EventLog>,
}

impl MemoryConfiguration {
    pub fn new(value: Config, events: Arc<EventLog>) -> Self {
        Self {
            value: Mutex::new(value),
            concurrent_update: Mutex::new(None),
            events,
        }
    }

    pub fn replace_before_next_update(&self, value: Config) {
        *self.concurrent_update.lock().unwrap() = Some(value);
    }
}

impl ConfigurationRepository for MemoryConfiguration {
    fn load(&self) -> Result<Config> {
        Ok(self.value.lock().unwrap().clone())
    }

    fn update(&self, mutation: &mut ConfigurationMutation<'_>) -> Result<()> {
        let mut current = self.value.lock().unwrap();
        if let Some(concurrent) = self.concurrent_update.lock().unwrap().take() {
            *current = concurrent;
        }
        let mut candidate = current.clone();
        mutation(&mut candidate)?;
        *current = candidate;
        self.events.push(PortEvent::ConfigurationSaved);
        Ok(())
    }
}

pub struct MemoryState {
    value: Mutex<AppState>,
    pub fail_writes: AtomicBool,
    events: Arc<EventLog>,
}

impl MemoryState {
    pub fn new(events: Arc<EventLog>) -> Self {
        Self {
            value: Mutex::new(AppState::default()),
            fail_writes: AtomicBool::new(false),
            events,
        }
    }
}

impl StateRepository for MemoryState {
    fn load(&self) -> Result<AppState> {
        Ok(self.value.lock().unwrap().clone())
    }

    fn save(&self, state: &AppState) -> Result<()> {
        ensure!(
            !self.fail_writes.load(Ordering::Relaxed),
            "Disk unavailable"
        );
        *self.value.lock().unwrap() = state.clone();
        self.events.push(PortEvent::StateSaved);
        Ok(())
    }
}
