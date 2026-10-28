use anyhow::{Context, Result};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_WRITE: AtomicU64 = AtomicU64::new(0);

/// Atomic replacement prevents readers in other processes from observing partial files.
pub fn write_atomic(path: &Path, content: &[u8]) -> Result<()> {
    let name = path.file_name().context("Storage path has no file name")?;
    let temporary = path.with_file_name(format!(
        ".{}.{}.{}.tmp",
        name.to_string_lossy(),
        std::process::id(),
        NEXT_WRITE.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temporary)
            .context("Failed to create temporary storage file")?;
        file.write_all(content)?;
        file.sync_all()?;
        fs::rename(&temporary, path).context("Failed to replace storage file")?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn replaces_complete_files_with_private_permissions() {
        let directory = std::env::temp_dir().join(format!(
            "kucheat-storage-{}-{}",
            std::process::id(),
            NEXT_WRITE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&directory).unwrap();
        let path = directory.join("config.toml");
        write_atomic(&path, b"first complete value").unwrap();
        write_atomic(&path, b"replacement").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"replacement");
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
        fs::remove_dir_all(directory).unwrap();
    }
}
