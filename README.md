# Kucheat

CHZZK live stream notifications for Linux, with a Tauri desktop interface, a headless daemon, and an optional system tray.

The interface supports Korean, English, Japanese, and Traditional Chinese (Taiwan) and follows [Microsoft Fluent 2](https://fluent2.microsoft.design/): neutral layered surfaces, blue accents, a system-font type ramp, keyboard navigation, and light, dark, and system themes. The TypeScript frontend is compiled and bundled locally without runtime frameworks or remotely hosted application assets. Streamer profile images load from NAVER's image CDN, with initials as a fallback.

## Prerequisites

### System Dependencies

The default build includes the Tauri GUI and requires GTK 3 and WebKitGTK 4.1 development packages. See the [Tauri Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux) for distribution-specific requirements.

```bash
# Ubuntu / Debian
sudo apt install build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev libdbus-1-dev

# Fedora
sudo dnf install gcc gcc-c++ make pkgconf-pkg-config gtk3-devel webkit2gtk4.1-devel dbus-devel

# Arch Linux
sudo pacman -S base-devel gtk3 webkit2gtk-4.1 dbus
```

The GUI, live monitor, notifications, and tray use the desktop session D-Bus. The tray uses StatusNotifierItem through `ksni`; the GUI does not require an AppIndicator library or a tray extension.

### Rust

Requires Rust **1.90+** (edition 2024).

### Frontend Toolchain

GUI development requires Node.js **24+** and npm. Install the pinned development dependencies once:

```bash
npm ci
# If npm is provided through Corepack:
corepack npm ci
```

Cargo runs the TypeScript compiler automatically before embedding the frontend. The installed application does not require Node.js or npm. A headless-only build does not require the frontend toolchain.

## Build

```bash
cargo build --locked --release

# Run the GUI from source.
cargo run --locked
```

For CLI and daemon use without GTK or WebKitGTK development packages:

```bash
cargo build --locked --release --no-default-features
```

A headless-only build retains all CLI commands except `gui`. Running it without a command reports that GUI support is disabled.

## Install

```bash
make install
```

This installs the binary, a desktop launcher, the icon, and the systemd user service under `~/.local` and `~/.config`. Open **Kucheat** from the desktop application menu or run `kucheat`.

Wayland taskbars resolve the icon through the installed `kucheat.desktop` launcher, not the WebView logo or GTK window icon alone. The launcher and `kucheat` icon are installed under `$XDG_DATA_HOME` (default `~/.local/share`), and available desktop/icon caches are refreshed. To repair desktop integration without rebuilding, replacing the binary, or changing the daemon:

`install-desktop` does not install or update the executable. It checks that the target exists and advertises GUI support before changing desktop files. If an old CLI-only binary remains in `~/.local/bin`, use `make install` to install the current GUI build, or point `INSTALL_BIN` at an existing GUI build as shown below.

```bash
make install-desktop
# Register a source-tree executable instead of ~/.local/bin/kucheat:
make install-desktop INSTALL_BIN="$(pwd)/target/release/kucheat"
```

Close and reopen the GUI after registration. Running an uninstalled source binary without its desktop entry can show the compositor's generic Wayland icon. `make uninstall-desktop` removes only the launcher and icon.

```bash
make uninstall
```

## Desktop Interface

```bash
kucheat
# Equivalent explicit command:
kucheat gui
```

- **Channels:** search CHZZK streamers by name and add a result, or enter a 32-character channel ID or HTTPS channel/live URL directly. Results include profile images, live status, follower counts, and existing registration status. The channel-library search box continues to filter only registered channels.
- **Live status:** show stream titles, categories, viewer counts, and check timestamps. Channels that have not been checked remain distinct from offline channels. Manual refresh requests a check from the active monitor.
- **Settings:** configure the check interval, offline notifications, optional API credentials, language, login autostart, and appearance. Send a test desktop notification to verify notification delivery.

The GUI monitors channels while its window is open. Closing the window exits the GUI; it does not hide in a potentially unavailable tray. Enable login autostart or the systemd daemon for notifications after the GUI closes.

The GUI also starts the system tray when the desktop supports StatusNotifierItem. A separate session D-Bus name allows only one Kucheat tray across GUI, daemon, and standalone tray processes. Other processes wait and take over when the tray owner exits. If the desktop tray host starts late or restarts, the icon is registered again. A missing tray host does not prevent the GUI or monitoring from running.

The GUI and CLI share the same configuration and state. A session D-Bus name ensures only one process monitors channels and sends notifications. An open GUI follows an existing daemon and takes over if it stops. A daemon started while the GUI owns monitoring waits for ownership. Starting the GUI again activates the existing window instead of opening another instance.

API secrets are write-only in the GUI. A blank secret field preserves the stored value; the explicit clear option removes it. Configuration and state files are replaced atomically with owner-only permissions. Credentials remain in the local TOML configuration, not an encrypted credential store.

### Language

Select **System**, **한국어**, **English**, **日本語**, or **繁體中文（台灣）** in Settings and save the form. Language changes apply without restarting the GUI, notification service, or tray. The same preference controls CLI output and application-authored help text. Date and viewer-count formatting follow the selected GUI locale. Channel names, stream titles, categories, and upstream OS/API/parser diagnostics retain their original text.

The default is `system`. The GUI selects the first supported language from the browser's system preferences; the CLI and native adapters use the first non-empty value of `LC_ALL`, `LC_MESSAGES`, `LANGUAGE`, and `LANG`. Colon-separated language lists select the first supported language. Unsupported languages fall back to English. Chinese system variants use Traditional Chinese (Taiwan).

## Wayland

GTK chooses the session backend. Kucheat does not force X11, use global window positioning, or replace native window decorations with WebView drag regions. To require native Wayland for a diagnostic run:

```bash
GDK_BACKEND=wayland kucheat gui
```

Window activation and focus remain subject to compositor policy. The GUI does not depend on a tray icon: GNOME installations without a StatusNotifierItem extension can still manage channels and receive desktop notifications. Fractional scaling uses the WebView's logical CSS pixels and responsive layout.

Run the application as the logged-in desktop user with the session D-Bus and Wayland socket available. Do not run it through `sudo`. A headless server can use the CLI, but desktop notifications require a notification service on its session bus.

## Configuration

A default config file is created on first run at `~/.config/kucheat/config.toml` (or `$XDG_CONFIG_HOME/kucheat/config.toml`):

```toml
[api]
client_id = ""
client_secret = ""

[settings]
# The accepted interval is 15 through 86400 seconds.
check_interval_secs = 60
notify_offline = false
language = "system"

[[channels]]
id = "0123456789abcdef0123456789abcdef"
name = "Streamer Name"
```

Live state is stored at `$XDG_STATE_HOME/kucheat/state.json`, normally `~/.local/state/kucheat/state.json`.

### CHZZK Open API Credentials

Register an application at the [CHZZK Developer Center](https://developers.chzzk.naver.com) and obtain a Client ID and Client Secret. The official API (`openapi.chzzk.naver.com`) is used for channel information lookups; the unofficial API is used for live status checks because the official API does not expose per-channel live state.

If credentials are left empty, only the unofficial API is used. Credential and monitoring-setting changes take effect without restarting the monitor. HTTP requests have a 5-second connection timeout and a 15-second overall timeout.

## CLI Usage

```bash
# Add a channel, resolving its name through the API.
kucheat add <CHANNEL_ID>
kucheat add <CHANNEL_ID> --name "Streamer Name"

# Remove, list, or inspect channels.
kucheat remove <CHANNEL_ID>
kucheat list
kucheat status
```

### Daemon (Systemd)

```bash
systemctl --user enable --now kucheat
systemctl --user status kucheat
journalctl --user -u kucheat -f
systemctl --user stop kucheat
```

The daemon also starts the optional tray. Tray availability does not control monitoring or notification delivery.

### Daemon (XDG Autostart)

The GUI's login autostart switch and these commands manage the same `~/.config/autostart/Kucheat.desktop` entry. It starts `kucheat daemon`, not the GUI. Choose either XDG autostart or systemd for login startup; both are not necessary.

```bash
kucheat auto-launch install
kucheat auto-launch uninstall
```

### System Tray

```bash
kucheat tray
```

The standalone tray reads persisted state. Live-channel submenus show stream titles and viewer counts, with links to the stream and channel page. Offline-channel submenus link to the channel page.

### Notifications

Live notifications provide **라이브 보기** and **채널 페이지** actions. Offline notifications are optional. The desktop notification service determines whether actions are displayed.

## Architecture

The Rust backend and TypeScript frontend use constructor-injected services, state objects, controllers, and adapters. Both are organized into `domain`, `application`, `infrastructure`, `presentation`, and `bootstrap` boundaries. GUI and CLI share native application services; platform effects stay behind traits or interfaces.

See [Application architecture](docs/architecture.md) for the directory map, object responsibilities, dependency rules, and guidance for extending behavior. The [frontend design contract](ui/DESIGN.md) documents Fluent 2 presentation and controller lifetimes.

## Tests

```bash
cargo test --locked --all-targets --all-features
cargo clippy --locked --all-targets --all-features

# Exercise D-Bus ownership and refresh IPC without affecting the desktop session.
dbus-run-session -- cargo test --locked --all-features dbus_monitor_has_one_owner_and_accepts_refresh -- --ignored
dbus-run-session -- cargo test --locked --all-features localized_notification_delivery -- --ignored
dbus-run-session -- cargo test --locked --all-features dbus_tray -- --ignored

# TypeScript type checking and frontend state/controller/transport tests.
npm run check
npm test

# Native GUI regression tests require a Wayland session, Python 3.11+,
# make, tauri-driver, WebKitWebDriver, and gdbus.
# The smoke test installs its launcher and icon into isolated XDG directories.
cargo build --locked
dbus-run-session -- python3 tests/wayland_smoke.py target/debug/kucheat

# Optionally verify an actual streamer's profile image (requires CHZZK/CDN access).
dbus-run-session -- python3 tests/wayland_smoke.py target/debug/kucheat --profile-channel-id <CHANNEL_ID>

# Optionally verify real streamer name search and adding a search result.
dbus-run-session -- python3 tests/wayland_smoke.py target/debug/kucheat --search-query "침착맨"
```

## License

Distributed under the [LICENSE](LICENSE)

## AI-Generated Code Notice

Parts of this project were created with assistance from AI tools (e.g. large language models). All AI-assisted contributions were reviewed and adapted by maintainers before inclusion. If you need provenance for specific changes, please refer to the Git history and commit messages.
