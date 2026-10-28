# Kucheat frontend design contract

## Mission

Provide a compact Korean-language desktop interface for monitoring CHZZK channels and configuring native notifications. This is an operational application, not a dashboard or marketing page.

## Design system

The interface follows the supplied Fluent 2 direction: neutral layered surfaces, restrained brand accents, left navigation, compact controls, and native window decorations. Reference: https://fluent2.microsoft.design/.

- Color: brand `#0f6cbd`; light canvas `#f5f5f5`, surface `#ffffff`, primary text `#242424`; dark canvas `#1f1f1f`, surface `#292929`, primary text `#ffffff`. Semantic success, warning, and danger colors have separate dark variants.
- Typography: Segoe UI, system UI, Noto Sans CJK KR, sans-serif. Body 14px; secondary 12px; section 16px; page 24px. Line height is at least 1.4.
- Spacing: 4px base; 8, 12, 16, 20, 24, and 32px steps.
- Radius: controls 4px; surfaces and dialogs 8px. Status pills are fully rounded.
- Elevation: borders separate ordinary surfaces. Only dialogs and transient notifications use shadows.
- Motion: immediate hover feedback; 120ms control transitions; 180ms spring-like state entrances with a small capped list stagger. Reduced motion removes movement and transitions.
- Focus: a visible 2px focus ring with offset. Controls use semantic HTML and localized accessible names.

## Rules

- Keep the sidebar, monitoring state, and primary action easy to locate.
- Keep unknown channel state distinct from offline state.
- Wrap long names, titles, identifiers, and native error details without hiding layout defects.
- Preserve settings edits and focused controls during dashboard polling.
- Use native IPC for all native actions. Never open a user-supplied URL from the frontend.
- Never render supplied content as HTML or store credentials in localStorage.
- Do not add a simulated window titlebar, decorative gradients, decorative network assets, external fonts, or production dependencies. Channel profile images are content and may load only from HTTPS subdomains of `pstatic.net`.
- Do not show invented channels or claim browser-only notification support.

## Assumptions

- CHZZK channel identifiers are 32 hexadecimal characters. Accepted URLs use `chzzk.naver.com/<id>` or `chzzk.naver.com/live/<id>` with optional query strings or fragments.
- The native host owns monitoring and credential persistence. A dashboard mutation returns the authoritative dashboard.
- Closing the decorated native window exits the GUI. Monitoring can continue only while the GUI or the existing daemon is running.
- Theme is a local presentation preference. It is the only value persisted by this frontend.

## Architecture and public responsibilities

```text
ui/
  index.html
  styles.css
  src/
    domain/                    # Data contracts and pure rules.
    application/
      ports/                   # Desktop, presentation, and scheduler interfaces.
      state/                   # Dashboard, channel library, and settings draft objects.
      application-controller.ts
    infrastructure/
      tauri/                   # Native command contracts and queued transport adapter.
      browser/                 # Cancellable timer adapter.
    presentation/
      controllers/             # Channel, settings, shell, and feedback event handling.
      views/                   # Typed DOM references and rendering.
      dom/                     # Element creation and disposable event bindings.
    bootstrap/                 # Instance composition and pre-paint theme initialization.
  tests/
    *.test.ts                  # Direct test entry points required by the root test script.
    support/                   # Test-only dashboards, deferred requests, and injected fakes.
```

| Object or module | Public responsibility |
| --- | --- |
| `domain/types.ts`, `domain/rules.ts` | Preserve data and payload shapes. Validate channel/settings input, filter and count channels, normalize themes, and format display values without DOM or transport access. |
| `DesktopClient`, `TauriDesktopClient` | Define native operations independently of Tauri. The adapter receives a typed invoke function and serializes requests through a private per-instance queue that recovers after rejection. Only the composition entry point reads `window.__TAURI__`. |
| `DashboardState`, `ChannelLibrary`, `SettingsDraft` | Encapsulate authoritative dashboard/connection/busy state, search/filter/deletion selection, and editable settings respectively. Mutations use explicit methods. Draft values are copied on input and output. Polls preserve dirty or focused drafts; successful save and explicit reset hydrate authoritative values and clear replacement secrets. |
| `ApplicationController` | Start and dispose child controllers, coordinate rendering, gate operations, restore action focus, and schedule three-second polls through an injected scheduler. Lifetime generations ignore late completions after disposal/restart. Dashboard revisions prevent an older poll from overwriting a mutation or reporting a stale connection error. |
| `ChannelsController`, `SettingsController` | Bind user events, validate input, and coordinate their injected state, views, desktop client, and application action interface. Channel row actions use delegated events so keyed rows retain focus without persistent per-row listeners. |
| `ShellController`, `FeedbackController` | Handle navigation/theme events and toast/error events respectively. Feedback owns its cancellable six-second toast lifetime. Theme remains the only localStorage value. |
| View objects | Own typed DOM references and render operations, including keyed channel cards, dialogs and focus return, settings status, connection/monitor status, and safe text-only feedback. Views do not import native transport. |
| `ChannelAvatarView` | Render the profile URL supplied by native channel state. Load allowed CDN images lazily without a referrer, preserve initials until successful loading, and fall back on missing or failed images. Unchanged URLs are not reassigned during polling; stale image events cannot replace a newer profile. |
| `bootstrap/main.ts`, `bootstrap/theme.ts` | Compose instances and connect page lifetime events. The standalone theme script runs before CSS without importing modules, preserving pre-paint theme selection. |

Dependency flow is composition → controllers → application ports/state and domain rules. Infrastructure implements the ports; views render domain/state values. The application controller receives a child-controller factory so each child receives the same action interface without global state or late dependency assignment. Browser-only startup has no fabricated dashboard and keeps native controls disabled. Native IPC command names, payload casing, results, and write-only/null secret semantics remain unchanged.

## Verification

The authored frontend, build tool, and tests use strict TypeScript with no runtime dependencies. The compiler emits JavaScript before Node.js executes build tools and tests, so Node.js builds without native TypeScript stripping are supported. Install development dependencies with `npm ci` first.

```sh
npm run check
npm test
npm run build
```

The build emits browser modules into `target/frontend/` and copies the static HTML/CSS assets there. Source imports use explicit `.ts` extensions; TypeScript rewrites them to `.js`. The HTML references generated `src/bootstrap/main.js` and `src/bootstrap/theme.js`. Preview `target/frontend/index.html` after building, not the uncompiled source page. Tests cover the original validation and IPC contracts plus state isolation, settings draft preservation, FIFO client concurrency/recovery, polling, disposal/restart, and stale responses. Test fixtures remain under `ui/tests/`, which the asset copier excludes. Browser fixtures belong in the session scratch directory and are not shipped in `ui/`.
