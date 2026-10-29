# Application architecture

Kucheat uses encapsulated objects, constructor injection, and composition rather than inheritance. Rust services own application behavior; TypeScript controllers and state objects own presentation behavior. Concrete adapters are assembled at the composition roots, not selected inside services.

## Directory map

```text
src/
  main.rs                         # Thin executable entry point.
  lib.rs                          # Library module boundary for direct service tests.
  bootstrap.rs                    # Native composition root and process startup.
  domain/
    channel.rs                    # Channel identifier and API-independent channel models.
    config.rs                     # Configuration values and validation.
    monitoring.rs                 # Monitor status model.
    state.rs                      # Persisted channel transition models.
  application/
    dto.rs                        # Presentation-safe inputs and snapshots.
    ports.rs                      # Side-effect contracts implemented by adapters.
    services/
      channels.rs                 # Registration, removal, status, and navigation.
      dashboard.rs                # Dashboard snapshot and manual refresh.
      settings.rs                 # Settings updates and desktop setting actions.
      monitoring.rs               # Polling and persisted live/offline transitions.
  infrastructure/
    chzzk/                        # HTTP client and gateway factory.
    dbus/                         # Monitor ownership, refresh IPC, and takeover runtime.
    desktop/                      # Notifications, browser launcher, and XDG autostart.
    persistence/                  # XDG paths, locking, atomic writes, and repositories.
  presentation/
    cli/                          # Argument parsing, output, and process orchestration.
    gui/                          # Tauri commands, window activation, and GUI startup.
    tray/                         # StatusNotifierItem menu and state observation.
ui/
  src/
    domain/                       # Typed contracts and pure presentation rules.
    application/
      ports/                      # Desktop, view, feedback, and scheduler interfaces.
      state/                      # Dashboard, channel library, and settings draft objects.
      application-controller.ts   # Polling, operations, and controller lifetime.
    infrastructure/
      tauri/                      # Typed command transport with a recoverable FIFO queue.
      browser/                    # Cancellable scheduler implementation.
    presentation/
      controllers/                # Channel, settings, shell, and feedback event handling.
      views/                      # Typed DOM rendering and focus management.
      dom/                        # DOM helpers and disposable event bindings.
    bootstrap/                    # Frontend composition and pre-paint theme startup.
  tests/
    support/                      # Injected frontend fakes and dashboard fixtures.
tests/
  application.rs                  # Native service integration test entry point.
  application/                    # Tests grouped by application service responsibility.
  support/                        # In-memory repositories and API/desktop fakes.
  cli.rs                          # CLI process tests with isolated XDG directories.
  wayland_smoke.py                 # Native WebView, IPC, UI, and process-handoff checks.
scripts/
  build-frontend.ts               # TypeScript compilation and static asset packaging.
```

## Dependency rules

- `domain` contains values, validation, and transition rules. It does not discover paths, access files, invoke desktop services, or import presentation modules.
- `application` depends on domain types and its own ports. It does not import infrastructure or presentation implementations.
- Infrastructure implements application ports. Its adapters own protocol details, filesystem behavior, and operating-system integration.
- Presentation translates user actions into service calls or renders application state. GUI and CLI reuse the same native services instead of implementing separate business rules.
- `src/bootstrap.rs` constructs native adapters and injects them into services. GUI, CLI, and tray entry objects receive the resulting dependencies. `ui/src/bootstrap/main.ts` performs equivalent frontend composition.
- Frontend application objects do not read the DOM, Tauri globals, or browser timers directly. Views and transport/scheduler adapters provide those operations. Only frontend bootstrap reads `window.__TAURI__`.
- Keep pure functions for validation, formatting, and small transformations. Do not introduce classes or traits solely to wrap a function that has no state, lifecycle, or replaceable side effects.

## Native object responsibilities

| Object | Responsibility and boundary |
| --- | --- |
| `ChannelId` | Validate and normalize a channel ID or supported URL before network or browser access. |
| `ChannelService` | Coordinate channel registration and gateway lookup. GUI registration rejects duplicates; CLI upsert preserves replacement behavior. Recheck duplicates inside the repository mutation after any slow API request. Status queries do not persist monitor-owned transitions. |
| `SettingsService` | Validate settings and mutate only settings/credentials in the latest configuration. Preserve channels and blank/null secrets; explicit clearing takes precedence. Request monitor refresh after a successful update. |
| `DashboardService` | Assemble registered channels, settings, desktop status, and monitor status. Distinguish unknown state from offline state. Expose credential presence, never the stored secret. |
| `MonitoringService` | Reload changed configuration, check channels, and own live/offline transition state. Persist a transition before delivering its notification. Restore the prior in-memory transition and suppress notification if persistence fails. |
| `MonitoringRuntime`, `MonitorLease` | Acquire one monitor name on the session bus, retain its lifetime, and retry ownership after another process exits. Keep D-Bus ownership separate from channel checking. |
| `FileConfigurationRepository` | Hold a process-shared file lock across loading the latest configuration, applying one mutation, and atomically replacing changed content. |
| `FileStateRepository` | Load and atomically replace monitor state without giving status/removal commands write ownership. |
| Desktop and CHZZK adapters | Implement the injected browser, notification, autostart, and channel gateway ports without placing platform details in services. |
| `GuiApplication`, `DesktopInstance` | Run Tauri on the main thread, start the optional tray independently of monitoring, delegate commands to application services, and activate the existing GUI instance through D-Bus. |
| `CliApplication`, `TrayApplication`, `TrayLease` | Format CLI results and orchestrate daemon/tray lifetimes. A session-wide tray lease prevents duplicate icons across GUI, daemon, and standalone tray processes. The tray observes watch snapshots or persisted state without owning channel checks. Its independent ksni service is shut down when the owner exits or is cancelled. |
| `LanguagePreference`, `NativeLocalizer` | Keep stable language tags in configuration, resolve system defaults without creating files, and supply complete native catalogs to CLI, notification, and tray adapters. Existing language settings are re-read for each native action. |

`ConfigurationRepository::update` is an atomic mutation contract, not an unrestricted overwrite operation. Implementations must apply the supplied mutation exactly once against the latest configuration. A failed mutation must not commit a partial change. This preserves concurrent CLI/GUI edits during network requests.

Notification ordering favors preventing replay across GUI/daemon handoff. A persisted transition is not retried when notification delivery fails; this does not guarantee successful or exactly-once desktop notification delivery.

## Frontend object responsibilities

| Object | Responsibility and boundary |
| --- | --- |
| `DashboardState` | Encapsulate the authoritative snapshot, loading/operation state, and connection errors. |
| `ChannelLibrary` | Own search, filter, and deletion selection independently of dashboard data. |
| `SettingsDraft` | Copy editable values on input/output, preserve dirty or focused edits across polls, and clear replacement secrets after successful save or reset. |
| `ApplicationController` | Coordinate child controllers, operations, rendering, and polling through injected interfaces. Generation and revision checks ignore late responses after disposal/restart or newer mutations. |
| Feature controllers | Bind and dispose events, validate input, and coordinate their state, views, desktop client, and shared application action interface. |
| View objects | Own typed DOM references, safe text rendering, keyed channel rows, dialogs, and focus restoration. Views never import the native transport. |
| `TauriDesktopClient` | Preserve command names and payload casing behind `DesktopClient`. Serialize requests through a private per-instance queue that recovers after a rejected request. |
| `BrowserScheduler`, `FeedbackController` | Provide cancellable polling/toast lifetimes so disposed controllers leave no active scheduled work. |

The frontend design and DOM contract are documented in [the frontend design contract](../ui/DESIGN.md). Fluent 2 styling, native window decorations, and the existing DOM IDs/classes remain presentation concerns, not service concerns.

## Compatibility boundaries

The Tauri command names and payload casing, TOML configuration schema, CLI subcommands, XDG paths, and D-Bus names remain stable. JSON state additions remain backward compatible. The GUI continues to use native Wayland through GTK and does not force X11 or require a tray extension. There are no new runtime or development dependencies for the architectural split.

Wayland taskbar identity requires an installed `kucheat.desktop` entry and its `kucheat` themed icon in the XDG data search path. An embedded window icon or matching source filename alone does not register the application with the desktop. `make install-desktop` registers the icon and launcher, then refreshes available GTK/GIO and KDE caches without rebuilding the binary or changing the service. Installation tests cover both default and explicit XDG paths; the native smoke suite compares the actual Wayland app ID against the installed entry and icon.

Channel state and dashboard snapshots include a nullable `channel_image_url`. Older state files without this field remain readable and receive profile URLs during the next successful monitoring check. Profiles use the existing channel-info response without additional API requests. `ChannelAvatarView` loads only HTTPS NAVER CDN images allowed by the native CSP and retains initials when an image is missing or fails to load.

Frontend source, tooling, and frontend tests remain strict TypeScript. Generated JavaScript belongs under `target/frontend/` or `target/tools/`, not in source directories. Cargo embeds compiled frontend assets only when the `gui` feature is enabled.

## Localization

The shared `settings.language` preference accepts `system`, `ko`, `en`, `ja`, and `zh-TW`. A missing field in an older TOML file defaults to `system`; an omitted or null field in an older settings command preserves the saved preference. Unknown explicit values are rejected before persistence. `ConfigurationRepository::load_existing` permits startup language selection and CLI help without writing a default configuration or acquiring a write lock.

Native language models live in `src/domain/localization.rs`, while catalogs and the injected `NativeLocalizer` live under `src/infrastructure/localization/`. Catalog fields are checked at compile time and interpolation variables are checked in tests. Streamer-provided values are inserted without recursively interpreting their braces as placeholders. Notification and tray viewer counts use comma-separated three-digit grouping, shared by all supported locales.

The frontend owns its injected localization object and complete language catalogs. Views and controllers request translated messages instead of embedding user-facing prose; HTML language, document titles, accessible attributes, and date/number formatting follow the selected locale. Application state and settings drafts remain independent of translated presentation. Language is persisted only through the native settings contract, not localStorage. OS/API/parser diagnostics and streamer content remain untranslated.

Native tests cover language serialization, legacy settings, catalog completeness, placeholder parity, CLI help/output, and actual notification messages over an isolated D-Bus. The Wayland smoke suite exercises all four GUI languages, settings persistence, localized validation, and matching CLI output.

## Adding or changing behavior

1. Put pure models and invariant checks in `domain`. Add service behavior to the responsible application service rather than to a command handler or view.
2. Reuse an existing port for side effects. Introduce a new port only when a distinct external responsibility needs substitution, then implement it under the matching infrastructure directory.
3. Wire concrete dependencies at bootstrap. Keep service constructor dependencies explicit and object-owned state private.
4. Add service tests using `tests/support/` or frontend tests using `ui/tests/support/`. Assert externally observable results and side-effect ordering, not only helper return values.
5. Preserve IPC and persistence contracts unless a separate migration is intended. Run the relevant process/native tests when changing those boundaries.

## Verification

The root [README test section](../README.md#tests) contains the complete desktop prerequisites and native smoke-test command. Core checks are:

```sh
cargo fmt --all -- --check
cargo test --locked --all-targets --all-features
cargo test --locked --all-targets --no-default-features
cargo clippy --locked --all-targets --all-features -- -D warnings
cargo clippy --locked --all-targets --no-default-features -- -D warnings
dbus-run-session -- cargo test --locked --all-features dbus_monitor_has_one_owner_and_accepts_refresh -- --ignored
npm run check
npm test
npm run build
```

Native service tests use in-memory repositories and fake gateways/desktop ports, so they do not contact CHZZK or require a desktop session. The separate D-Bus test requires an isolated session bus. Wayland smoke tests require a real Wayland session and verify the embedded frontend, IPC, settings/theme/dialog interaction, single-instance activation, launcher identity, and GUI-to-daemon handoff.
