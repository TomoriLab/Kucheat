# Kucheat frontend design contract

## Mission

Provide a compact desktop interface in Korean, English, Japanese, and Traditional Chinese (Taiwan) for monitoring CHZZK channels and configuring native notifications. This is an operational application, not a dashboard or marketing page.

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
- Theme is a local presentation preference and the only value stored in localStorage. Language is a shared native setting persisted through `save_settings`.

## Architecture and public responsibilities

```text
ui/
  index.html
  styles.css
  src/
    domain/                    # Data contracts and pure rules.
    localization/
      catalogs/                # Complete Korean, English, Japanese, and Taiwan Chinese messages.
      localizer.ts             # Injected locale selection, typed interpolation, and Intl formatting.
      locale.ts                # Pure system-language resolution.
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
| `domain/types.ts`, `domain/rules.ts` | Preserve data and payload shapes. Validate channel/settings input, filter and count channels using an explicit locale, and normalize themes without DOM or transport access. Display formatting belongs to the injected `Localizer`. |
| `DesktopClient`, `TauriDesktopClient` | Define native operations independently of Tauri. The adapter receives a typed invoke function and serializes dashboard/mutation requests through a private per-instance queue that recovers after rejection. Read-only discovery bypasses that queue. Only the composition entry point reads `window.__TAURI__`. |
| `DashboardState`, `ChannelLibrary`, `SettingsDraft` | Encapsulate authoritative dashboard/connection/busy state, search/filter/deletion selection, and editable settings respectively. Mutations use explicit methods. Draft values are copied on input and output. Polls preserve dirty or focused drafts. Save acknowledgment clears submitted replacement secrets but retains edits made after submission. Explicit reset restores authoritative settings, including language. |
| `ApplicationController` | Start and dispose child controllers, coordinate rendering, gate operations, restore action focus, and schedule three-second polls through an injected scheduler. Lifetime generations ignore late completions after disposal/restart. Dashboard revisions prevent an older poll from overwriting a mutation or reporting a stale connection error. |
| `ChannelsController`, `SettingsController` | Bind user events, validate input, and coordinate their injected state, views, desktop client, and application action interface. Channel row actions use delegated events so keyed rows retain focus without persistent per-row listeners. |
| `ShellController`, `FeedbackController` | Handle navigation/theme events and toast/error events respectively. Feedback owns its cancellable six-second toast lifetime. Theme remains the only localStorage value. |
| View objects | Own typed DOM references and render operations, including keyed channel cards, dialogs and focus return, settings status, connection/monitor status, and safe text-only feedback. Views do not import native transport. |
| `ChannelAvatarView` | Render the profile URL supplied by native channel state. Load allowed CDN images lazily without a referrer, preserve initials until successful loading, and fall back on missing or failed images. Unchanged URLs are not reassigned during polling; stale image events cannot replace a newer profile. |
| `bootstrap/main.ts`, `bootstrap/theme.ts` | Compose instances and connect page lifetime events. The standalone theme script runs before CSS without importing modules, preserving pre-paint theme selection. |

Dependency flow is composition → controllers → application ports/state and domain rules. Infrastructure implements the ports; views render domain/state values. The application controller receives a child-controller factory so each child receives the same action interface without global state or late dependency assignment. Browser-only startup has no fabricated dashboard and keeps native controls disabled. Native IPC command names, payload casing, results, and write-only/null secret semantics remain unchanged.

## Localization contract

- `Localizer` is constructed at the composition root and injected into the application controller, views, and action controllers. It owns no storage and has no global singleton. Its `t()` method requires catalog-defined keys and named interpolation parameters; `message()` returns deferred text for toasts and error contexts that must follow later language changes. `timestamp()`, `number()`, and `viewers()` use the resolved locale with `Intl`. Tests supply UTC for deterministic dates; the application uses the local timezone.
- `localization/catalogs/{ko,en,ja,zh-TW}.ts` contain complete messages. The English catalog defines the key and placeholder types. The other catalogs must satisfy the same key set, and tests verify identical placeholder sets and nonempty translations. Messages contain complete sentences or labels, not grammatical fragments assembled in code.
- The saved preference is `system`, `ko`, `en`, `ja`, or `zh-TW`. Older dashboards without `settings.language` use `system`. The system resolver checks `navigator.languages` in order, then `navigator.language`, normalizes underscores and region/encoding suffixes, and uses the first supported primary language. All Chinese variants resolve to `zh-TW`; unsupported preferences fall back to English. Explicit language settings override navigator preferences.
- `#language` is part of the settings draft. Saving uses the existing `save_settings.settings.language` field and immediately applies the returned authoritative preference. Omitting language from a programmatic settings payload preserves the native preference. Poll-driven locale changes and `languagechange` events rerender presentation without replacing dirty or focused settings. Failed saves leave the previous language active. Reset restores the saved selection.
- `LocalizedDocument` applies `data-i18n` text and localized attribute annotations, sets `document.documentElement.lang`, and updates only existing text nodes for controls containing icons or counters. The shell owns localized page titles. View renderers localize dynamic status, dialogs, placeholders, actions, and accessible labels. English HTML fallback does not replace the bundled logo or favicon.
- Domain validation and transport failures use `CodedError` values translated at presentation time. Native OS/API diagnostic strings and channel names, titles, categories, profile URLs, and avatar behavior remain unchanged. Interpolation and DOM rendering use literal text, never untrusted HTML. Theme behavior and pre-paint initialization are unchanged.

## Streamer discovery

- The add dialog contains an explicit streamer-name search (`#streamer-search`, `#search-streamers`) independent of the registered-library filter (`#channel-search`). Search Enter events are consumed without submitting the manual add form. The existing channel ID/URL, custom name, and confirm-add controls remain available; discovery never reads or overwrites their drafts.
- `domain/channel-search.ts` validates a trimmed query of 1–100 Unicode code points and integer offsets from 0 to 1,000. It validates response pages of at most 20 entries, normalizes channel IDs, and rejects nonprogressing or out-of-range continuation offsets. Invalid input and responses use localized `CodedError` values.
- `DesktopClient.searchChannels(query, offset = 0)` invokes `search_channels` with exactly `{query, offset}` and returns `{channels, next_offset}`. Each result contains `id`, `name`, `channel_image_url`, `is_live`, `follower_count`, and `registered`. This asynchronous read-only path handles missing bridges and synchronous transport throws without joining or blocking the dashboard/mutation FIFO. Discovery itself changes no dashboard, configuration, or persistent state.
- `StreamerSearchState` encapsulates the current query, request identity, results, continuation, error, and dialog lifetime. It appends pages with normalized-ID deduplication in first-seen order, retains successful pages when pagination fails, and retries the failed offset. Search response registration flags are reconciled when a newer dashboard arrives, including additions and removals.
- `StreamerSearchController` receives its state, view, desktop client, application actions, localizer, and dialog-close callback through its constructor. `ChannelsController` owns its start/dispose and dialog-open/close lifecycle. Query edits invalidate old pages immediately. Request identities and lifetime generations ignore late query, page, close/reopen, and disposal/restart completions. Search runs only on explicit submission; there are no debounce timers or localStorage writes.
- `StreamerSearchView` and `StreamerSearchResultView` own typed DOM references and keyed result rows. `#streamer-search-status` announces loading, empty, failure/retry, and result counts; `#streamer-search-more` requests the next page. Rows use `.streamer-search-result`, `data-channel-id`, and `data-search-add`. Names remain literal text, profile images reuse `ChannelAvatarView` and its HTTPS `*.pstatic.net` allowlist, and provided follower counts use locale-aware number formatting. Pagination retains existing controls and restores pagination focus when the webview blurs a disabled button.
- Result Add actions use the existing `add_channel` command with the normalized ID and `name: null`, allowing the native host to fetch the authoritative name. The existing application operation gate prevents concurrent mutations, disables search during global actions, applies the returned dashboard, and closes the dialog only after success. Already registered entries remain disabled. Failed additions preserve results and manual drafts and use the existing inline add error area. All new text and accessible labels have Korean, English, Japanese, and Traditional Chinese (Taiwan) catalog entries.

## Verification

The authored frontend, build tool, and tests use strict TypeScript with no runtime dependencies. The compiler emits JavaScript before Node.js executes build tools and tests, so Node.js builds without native TypeScript stripping are supported. Install development dependencies with `npm ci` first.

```sh
npm run check
npm test
npm run build
```

The build emits browser modules into `target/frontend/` and copies the static HTML/CSS assets there. Source imports use explicit `.ts` extensions; TypeScript rewrites them to `.js`. The HTML references generated `src/bootstrap/main.js` and `src/bootstrap/theme.js`. Preview `target/frontend/index.html` after building, not the uncompiled source page. Tests cover validation and IPC contracts, state isolation, draft preservation, FIFO client concurrency/recovery, polling/disposal, stale responses, profile image behavior, locale resolution, catalog keys/placeholders, interpolation, locale formatting, and language persistence. Test fixtures remain under `ui/tests/`, which the asset copier excludes. Browser fixtures belong in the session scratch directory and are not shipped in `ui/`.
