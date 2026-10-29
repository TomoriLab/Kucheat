use std::fs;
use std::path::PathBuf;
use std::process::{Command, Output};
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_TEST: AtomicU64 = AtomicU64::new(0);

struct Sandbox(PathBuf);

impl Sandbox {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "kucheat-cli-{}-{}",
            std::process::id(),
            NEXT_TEST.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(path.join("home")).unwrap();
        Self(path)
    }

    fn run(&self, arguments: &[&str]) -> Output {
        self.run_locale(arguments, "ko_KR.UTF-8")
    }

    fn run_locale(&self, arguments: &[&str], locale: &str) -> Output {
        Command::new(env!("CARGO_BIN_EXE_kucheat"))
            .args(arguments)
            .env("LC_ALL", locale)
            .env("HOME", self.0.join("home"))
            .env("XDG_CONFIG_HOME", self.0.join("config"))
            .env("XDG_STATE_HOME", self.0.join("state"))
            .env("XDG_DATA_HOME", self.0.join("data"))
            .env("RUST_LOG", "error")
            .output()
            .unwrap()
    }
}

impl Drop for Sandbox {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn cli_creates_configuration_and_preserves_channel_management() {
    let sandbox = Sandbox::new();
    let initial = sandbox.run(&["list"]);
    assert!(initial.status.success());
    assert!(String::from_utf8_lossy(&initial.stdout).contains("등록된 채널이 없습니다."));
    let path = sandbox.0.join("config/kucheat/config.toml");
    let initial: toml::Value = toml::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(
        initial["settings"]["check_interval_secs"].as_integer(),
        Some(60)
    );
    let content = format!(
        "{}\n[[channels]]\nid = \"0123456789abcdef0123456789abcdef\"\nname = \"테스트 채널\"\n",
        fs::read_to_string(&path)
            .unwrap()
            .replace("channels = []", "")
    );
    fs::write(&path, content).unwrap();
    let listed = sandbox.run(&["list"]);
    assert!(listed.status.success());
    assert!(String::from_utf8_lossy(&listed.stdout).contains("테스트 채널"));
    assert!(
        sandbox
            .run(&["remove", "0123456789abcdef0123456789abcdef"])
            .status
            .success()
    );
    let remaining: toml::Value = toml::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    assert!(remaining["channels"].as_array().unwrap().is_empty());
}

#[test]
fn invalid_channel_input_is_rejected_before_network_access() {
    let sandbox = Sandbox::new();
    let output = sandbox.run(&["add", "https://evil.example/invalid"]);
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("chzzk.naver.com"));
    assert!(!sandbox.0.join("config/kucheat/config.toml").exists());
}

#[test]
fn autostart_uses_the_daemon_subcommand() {
    let sandbox = Sandbox::new();
    let installed = sandbox.run(&["auto-launch", "install"]);
    assert!(installed.status.success(), "{:?}", installed.stderr);
    let path = sandbox.0.join("home/.config/autostart/Kucheat.desktop");
    let content = fs::read_to_string(&path).unwrap();
    assert!(content.contains("daemon"));
    assert!(!content.contains("--daemon"));
    assert!(sandbox.run(&["auto-launch", "uninstall"]).status.success());
    assert!(!path.exists());
}

#[test]
fn parallel_configuration_updates_preserve_other_fields() {
    let sandbox = Sandbox::new();
    assert!(sandbox.run(&["list"]).status.success());
    let path = sandbox.0.join("config/kucheat/config.toml");
    let mut config: toml::Value = toml::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    let identifiers: Vec<String> = (0..12).map(|value| format!("{value:032x}")).collect();
    config["channels"] = toml::Value::Array(
        identifiers
            .iter()
            .map(|identifier| {
                let mut channel = toml::map::Map::new();
                channel.insert("id".to_owned(), toml::Value::String(identifier.clone()));
                channel.insert("name".to_owned(), toml::Value::String("Channel".to_owned()));
                toml::Value::Table(channel)
            })
            .collect(),
    );
    config["api"]["client_secret"] = toml::Value::String("preserved-secret".to_owned());
    fs::write(&path, toml::to_string_pretty(&config).unwrap()).unwrap();
    std::thread::scope(|scope| {
        let handles: Vec<_> = identifiers
            .iter()
            .map(|identifier| {
                let sandbox = &sandbox;
                scope.spawn(move || sandbox.run(&["remove", identifier]))
            })
            .collect();
        for handle in handles {
            assert!(handle.join().unwrap().status.success());
        }
    });
    let remaining: toml::Value = toml::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    assert!(remaining["channels"].as_array().unwrap().is_empty());
    assert_eq!(
        remaining["api"]["client_secret"].as_str(),
        Some("preserved-secret")
    );
}

#[test]
fn cli_status_and_removal_do_not_overwrite_monitor_state() {
    let sandbox = Sandbox::new();
    assert!(sandbox.run(&["list"]).status.success());
    let path = sandbox.0.join("config/kucheat/config.toml");
    let content = fs::read_to_string(&path)
        .unwrap()
        .replace("channels = []", "");
    fs::write(&path, format!("{content}\n[[channels]]\nid = \"0123456789abcdef0123456789abcdef\"\nname = \"Channel\"\n")).unwrap();
    let state_path = sandbox.0.join("state/kucheat/state.json");
    fs::create_dir_all(state_path.parent().unwrap()).unwrap();
    let state = serde_json::json!({"channels": {"0123456789abcdef0123456789abcdef": {
        "is_live": false, "channel_name": "Channel", "live_title": null,
        "category": null, "viewer_count": null, "last_checked": "2025-09-18T00:00:00Z", "went_live_at": null
    }}});
    fs::write(&state_path, serde_json::to_vec(&state).unwrap()).unwrap();
    let original = fs::read(&state_path).unwrap();
    assert!(sandbox.run(&["status"]).status.success());
    assert_eq!(fs::read(&state_path).unwrap(), original);
    assert!(
        sandbox
            .run(&["remove", "0123456789abcdef0123456789abcdef"])
            .status
            .success()
    );
    assert_eq!(fs::read(&state_path).unwrap(), original);
}

#[test]
fn cli_localizes_system_language_and_help_without_creating_configuration() {
    for (locale, description, empty) in [
        (
            "ko_KR.UTF-8",
            "Linux용 CHZZK 라이브 알림",
            "등록된 채널이 없습니다.",
        ),
        (
            "en_US.UTF-8",
            "CHZZK live notifications for Linux",
            "No channels registered.",
        ),
        (
            "ja_JP.UTF-8",
            "Linux 向け CHZZK ライブ通知",
            "登録されているチャンネルはありません。",
        ),
        (
            "zh_TW.UTF-8",
            "Linux 版 CHZZK 直播通知",
            "尚未新增任何頻道。",
        ),
    ] {
        let sandbox = Sandbox::new();
        let help = sandbox.run_locale(&["--help"], locale);
        assert!(help.status.success(), "{:?}", help.stderr);
        assert!(String::from_utf8_lossy(&help.stdout).contains(description));
        assert!(!sandbox.0.join("config/kucheat/config.toml").exists());
        let output = sandbox.run_locale(&["list"], locale);
        assert!(output.status.success(), "{:?}", output.stderr);
        assert!(String::from_utf8_lossy(&output.stdout).contains(empty));
    }
}

#[test]
fn saved_language_overrides_system_and_unsupported_system_language_falls_back_to_english() {
    let sandbox = Sandbox::new();
    let output = sandbox.run_locale(&["list"], "fr_FR.UTF-8");
    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).contains("No channels registered."));
    let path = sandbox.0.join("config/kucheat/config.toml");
    let content = fs::read_to_string(&path)
        .unwrap()
        .replace("language = \"system\"", "language = \"zh-TW\"");
    fs::write(&path, content).unwrap();
    let output = sandbox.run_locale(&["list"], "en_US.UTF-8");
    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).contains("尚未新增任何頻道。"));
    let help = sandbox.run_locale(&["add", "--help"], "en_US.UTF-8");
    assert!(help.status.success());
    assert!(String::from_utf8_lossy(&help.stdout).contains("新增要監控的頻道"));
}
