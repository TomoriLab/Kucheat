use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::process::{Command, Output};
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_TEST: AtomicU64 = AtomicU64::new(0);

const GUI_EXECUTABLE: &[u8] = b"#!/bin/sh\n[ \"$1\" = --help ] || exit 99\nprintf 'Usage: kucheat [COMMAND]\\nCommands:\\n  gui    Open the desktop application\\n'\n";

struct DesktopInstallation {
    root: PathBuf,
    home: PathBuf,
    executable: PathBuf,
    data: PathBuf,
    explicit_data_home: bool,
}

impl DesktopInstallation {
    fn new(explicit_data_home: bool) -> Self {
        let root = std::env::temp_dir().join(format!(
            "kucheat-desktop-{}-{}",
            std::process::id(),
            NEXT_TEST.fetch_add(1, Ordering::Relaxed)
        ));
        let home = root.join("home with spaces");
        let executable = home.join(".local/bin/kucheat");
        let data = if explicit_data_home {
            root.join("xdg data")
        } else {
            home.join(".local/share")
        };
        fs::create_dir_all(executable.parent().unwrap()).unwrap();
        fs::write(&executable, GUI_EXECUTABLE).unwrap();
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o755)).unwrap();
        let service = home.join(".config/systemd/user/kucheat.service");
        fs::create_dir_all(service.parent().unwrap()).unwrap();
        fs::write(service, b"existing service").unwrap();
        let tools = root.join("tools");
        fs::create_dir_all(&tools).unwrap();
        for name in [
            "update-desktop-database",
            "gtk-update-icon-cache",
            "kbuildsycoca6",
        ] {
            let path = tools.join(name);
            fs::write(&path, format!(
                "#!/bin/sh\nprintf '%s\\n' '{name}' \"$@\" >> \"$DESKTOP_CACHE_LOG\"\nexit \"${{DESKTOP_CACHE_EXIT_CODE:-0}}\"\n"
            )).unwrap();
            fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
        }
        for name in ["cargo", "systemctl"] {
            let path = tools.join(name);
            fs::write(
                &path,
                b"#!/bin/sh\necho 'Unexpected binary or service modification' >&2\nexit 99\n",
            )
            .unwrap();
            fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
        }
        Self {
            root,
            home,
            executable,
            data,
            explicit_data_home,
        }
    }

    fn run(&self, target: &str, cache_exit_code: &str) -> Output {
        let mut command = Command::new("make");
        command
            .current_dir(env!("CARGO_MANIFEST_DIR"))
            .args(["--no-print-directory", target])
            .arg(format!("HOME={}", self.home.display()))
            .arg(format!("INSTALL_BIN={}", self.executable.display()))
            .env("HOME", &self.home)
            .env("XDG_CURRENT_DESKTOP", "KDE")
            .env("DESKTOP_CACHE_LOG", self.root.join("cache.log"))
            .env("DESKTOP_CACHE_EXIT_CODE", cache_exit_code)
            .env(
                "PATH",
                format!(
                    "{}:{}",
                    self.root.join("tools").display(),
                    std::env::var("PATH").unwrap()
                ),
            );
        if self.explicit_data_home {
            command.env("XDG_DATA_HOME", &self.data);
        } else {
            command.env_remove("XDG_DATA_HOME");
        }
        command.output().unwrap()
    }

    fn assert_binary_and_service_unchanged(&self) {
        assert_eq!(fs::read(&self.executable).unwrap(), GUI_EXECUTABLE);
        assert_eq!(
            fs::read(self.home.join(".config/systemd/user/kucheat.service")).unwrap(),
            b"existing service"
        );
    }
}

impl Drop for DesktopInstallation {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn desktop_registration_installs_matching_launcher_and_icon_without_replacing_the_application() {
    for explicit_data_home in [false, true] {
        let installation = DesktopInstallation::new(explicit_data_home);
        let output = installation.run("install-desktop", "0");
        assert!(output.status.success(), "{:?}", output);
        let launcher = installation.data.join("applications/kucheat.desktop");
        let content = fs::read_to_string(&launcher).unwrap();
        assert!(content.lines().any(|line| line == "Icon=kucheat"));
        assert!(content.lines().any(|line| line == "StartupWMClass=kucheat"));
        assert!(
            content
                .lines()
                .any(|line| line == format!("Exec=\"{}\"", installation.executable.display()))
        );
        assert_eq!(
            fs::metadata(&launcher).unwrap().permissions().mode() & 0o777,
            0o644
        );
        let icon = installation
            .data
            .join("icons/hicolor/512x512/apps/kucheat.png");
        assert_eq!(
            fs::read(&icon).unwrap(),
            include_bytes!("../assets/icons/kucheat.png")
        );
        let cache_log = fs::read_to_string(installation.root.join("cache.log")).unwrap();
        assert!(cache_log.contains("update-desktop-database"));
        assert!(cache_log.contains(installation.data.join("applications").to_str().unwrap()));
        assert!(cache_log.contains("gtk-update-icon-cache"));
        assert!(cache_log.contains("kbuildsycoca6\n--noincremental"));
        installation.assert_binary_and_service_unchanged();
        let output = installation.run("uninstall-desktop", "0");
        assert!(output.status.success(), "{:?}", output);
        assert!(!launcher.exists());
        assert!(!icon.exists());
        installation.assert_binary_and_service_unchanged();
    }
}

#[test]
fn optional_cache_refresh_failure_keeps_the_launcher_and_icon_installed() {
    let installation = DesktopInstallation::new(true);
    let output = installation.run("install-desktop", "1");
    assert!(output.status.success(), "{:?}", output);
    assert!(
        installation
            .data
            .join("applications/kucheat.desktop")
            .exists()
    );
    assert!(
        installation
            .data
            .join("icons/hicolor/512x512/apps/kucheat.png")
            .exists()
    );
    let diagnostics = String::from_utf8_lossy(&output.stderr);
    assert!(diagnostics.contains("Desktop database refresh failed"));
    assert!(diagnostics.contains("Icon cache refresh failed"));
    assert!(diagnostics.contains("KDE application cache refresh failed"));
    installation.assert_binary_and_service_unchanged();
}

#[test]
fn old_or_headless_executables_cannot_replace_a_working_desktop_registration() {
    let installation = DesktopInstallation::new(true);
    assert!(installation.run("install-desktop", "0").status.success());
    let launcher = installation.data.join("applications/kucheat.desktop");
    let previous_launcher = fs::read(&launcher).unwrap();
    let previous_cache_log = fs::read(installation.root.join("cache.log")).unwrap();
    let incompatible = b"#!/bin/sh\nprintf 'Usage: kucheat <COMMAND>\\nCommands:\\n  daemon    Run the daemon\\n'\n";
    fs::write(&installation.executable, incompatible).unwrap();
    let output = installation.run("install-desktop", "0");
    assert!(!output.status.success());
    assert!(
        String::from_utf8_lossy(&output.stderr)
            .contains("GUI-enabled Kucheat executable is required")
    );
    assert_eq!(fs::read(&launcher).unwrap(), previous_launcher);
    assert_eq!(
        fs::read(installation.root.join("cache.log")).unwrap(),
        previous_cache_log
    );
    assert_eq!(fs::read(&installation.executable).unwrap(), incompatible);
}

#[test]
fn a_missing_executable_is_rejected_before_any_desktop_files_are_created() {
    let installation = DesktopInstallation::new(true);
    fs::remove_file(&installation.executable).unwrap();
    let output = installation.run("install-desktop", "0");
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("Executable not found"));
    assert!(!installation.data.exists());
    assert!(!installation.root.join("cache.log").exists());
}

#[test]
fn desktop_registration_accepts_the_current_binary_only_with_gui_support() {
    let installation = DesktopInstallation::new(true);
    fs::copy(env!("CARGO_BIN_EXE_kucheat"), &installation.executable).unwrap();
    let output = installation.run("install-desktop", "0");
    assert_eq!(
        output.status.success(),
        cfg!(feature = "gui"),
        "{:?}",
        output
    );
    assert_eq!(
        installation
            .data
            .join("applications/kucheat.desktop")
            .exists(),
        cfg!(feature = "gui")
    );
}
