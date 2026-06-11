# FFN Enhancements - Agent Orientation Guide

> Jumpstart reference for AI agents in repo.
> Captures architecture, conventions, gotchas, patterns
> needing non-trivial investigation. Update when learn
> new or change fundamental.

---

## Agent Instruction Entrypoints

`AGENTS.md` exists at the repository root as the first-hop instruction file
for agents that discover repo guidance through that convention. Keep it
short and point it here.

This file (`.claude/CLAUDE.md`) is the canonical, detailed guide. Update this
file when architecture, build, browser, testing, or workflow gotchas change.
If a tool reads only `AGENTS.md`, it should be directed here rather than
duplicating guidance in two places.

---

## Conventions

Follow best software engineering + UX/UI conventions. Favor modular, scalable, maintainable, readable, correct, well-documented code. Fix bugs at root. Build features future-proof. Avoid bandaids/hacks unless env-constrained. Be liberal with GOTCHAs + TODOs for future devs. Update tests alongside code. No non-ASCII anywhere — avoid encoding errors.

---

## 1. What This Project Is

**Manifest V3 browser extension** (Chrome + Firefox) enhancing FanFiction.net for readers + authors. Migrated from Tampermonkey userscript for zero-FOUC theme injection via native `manifest.json` `content_scripts.css`.

Runs on `https://www.fanfiction.net/*` + `https://archiveofourown.org/*`.

Store distribution: Chrome Web Store + Firefox Add-ons (AMO). Load unpacked from `dist/` for dev.

**In-scope pages:**

| Path | Module | Audience |
|---|---|---|
| `/s/*` | `StoryReader` + `StoryDownloader` | Readers |
| `/docs/docs.php` | `DocManager` | Authors |
| `/docs/edit.php` | `DocEditor` | Authors |
| `/story/story_edit_content.php` | `StoryEditContent` | Authors |
| FFN all pages | `SettingsManager`, `SettingsIconHijacker`, `ThemeManager`, `LayoutManager` | Everyone |
| AO3 all pages | `Ao3Bridge` | Migrating authors |

---

## 2. Build System

```bash
npm run build   # tsc && vite build  (TypeScript check + bundle)
npm run dev     # vite build --watch  (rebuild on file changes)
npm test        # vitest run -v
npm run lint    # ESLint (includes no-unsanitized plugin for innerHTML safety)
```

- TypeScript strict (`strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true`).
- Vite single-entry builds (3 entry points, no shared chunks):
  - `content/main.js` — main content script (all modules)
  - `content/prelude.js` — document-start theme prelude (<1 KB)
  - `background/service-worker.js` — service worker (fetch proxy, tab mgmt)
- Each entry built as IIFE to avoid classic-script `import` errors in
  content scripts + Firefox event-page background. Single-entry builds
  force Rollup to inline every static import — no cross-bundle chunks.
- `build.minify: 'esbuild'` + `build.target: 'es2020'` for prod.
- `esbuild.charset: 'ascii'` — first line of defense against non-ASCII
  bytes in bundles. `scripts/sanitize-dist.mjs` post-build scanner is the
  second safety net (Firefox can reject extensions with non-ASCII in scripts).
- `emptyOutDir: true` — dist/ fully regenerated each build.
- Static assets (manifest.json, CSS, icons) live in `extension/`,
  copied to `dist/` by `copyDirRecursive()` in `build-all.mjs` post-bundle.
- `modulePreload: false` — extension content scripts no support module preload.
- Target-specific output dirs: `dist-chrome/` + `dist-firefox/`.
  `FFNE_TARGET` env var picks target (`chrome` or `firefox`).
- `patchManifest()` in `scripts/manifest-utils.mjs` handles target-specific tweaks:
  - **Chrome:** Strips `browser_specific_settings` (CWS rejects).
  - **Firefox:** Event-page `background.scripts` only — no
    `service_worker`, no `type: "module"` (see Gotcha #15).

### 2.1 Settings Modal Flow

Settings modal opened by clicking FFN's native `.icon-kub-mobile` gear icon
in the nav bar. `SettingsIconHijacker` (registered as sitewide module) hijacks
this icon at `prime()` (via `MutationObserver`) or `init()` (direct DOM query),
replacing its click handler with `SettingsPage.openModal()`.

No more Tampermonkey `GM_registerMenuCommand`, no more extension popup
(`src/popup/` removed), no more `chrome.action.onClicked` listener or
`chrome.permissions.request` prompt in the service worker. Manifest uses
`host_permissions` (not `optional_host_permissions`) — content scripts load
automatically on install, no first-click permission grant needed.

The gear icon gets a tooltip ("FFN Enhancements settings") via an attached
shadow-DOM span, and clicking it opens the in-page settings modal.

**GOTCHA:** `SettingsIconHijacker` depends on FFN's `.icon-kub-mobile` element
existing in the DOM. If FFN changes its nav bar markup, the MutationObserver
timeout (5s post-DOMContentLoaded) will disconnect and settings access will
require a fallback. The `prime()` `MutationObserver` watches
`document.documentElement` with `{ childList: true, subtree: true }` to catch
late icon injection.

---

## 3. Platform Abstraction Layer

All browser-extension APIs accessed through thin wrappers in `src/platform/`:

### 3.0 Extension API (`src/platform/extensionApi.ts`)

Lowest-level abstraction over `chrome.*` (callback-based) vs Firefox
`browser.*` (Promise-based) APIs. Detects which is available and wraps
callbacks in Promises when only `chrome.*` exists.

```typescript
import { extensionApi } from '../platform/extensionApi';

// All methods return Promises, works identically on Chrome + Firefox.
await extensionApi.storage.local.get('key');
await extensionApi.storage.local.set({ key: 'value' });
await extensionApi.runtime.sendMessage({ type: 'foo' });
extensionApi.runtime.onMessage.addListener(handler);
extensionApi.storage.onChanged.addListener(handler);
```

Used internally by `platformStorage`, `messaging`, `tabs`, and
`service-worker.ts`. Module code should use the higher-level platform
wrappers (storage, messaging, tabs), not `extensionApi` directly.

### 3.1 Storage (`src/platform/storage.ts`)

```typescript
import { platformStorage } from '../platform/storage';

// Sync read from localStorage (document-start safe).
const theme = platformStorage.get('theme');

// Async write to localStorage + chrome.storage.local.
await platformStorage.set('theme', 'dark');

// Async remove from both stores.
await platformStorage.remove('someKey');

// Cross-tab sync listener. Returns unsubscribe function.
const unsub = platformStorage.onChanged((key, newValue, oldValue) => {
    // fires for remote changes only (local writes are guarded).
});

// Hydrate localStorage from chrome.storage.local (used at startup).
const hydrated = await platformStorage.hydrateFromPersistentStorage();
```

- All keys use `ffne_` prefix (added internally by platformStorage).
- `get()` reads from localStorage (sync, available at document-start).
- `set()` writes localStorage (sync) + `chrome.storage.local` (async persist).
- `hydrateFromPersistentStorage()` copies all `ffne_*` keys from
  `chrome.storage.local` → `localStorage`. Called by `SettingsManager.prime()`
  on FFN and `Ao3Bridge.init()` on AO3 to seed localStorage before any sync
  reads.
- `onChanged()` wraps `chrome.storage.onChanged` with local-write guard
  (200ms timestamp window) — prevents double subscriber notification.
- Bridge keys (`ao3_bridge_*`) use same prefix — do NOT include `ffne_` in
  key constants.

### 3.2 Messaging (`src/platform/messaging.ts`)

```typescript
import { backgroundFetch } from '../platform/messaging';

// Cross-origin fetch via service worker (bypasses CORS/CSP).
const response = await backgroundFetch({
    url: 'https://fichub.net/api/...',
    method: 'GET',
    responseType: 'text',  // or 'blob' for binary
    timeout: 60000,
});
// response: { ok, status, data: string|Blob|null, finalUrl, error? }
```

- `backgroundFetch()` never throws — errors in `response.error`.
- Service worker handles `CrossOriginFetchMessage` by `fetch()` with
  full granted host access (no CORS restrictions).
- Blob responses converted `number[]` → `Uint8Array` → `Blob` → base64
  (JSON-safe messaging; `bytesToBase64` in `src/utils/base64.ts`).

### 3.3 Tabs (`src/platform/tabs.ts`)

```typescript
import { openTab } from '../platform/tabs';
await openTab('https://archiveofourown.org/', true);
```

- Delegates to service worker via `OPEN_TAB` message.
- Falls back to `window.open()` if messaging fails.

### 3.4 Message Types (`src/background/message-types.ts`)

Shared type definitions for content-script <-> service-worker comms.
Used by platform layer + service worker. Keep in sync with `service-worker.ts` handler.

---

## 4. Core Architecture Patterns

### 4.1 Module-as-Object-Literal

All modules = plain object literals exported as `const`. No classes.

```typescript
export const MyModule = {
    MODULE_NAME: 'my-module',     // used for logging
    init: function () { ... },
    doThing: function () { ... },
};
```

`this` works inside these objects when methods called as
`MyModule.doThing()`. Careful when passing methods as callbacks — use
`.bind(this)` or arrow wrappers if needed.

### 4.2 Two-Phase Boot via `EarlyBoot` + `ISitewideModule`

Sitewide modules (run on every FFN page, not one route)
implement `ISitewideModule`:

```typescript
export interface ISitewideModule {
    prime(): void;   // Phase 1: document-start (before HTML is parsed)
    init(): void;    // Phase 2: DOMContentLoaded (DOM fully ready)
}
```

Registration in `bootstrap.ts` → `registerSitewideModules()`:

```typescript
// FFN-only — AO3 registers no sitewide modules.
EarlyBoot.register(SettingsManager);        // MUST be first
EarlyBoot.register(SettingsIconHijacker);   // MUST be after SettingsManager
EarlyBoot.register(ThemeManager);           // MUST be after SettingsManager, before LayoutManager
EarlyBoot.register(LayoutManager);          // MUST be after ThemeManager
```

Registration order = execution order. Required order:

1. `SettingsManager` - load all settings into cache before reads.
2. `SettingsIconHijacker` - hijack FFN's `.icon-kub-mobile` gear icon for settings modal access; after SettingsManager to check settings.
3. `ThemeManager` - reads `theme` setting, injects CSS vars + component styles at `prime()` to prevent FOUC; before LayoutManager so token vars available.
4. `LayoutManager` - reads `fluidMode` in `prime()` to prevent FOUC; after ThemeManager so fluid CSS layers over theme tokens.

**Phase 1 rules:** `prime()` runs synchronously at `document-start`. No
read `document.body` or `document.head` (not guaranteed exist yet). Safe
ops: inject `<style>` on `document.documentElement`, arm `MutationObserver`,
call sync functions.

**Phase 2 rules:** `init()` runs at `DOMContentLoaded`. All DOM ops
safe.

Programmatic reinjection re-runs `prelude.js` + `main.js`. Keep both guarded
by bootstrap flags (`__ffnePreludeBootstrapped`,
`__ffneContentBootstrapped`) so already-primed tabs no accumulate duplicate
style tags or listeners.

### 4.3 Bootstrap Flow (`src/bootstrap.ts`)

`installBootstrap()` replaces old `main.ts` flow. Three-stage:

1. `registerSitewideModules(hostname)` — FFN gets sitewide modules; AO3 gets none.
2. `primeSitewideModules(hostname)` — FFN calls `EarlyBoot.prime()` synchronously;
   AO3 skips (no sitewide modules registered).
3. Wait for `DOMContentLoaded`, then `bootstrap()`:
   - `Core.startup()` sets delegate.
   - AO3: `Ao3Bridge.init()` directly.
   - FFN: `EarlyBoot.init()` then `initActiveRoute(path)` for page-specific modules.

AO3 routing is host-based (not path-based) — any AO3 page gets `Ao3Bridge.init()`.

### 4.4 Delegate / Strategy Pattern (Page Objects)

FFN/AO3 DOM differs between pages. All CSS selector knowledge lives in
**Delegate** objects, never in module business logic.

```
src/delegates/
  IDelegate.ts              - interface: getElement(key, doc?), getElements(key, doc?)
  BaseDelegate.ts           - default no-op implementation (spread to inherit)
  GlobalDelegate.ts         - selectors present on every FFN page (header, wrapper, etc.)
  StoryDelegate.ts          - /s/* specific selectors
  DocManagerDelegate.ts     - /docs/docs.php specific selectors
  DocEditorDelegate.ts      - /docs/edit.php specific selectors
  StoryEditContentDelegate.ts - /story/story_edit_content.php specific selectors
  Ao3Delegate.ts            - AO3 page selectors
  LayoutManagerDelegate.ts  - fluid-mode element selectors
```

DOM keys defined in `src/enums/Elements.ts`. Add new key there first,
then implement in relevant delegate.

`Core.setDelegate({ pathname, hostname })` called in `Core.startup()`,
sets `Core.activeDelegate`. After, all modules call:

```typescript
Core.getElement(Elements.MY_KEY)      // single element (null on miss)
Core.getElements(Elements.MY_KEY)     // array (empty on miss)
```

`Core.getElement` tries active page-specific delegate first, falls back
to `GlobalDelegate` (chain of responsibility). AO3 uses `Ao3Delegate`.

### 4.5 Page-Specific Module Routing

`bootstrap()` → `initActiveRoute(path)` routes after `EarlyBoot.init()`:

```typescript
if (path === "/docs/docs.php")                       DocManager.init();
else if (path.includes("/docs/edit.php"))             DocEditor.init();
else if (path.includes("/story/story_edit_content.php")) StoryEditContent.init();
else if (path.startsWith("/s/"))                    { StoryReader.init(); StoryDownloader.init(); }
```

Page-specific modules no implement `ISitewideModule`. Single
`init()` entry point, called directly. AO3 routing is host-based — see 4.3.

### 4.6 Services Layer

Network + parsing + cross-origin concerns extracted into focused
services in `src/services/`:

- `ContentParser` - `TurndownService` instance, `parseHtmlFromPrivateDoc()`,
  `parseContentFromPrivateDoc()`. Consumed by `DocEditor` + `DocFetchService`.
- `DocFetchService` - `_fetchDocPage()`, `fetchAndConvertPrivateDoc()`,
  `fetchPrivateDocAsHtml()`, `refreshPrivateDoc()`. Consumed by `DocManager`.
- `CssScanner` - Runtime CSS scanner for FFN native element theming.
- `Ao3Service` - AO3 API service: `fetchChapterIndex()`, `updateChapterContent()`.
  Consumed by `Ao3Bridge` + `Ao3BridgeClient`.
- `Ao3BridgeClient` - FFN-side client that writes bridge requests to
  `platformStorage` and polls for AO3-side results. Consumed by `DocManager`
  for FFN→AO3 migration.
- `StoryReplaceService` - Same-origin fetch + form submission for
  `/story/story_edit_content.php` bulk chapter replacement. Consumed by
  `StoryEditContent`.

All services import `Core` for `getElement`/`getLogger` — no circular deps.

---

## 5. Settings System

### 5.1 SettingsManager (`src/modules/SettingsManager.ts`)

Central key-value store backed by `chrome.storage.local` + `localStorage` mirror
(via `platformStorage`).

- `FFNSettings` interface defines full schema with types.
- `DEFAULTS` object provides fallbacks for first-time users.
- Storage prefix: `ffne_` (added by `platformStorage` internally).
- In-memory cache (`_cache`) populated in `prime()`, used for all reads.
  Reads sync + cheap (from `localStorage` via `platformStorage.get()`).
- `_loadAll()` validates enum values on load — guards stale storage.
- `prime()` calls `platformStorage.hydrateFromPersistentStorage()` to sync
  chrome.storage.local → localStorage before populating cache.

**API:**
```typescript
SettingsManager.get('docDownloadFormat')      // -> DocDownloadFormat (sync)
SettingsManager.get('fluidMode')              // -> boolean (sync)
await SettingsManager.set('docDownloadFormat', DocDownloadFormat.HTML)  // async!
await SettingsManager.set('fluidMode', false)

// Subscribe to changes (returns unsubscribe fn)
const unsub = SettingsManager.subscribe('fluidMode', (newVal, oldVal) => { ... });
unsub(); // remove listener
```

**`subscribe()` pub-sub API:**
- `subscribe(key, cb)` returns unsubscribe function.
- Fires for local changes (`set()`) + remote changes (cross-tab via
  `chrome.storage.onChanged`).
- Internal storage: `Map<string, Set<(unknown, unknown)=>void>>`.
- Subscriber errors caught individually.

**Cross-tab sync (`chrome.storage.onChanged`):**
- Single listener registered in `prime()` via `platformStorage.onChanged()`.
- `platformStorage` handles local-write guard (200ms timestamp window) so
  same-tab changes no double-fire subscribers.

**Add new setting:**
1. Add field + type to `FFNSettings` interface.
2. Add default to `DEFAULTS`.
3. Add one-liner in `_loadAll()`: `_loadBool(key)`, `_loadEnum(key, EnumObj)`, or `_loadPositiveNumber(key)`.
4. Automatic: `_registerOnChangedListener()` handles all keys via single
   `chrome.storage.onChanged` listener.
5. Add control row in `SettingsPage.ts` (see checklist Section 11).

### 5.2 SettingsIconHijacker (`src/modules/SettingsIconHijacker.ts`)

Hijacks FFN's native `.icon-kub-mobile` gear icon in the nav bar.
Registered as sitewide module (after SettingsManager).

- **`prime()`:** Tries to bind icons already in DOM. If none found, arms
  `MutationObserver` on `documentElement` with `{ childList: true, subtree: true }`
  to catch late injection.
- **`init()`:** Falls back to direct query if `prime()` didn't find the icon.
- Observer auto-disconnects 5s after `DOMContentLoaded` to avoid perpetual
  DOM watching.
- Each hijacked icon gets attribute `data-ffne-hijacked="1"` to prevent
  double-binding.
- Click handler sets `event.preventDefault()` + `stopImmediatePropagation()`
  and calls `SettingsPage.openModal()`.
- Attaches a shadow-DOM tooltip ("FFN Enhancements settings") via
  `markFfneUiRoot()` wrapper next to the icon.

**Why hijack instead of register menu command:**
The Tampermonkey `GM_registerMenuCommand` approach required userscript context.
As a native MV3 extension without popup, hijacking an existing FFN UI element
provides settings access without needing a popup HTML file or service-worker
`action.onClicked` handler.

### 5.3 SettingsPage (`src/modules/SettingsPage.ts`)

Modal settings UI injected into `document.body` on current FFN page.
Opened via `SettingsPage.openModal()`, dismissed via `closeModal()` (x button,
backdrop click, or ESC key).

**No URL interception:**
No `?ffne_settings=1` URL or routing intercept in `bootstrap.ts`. Modal
runs entirely in current tab context — no server request, no nav.

**Styling:**
Self-contained styles injected into `document.head` on first open (guarded by
`#ffne-settings-styles` ID — prevents duplicates). Uses FFN colour palette
(`#336699` navy, `#f0f4f8` header bg) + Verdana/Arial for visual consistency.

**Save-on-change UX:**
Changes persisted immediately via `SettingsManager.set()` on `input/change`
events. Per-row "+" flash indicator (`_flashSaved()`) confirms each save.

**Cross-tab sync:**
`_registerSubscriptions()` registers `SettingsManager.subscribe()` callbacks for
every setting, returns unsubscribe functions. `closeModal()` calls all
unsubscribers — prevents accumulation across multiple open/close cycles.

**`NUMERIC_KEYS` constant:**
Drives bulk wiring of numeric `<input type="number">` controls. Must stay synced
with numeric fields in `FFNSettings`. Adding new numeric setting requires:
1. Add key to `NUMERIC_KEYS` in `SettingsPage.ts`.
2. Subscribe loop in `_registerSubscriptions()` handles automatically.

**Sections:**
| Section | Settings |
|---|---|
| Appearance | `fluidMode` |
| Document Export | `docDownloadFormat` |
| Reader | `scrollStep` |
| Advanced (collapsible) | `fetchMaxRetries`, `fetchRetryBaseMs`, `iframeLoadTimeoutMs`, `iframeSaveTimeoutMs`, `bulkExportDelayMs`, `bulkCooldownMs`, `bulkRetryDelayMs` |

**GOTCHA:** `openModal()` appends to `document.body` — safe any time after
`DOMContentLoaded`. Must NOT be called from `prime()` (document-start, body may
no exist). SettingsIconHijacker's click handler only fires after user interaction,
always post-DOMContentLoaded — naturally satisfied.

**GOTCHA:** Always call `closeModal()` to clean up subscriptions + ESC key
listener. Removing backdrop element alone leaves listeners dangling.

---

## 5b. Theme System

### Architecture

All colors flow through **CSS custom properties** (`--ffne-*`).
Defaults defined in `src/styles/ThemeTokens.ts`. Theme token CSS files
(`theme-tokens-light.css`, `theme-tokens-dark.css`, `theme-tokens-sepia.css`,
`theme-tokens-hc.css`) are injected via manifest `content_scripts.css` at
`document_start` — zero FOUC, no JavaScript needed for initial token delivery.
`critical-theme.css` (also manifest-injected) provides page-chrome and
native FFN element overrides gated by `html.ffne-theme-*` classes.

`ThemeManager.prime()` sets the `html.ffne-theme-<name>` class, which activates
the appropriate theme token block. All CSS files consume via `var(--ffne-*)`.

**Token categories:**
- `--ffne-brand-*` (FFN navy palette)
- `--ffne-semantic-*` (success/error/warning/running)
- `--ffne-ui-*` (surfaces, text levels, borders, toggles)
- `--ffne-shadow-*` (modal, overlay, toast, etc.)
- `--ffne-ui-text-on-accent` (always light text for colored backgrounds)

**GOTCHA:** `--ffne-ui-white` maps to surface color (dark in dark theme).
Do NOT use for text on colored backgrounds (modal headers, toasts, badges).
Use `--ffne-ui-text-on-accent` instead.

### ThemeManager (`src/modules/ThemeManager.ts`)

Implements `ISitewideModule`. Registered in EarlyBoot between SettingsIconHijacker +
LayoutManager.

**Phase 1 (`prime()`):** Injects component CSS, applies HTML class
(`ffne-theme-<name>`), sets `color-scheme`. Token CSS already present from
manifest injection; `prime()` only activates right theme class. Prevents FOUC.

**Phase 2 (`init()`):** Runs `CssScanner` to generate FFN native element
overrides, subscribes to theme setting changes, watches `prefers-color-scheme`
for SYSTEM mode, arms `MutationObserver` for TinyMCE iframe theming.

**Public API:**
- `setTheme(theme: Theme)` - switch theme (persists via SettingsManager)
- `getResolvedTheme(): Theme` - resolves `SYSTEM` to actual `LIGHT`/`DARK`

### CssScanner (`src/services/CssScanner.ts`)

Runtime CSS scanner (Dark Reader-style). Reads `document.styleSheets`, extracts
color-related properties, maps via theme's `colorMap`, generates
scoped override CSS under `html.ffne-theme-<name>`.

- Skips own `<style>` tags (ID prefix `ffne-`/`ffe-`/`ffn-enhancements`)
- Handles `@media`/`@supports` grouping rules
- Preserves `!important` + alpha channels
- Caches results per page/theme combination

### Theme Definitions (`src/themes/`)

Each theme implements `IThemeDefinition`:
- `tokens` - CSS var overrides for injected UI
- `colorMap` - FFN color remapping table for scanner
- `isDark` - controls `color-scheme` property

Available themes: `SYSTEM` (auto), `LIGHT`, `DARK`, `SEPIA`, `HIGH_CONTRAST`.

Adding new theme:
1. Create `src/themes/MyTheme.ts` implementing `IThemeDefinition`.
2. Add entry to `src/themes/index.ts` (`THEME_DEFINITIONS`).
3. Add value to `src/enums/Theme.ts`.
4. Add option to `SettingsPage._buildModalHTML()` Appearance section.
5. Create `extension/styles/theme-tokens-my-theme.css` with the theme's
   `:root` token block gated by `html.ffne-theme-my-theme`.
6. Add CSS file to `content_scripts.css` array in `extension/manifest.json`.

### CSS Files

**Module CSS** (`src/styles/`, imported via `?raw`, injected as `<style>` tags):
- `settings-modal.css` - settings UI
- `fluid-mode.css` - fluid layout overrides
- `components.css` - shared components (cover modal, dropdown, toast, Ao3 panel, status classes)
- `doc-manager.css` - DocManager modals, drawer, table
- `story-edit-content.css` - StoryEditContent bulk replace UI
- `native-overrides.css` - FFN native element overrides (fallback for cross-origin CSS)

**Extension CSS** (`extension/styles/`, injected via manifest `content_scripts.css`):
- `theme-tokens-{light,dark,sepia,hc}.css` - Per-theme `:root` token blocks
- `critical-theme.css` - Zero-FOUC page chrome + native FFN element overrides
- `fluid-mode.css` - Fluid layout (gated by `.ffn-enhancements-fluid-mode` class)

---

## 6. Doc Download Feature

Author docs (from FFN doc manager/editor) export as
Markdown (default), HTML, or DOCX. Format controlled by
`docDownloadFormat` setting.

### DOCX conversion

DOCX path converts HTML -> OOXML via `DocxBuilder.build(html, title)`.
Reuses existing `fetchPrivateDocAsHtml()` / `parseHtmlFromPrivateDoc()`
paths — no new fetch/parsing infra needed. `DocxBuilder` produces
valid Office Open XML archive (ZIP-wrapped) using available `JSZip`
library.

### Content extraction flow

1. `ContentParser.parseHtmlFromPrivateDoc(doc, title)` - reads raw HTML from
   TinyMCE `<textarea>` (`Elements.EDITOR_TEXT_AREA`). Returns `string | null`.
2. `ContentParser.parseContentFromPrivateDoc(doc, title)` - calls `parseHtmlFromPrivateDoc`,
   converts via Turndown. Returns Markdown `string | null`.
3. `DocFetchService._fetchDocPage(docId, title)` - internal shared fetch helper
   delegating to generic `fetchWithBackoff` utility for retry/backoff.
   Returns `Document | null`.
4. `DocFetchService.fetchAndConvertPrivateDoc(docId, title)` - fetches doc page,
   returns Markdown.
5. `DocFetchService.fetchPrivateDocAsHtml(docId, title)` - fetches doc page,
   returns raw HTML.

**Note:** Shared `fetchWithBackoff(url, options)` utility lives in
`src/utils/fetchWithBackoff.ts`, used by `DocFetchService._fetchDocPage` +
`NativeDownloader._fetchChapter`. Centralizes retry count, delay strategy,
429 handling in one place.

### Format-aware download in modules

Both `DocManager.runSingleExport`, `DocManager.runBulkExport`, +
`DocEditor.exportCurrentDoc` follow same pattern:

```typescript
const format = SettingsManager.get('docDownloadFormat');
if (format === DocDownloadFormat.DOCX) {
    const html = ContentParser.parseHtmlFromPrivateDoc(doc, title); // or DocFetchService.fetchPrivateDocAsHtml
    const blob = await DocxBuilder.build(html, title);
    saveAs(blob, `${title}.docx`);
} else if (format === DocDownloadFormat.HTML) {
    const html = ContentParser.parseHtmlFromPrivateDoc(doc, title); // or DocFetchService.fetchPrivateDocAsHtml
    saveAs(new Blob([html], { type: "text/html;charset=utf-8" }), `${title}.html`);
} else {
    const md = ContentParser.parseContentFromPrivateDoc(doc, title); // or DocFetchService.fetchAndConvertPrivateDoc
    saveAs(new Blob([md], { type: "text/markdown;charset=utf-8" }), `${title}.md`);
}
```

**`DocDownloadFormat` enum values ARE file extensions** (`'md'`, `'html'`),
so `${title}.${format}` produces correct filename directly.

**`StoryReader` / `StoryDownloader` NOT affected** by this setting —
use FicHub integration + `NativeDownloader`, reader-facing, outside
doc-download scope.

---

## 7. AO3 Bridge System (FFN→AO3 Migration)

Cross-origin bridge enabling `DocManager` on FFN to migrate story chapters to AO3.
Uses `chrome.storage.local` as communication channel (both origins share same
extension storage).

### Architecture

```
FFN (DocManager)                          AO3 (Ao3Bridge)
      │                                         │
      │  write request to                       │
      │  platformStorage ───chrome.storage───►  │  poll + process
      │                                         │
      │  poll for result ◄──chrome.storage────  │  write result
      │                                         │
```

### FFN side: `Ao3BridgeClient` (`src/services/Ao3BridgeClient.ts`)

- Writes `Ao3BridgeRequest` (JSON) to `AO3_BRIDGE_REQUEST_KEY`.
- Polls `AO3_BRIDGE_RESULT_KEY` every `AO3_BRIDGE_POLL_INTERVAL_MS` (250ms)
  until result appears or timeout (10 min).
- Reads `AO3_BRIDGE_HEARTBEAT_KEY` to detect live AO3 tabs for reuse.
- Opens AO3 in new tab if no live heartbeat found or if heartbeat is stale
  (>15s) or not logged in.
- Two request kinds:
  - `loadChapterIndex` — fetch AO3 work's chapter list.
  - `updateChapterContent` — update a single AO3 chapter's content.

### AO3 side: `Ao3Bridge` (`src/modules/Ao3Bridge.ts`)

- Initialized on every AO3 page via `bootstrap()` → `Ao3Bridge.init()`.
- Calls `platformStorage.hydrateFromPersistentStorage()` to seed localStorage
  from chrome.storage.local (AO3's localStorage starts empty for FFNE keys).
- Writes heartbeat every 2s (`AO3_BRIDGE_HEARTBEAT_INTERVAL_MS`) with:
  current URL, timestamp, login status.
- Registers `platformStorage.onChanged()` listener to detect new FFN requests.
- Processes pending requests via `_processPendingRequest()`:
  validates timestamps, checks login state (waits if not logged in), delegates
  to `Ao3Service` for actual HTTP operations.
- Injects a status panel (`#ffne-ao3-bridge-panel`) into the AO3 page for
  user feedback.

### Data contracts (`src/interfaces/IAo3Bridge.ts`, `src/interfaces/IAo3Migration.ts`)

- `IAo3Chapter` — workId, chapterId, chapterNumber, label, title, URLs.
- `IAo3MigrationPlan` — normalized work URL, chapters, mapping rows,
  conversion options.
- `IAo3MigrationMappingRow` — links FFN doc to AO3 chapter, tracks
  mapping source (auto/autofill/manual/unmapped) and status
  (mapped/skipped/duplicate).

### Key gotchas

- AO3's localStorage is per-origin and starts empty for FFNE-namespaced keys —
  always `hydrateFromPersistentStorage()` first.
- Timestamp validation guards against stale/replayed requests
  (max 30s future skew, 10min expiry).
- Login-gating: requests wait if AO3 page is not logged in (Cloudflare
  challenge or signed-out state). Heartbeat reflects login status so FFN
  can decide whether to reuse a tab or open a new one.

---

## 8. Story Edit Content Module

`StoryEditContent` (`src/modules/StoryEditContent.ts`) runs on
`/story/story_edit_content.php`, providing bulk chapter replacement.

- Parses the FFN story edit page: extracts chapters from the chapter dropdown,
  docs from the doc-select table, and builds a mapping UI.
- Delegates HTTP operations to `StoryReplaceService` for same-origin form
  submissions with proper CSRF token extraction.
- Uses `runBulkOperation()` utility (generic bulk runner with cooldown/retry)
  for processing multiple chapter replacements.
- UI injected via `injectStyleOnce()` and `markFfneUiRoot()`.
- Implements `IStoryEditContent` interfaces for chapter, doc, mapping,
  and failure types.

---

## 9. Logging

All logging through `FFNLogger` (or `Core.getLogger` which delegates):

```typescript
// Module-level logger factory (preferred - eliminates repetition)
const log = Core.getLogger(this.MODULE_NAME, 'myFunction');
log('Something happened', optionalData);

// Direct call
FFNLogger.log('ModuleName', 'funcName', 'message', optionalData);
```

Log format: `(ffn-enhancements) <ModuleName> <funcName>: <message>`.

`MODULE_NAME` = string constant on each module object (e.g., `'doc-manager'`,
`'LayoutManager'`). Keep consistent + meaningful — appears in every log line.

---

## 10. Reader Download Stack

Reader-side story downloads (EPUB, MOBI, PDF) handled separately,
not related to doc-download feature:

- `StoryDownloader` - wires UI; delegates to `IFanficDownloader` implementations.
- `FicHubDownloader` - fetches via FicHub API using `backgroundFetch` (service worker proxy).
  Also injects local FFN cover art into EPUB via `JSZip`.
- `NativeDownloader` - falls back to FFN-native download if FicHub unavailable.
- `EpubBuilder` - low-level EPUB ZIP construction utility.
- `LocalMetadataSerializer` / `FicHubMetadataSerializer` - scrape story metadata
  for EPUB metadata injection.

---

## 11. Key Files at a Glance

```
src/
  main.ts                        - Entry point; calls installBootstrap()
  bootstrap.ts                   - Sitewide module registration, priming, routing
  enums/
    Elements.ts                  - All DOM selector keys (add new keys here first)
    DocDownloadFormat.ts         - MARKDOWN = 'md' / HTML = 'html' / DOCX = 'docx'
    Theme.ts                     - SYSTEM / LIGHT / DARK / SEPIA / HIGH_CONTRAST
    SupportedFormats.ts          - Reader-facing formats (EPUB, MOBI, PDF, HTML, MD)
    Globals.ts                   - USER_AGENT string
    FicHubStatus.ts              - FicHub API status codes
  interfaces/
    ISiteWideModule.ts           - prime() / init() contract
    IDelegate.ts                 - getElement / getElements contract
    IThemeDefinition.ts          - Theme data shape (tokens, colorMap, isDark)
    IFanficDownloader.ts         - downloadAsEPUB / downloadAsMOBI contract
    IMetadataSerializer.ts       - Metadata serializer contract
    StoryMetadata.ts             - Metadata shape for serializers
    ChapterData.ts               - Chapter data shape
    IAo3Bridge.ts                - AO3 bridge request/result/heartbeat types + validators
    IAo3Migration.ts             - AO3 migration plan/mapping/failure types
    IStoryEditContent.ts         - Story edit content chapter/doc/mapping types
    IBulkOperationConfig.ts      - Generic bulk operation config + IBulkItem
  delegates/
    BaseDelegate.ts              - No-op defaults (spread to inherit)
    GlobalDelegate.ts            - Selectors common to all FFN pages
    StoryDelegate.ts             - /s/* selectors
    DocManagerDelegate.ts        - /docs/docs.php selectors
    DocEditorDelegate.ts         - /docs/edit.php selectors
    StoryEditContentDelegate.ts  - /story/story_edit_content.php selectors
    Ao3Delegate.ts               - AO3 page selectors
    LayoutManagerDelegate.ts     - Fluid mode DOM targets
  modules/
    EarlyBoot.ts                 - Two-phase boot sequencer
    SettingsManager.ts           - Persistent settings (platformStorage + in-memory cache + pub-sub)
    SettingsIconHijacker.ts      - Hijacks FFN gear icon → settings modal
    SettingsPage.ts              - Settings modal UI
    ThemeManager.ts              - Theme switching engine (CSS custom properties + CssScanner)
    LayoutManager.ts             - Fluid layout / viewport meta injection
    Core.ts                      - Delegate broker, logging, DOM readiness
    FFNLogger.ts                 - Shared logger
    DocManager.ts                - /docs/docs.php: bulk export/delete/import, FFN→AO3 migration
    DocEditor.ts                 - /docs/edit.php: single-doc export button in TinyMCE toolbar
    DocIframeHandler.ts          - Shared: Markdown paste listener for TinyMCE iframes
    StoryReader.ts               - /s/*: text selection unlock, keyboard nav, cover modal fix
    StoryDownloader.ts           - /s/*: FicHub/Native download button injection
    StoryEditContent.ts          - /story/story_edit_content.php: bulk chapter replacement
    Ao3Bridge.ts                 - AO3-side bridge: heartbeat, request processing, status panel
    FicHubDownloader.ts          - FicHub API integration (via backgroundFetch)
    NativeDownloader.ts          - FFN-native download fallback (via fetchRequest)
    EpubBuilder.ts               - Low-level EPUB ZIP builder
    DocxBuilder.ts               - Low-level DOCX (OOXML) ZIP builder
    SimpleMarkdownParser.ts      - Lightweight Markdown -> HTML for paste listener
  platform/
    extensionApi.ts              - chrome.* (callback) vs browser.* (Promise) abstraction
    storage.ts                   - chrome.storage.local + localStorage mirror
    messaging.ts                 - Content-script <-> service-worker messaging
    tabs.ts                      - Tab management (open, etc.)
  background/
    service-worker.ts            - Service worker: fetch proxy, tab creation
    message-types.ts             - Shared message type definitions
  prelude/
    themePrelude.ts              - Document-start theme prelude (autonomous IIFE)
  serializers/
    LocalMetadataSerializer.ts   - Scrapes FFN story page for EPUB metadata
    FicHubMetadataSerializer.ts  - Parses FicHub API response for EPUB metadata
  factories/
    TinyMCEButtonFactory.ts      - Creates native-looking TinyMCE 4 toolbar buttons
  services/
    ContentParser.ts             - Turndown setup, HTML/Markdown parsing from doc pages
    DocFetchService.ts           - Doc page fetch, content extraction, hidden-iframe refresh
    CssScanner.ts                - Runtime CSS scanner for FFN native element theming
    Ao3Service.ts                - AO3 API service: fetch chapter index, update chapter content
    Ao3BridgeClient.ts           - FFN-side AO3 bridge client (platformStorage polling + tab mgmt)
    StoryReplaceService.ts       - Same-origin fetch + form submission for story edit content
  styles/
    ThemeTokens.ts               - CSS custom property defaults + buildTokenCss()
    fluid-mode.css               - Fluid layout overrides (injected via LayoutManager)
    settings-modal.css           - Settings modal UI (injected via SettingsPage)
    components.css               - Shared components (cover modal, dropdown, toast, Ao3 panel, status)
    doc-manager.css              - DocManager modals, drawer, table styles
    story-edit-content.css       - StoryEditContent bulk replace UI
    native-overrides.css         - FFN native element overrides (cross-origin CSS fallback)
  themes/
    index.ts                     - THEME_DEFINITIONS registry + getThemeDefinition()
    LightTheme.ts                - Default light theme (empty overrides)
    DarkTheme.ts                 - Dark theme (full token + colorMap overrides)
    SepiaTheme.ts                - Warm paper-like reading theme
    HighContrastTheme.ts         - WCAG-focused high contrast theme
  utils/
    fetchWithBackoff.ts          - Generic HTTP retry/backoff utility for 429 handling
    fetchRequest.ts              - Cross-origin fetch via service worker (replaces gmRequestText)
    runBulkOperation.ts          - Generic bulk operation runner with cooldown/retry/pass-2
    exportTransform.ts           - Export content transformation utilities
    htmlSanitizer.ts             - HTML sanitization (DOMPurify wrapper)
    cloudflareChallenge.ts       - Cloudflare challenge detection + handling
    base64.ts                    - bytesToBase64 / base64ToBytes conversion
    clipboard.ts                 - Clipboard read/write utilities
    confirmDialog.ts             - Modal confirmation dialog builder
    dom.ts                       - h() hyperscript helper for DOM creation
    ffneUi.ts                    - markFfneUiRoot() for marking FFNE-owned DOM nodes
    injectStyleOnce.ts           - Idempotent <style> injection with dedup guard
    scopeCssText.ts              - CSS scoping utilities
    themeClass.ts                - HTML theme class name helpers
    zip.ts                       - ZIP adapter over JSZip
extension/
  manifest.json                  - MV3 manifest (host_permissions, content_scripts.css)
  styles/
    critical-theme.css           - Zero-FOUC page chrome + native FFN overrides
    theme-tokens-light.css       - Light theme :root token block
    theme-tokens-dark.css        - Dark theme :root token block
    theme-tokens-sepia.css       - Sepia theme :root token block
    theme-tokens-hc.css          - High contrast theme :root token block
    fluid-mode.css               - Fluid layout (manifest-injected, class-gated)
  icons/                         - Extension icons (copied to dist/ at build)
scripts/
  build-all.mjs                  - Main build orchestrator
  build-target.mjs               - Per-target build script
  build-package-target.mjs       - Package (zip) for store submission
  manifest-utils.mjs             - patchManifest() for Chrome/Firefox target splits
  sanitize-dist.mjs              - Post-build non-ASCII byte scanner
  generate-icons.mjs             - Icon generation utility
vite.config.ts                   - Multi-entry Vite build config
tsconfig.json                    - Strict TypeScript config
eslint.config.mjs                - ESLint config (includes no-unsanitized plugin)
```

---

## 12. Common Gotchas

1. `document.body` may no exist in `prime()` — use `document.documentElement`
   or arm `MutationObserver` watching `{ childList: true }` on `documentElement`.
   `LayoutManager._applyFluidClass()` has complete example.

2. TinyMCE loads asynchronously — `DocEditor` + `DocManager` both use
   `MutationObserver` to detect toolbar/iframe injection rather than assuming
   present at `DOMContentLoaded`.

3. `file-saver` is named export — import as `import { saveAs } from 'file-saver'`
   (not default).

4. `vite-plugin-monkey` defaults to unminified output unless `build.minify`
   explicitly set in returned Vite config. Keep `build.minify: 'esbuild'`
   enabled for production builds or document-start logic loses parse-time races
   against FFN first paint.

5. `DocFetchService.refreshPrivateDoc` exists, uses different logic
   (iframe form submission) than `_fetchDocPage`. Deliberately
   not unified.

6. **GOTCHA: Bulk Delete must use same-origin fetch, not a hidden iframe.**
   Do not model DocManager Bulk Delete after `refreshPrivateDoc` or Bulk
   Import's hidden edit-page iframe. Firefox returned HTTP 200 responses
   containing FFN's invalid-auth page when delete used a sandboxed iframe
   pointed at `/docs/docs.php?action=remove&docid=...`; Chromium accepted the
   same flow, which made this easy to miss.

   Delete is a GET-only DocManager action, so follow the Bulk Export-style
   authenticated same-origin request path in `deletePrivateDocWithResult()`:
   `fetch(removeUrl, { credentials: 'include', redirect: 'follow' })`.
   Parse the returned DocManager HTML and verify the target `docid` no longer
   appears before marking the row deleted. Keep auth/login/403/429/5xx/network
   failures retryable with `attempt * fetchRetryBaseMs`; the bulk runner still
   provides its pass-2 retry/cooldown.

   Also do not display FFN error panels via raw `textContent`. Adjacent block
   nodes and `<br>` can collapse into strings like
   `Invalid RequestWe are unable to authenticate your request`. Use the
   readable FFN error extraction in `DocFetchService` so failures render as
   `Invalid Request: We are unable to authenticate your request.`

7. `SupportedFormats` vs `DocDownloadFormat` — keep separate. `SupportedFormats`
   reader-facing (EPUB/MOBI/PDF/etc.). `DocDownloadFormat` author doc export only.
   Overlap on `HTML` + `MARKDOWN` but serve different contexts.

8. `enableFluidMode()` / `disableFluidMode()` on `LayoutManager` no persist
   preference — imperative helpers for internal use. Only
   `toggleFluidMode()` persists via `SettingsManager.set()`. If add new
   explicit enable/disable public calls, persist there too.

9. `--ffne-ui-white` is surface color, becomes dark in dark theme. Never
    use for text on colored backgrounds (modal headers, toasts, badges). Use
    `--ffne-ui-text-on-accent` instead — stays light across all themes.

10. `CssScanner` skips `<style>` tags whose `id` starts with `ffne-`, `ffe-`, or
    `ffn-enhancements`. When adding new injected style tags, use one of these
    prefixes to prevent scanner generating redundant overrides.

11. FFN main CSS cross-origin (CDN-served), so `CssScanner` cannot read
    `cssRules` from those sheets. `critical-theme.css` (manifest-injected) and
    `native-overrides.css` (JS-injected) provide fallback element-level overrides
    using `var(--ffne-*)` tokens. When FFN adds new UI patterns not covered,
    add rules there rather than expanding scanner reach.

12. **GOTCHA: Scanner vs native-overrides injection order.** `_injectFfnOverrides`
    concatenates `[scannerCss, elementCss]`. Scanner preserves `!important` from
    original rules. When scanner + native-overrides produce identical selectors
    with `!important` (e.g., `#gui_table1 tbody tr:hover td`), native-overrides
    wins because comes LAST. Swap order, scanner's mechanically-
    remapped colors win + semantic tokens stop working. Native-overrides must
    always be final word.

13. `userscript.noframes` intentional. TinyMCE editor iframes themed from
    parent document via `iframe.contentDocument`, so no build features
    depending on userscript executing inside subframes.

14. **GOTCHA: Do NOT include `service_worker` in Firefox manifest.** Firefox
    MV3 uses event pages (`background.scripts`). Firefox 121+ has experimental
    `background.service_worker` support behind
    `extensions.backgroundServiceWorker.enabled` pref. When BOTH `scripts` +
    `service_worker` keys present, Firefox may prefer `service_worker`,
    attempt to load bundle as real ServiceWorker, fail silently (no
    `type: "module"`; uses `chrome.action.*` which not on SW scope on
    Firefox), never fall back to `scripts`. Result: `action.onClicked`
    listener never registers, toolbar icon click is silent no-op.

    Firefox manifest must contain ONLY `background.scripts` — no
    `service_worker`, no `type: "module"`. Module scripts execute deferred,
    missing wake-up event dispatch in event-page lifecycles. Bundled
    `service-worker.js` has no imports/exports — module mode unnecessary.

    Chrome manifest retains `service_worker` + `type: "module"`.
    `patchManifest` helper in `scripts/manifest-utils.mjs` handles per-target split,
    exported for unit testing in `src/__tests__/viteConfig.test.ts`.

    The background bundle is built as IIFE (not ESM), so it works identically
    whether Chrome loads it as a module service worker or Firefox loads it as
    a classic event-page script.

15. **Manifest uses `host_permissions` (not `optional_host_permissions`).**
    Content scripts auto-load on install — no first-click permission prompt.
    This simplifies the settings-modal flow (no inject/retry dance) and removes
    the service worker `action.onClicked` → `permissions.request` path.
    Tradeoff: Chrome shows "Read and change data on..." install-time warning.
    Accepted — simpler architecture beats silent install.

16. **AO3 bridge: localStorage is per-origin.** On AO3 pages, FFNE-namespaced
    keys in localStorage start empty. Always call
    `platformStorage.hydrateFromPersistentStorage()` at startup to seed
    localStorage from chrome.storage.local before any sync reads.
    `Ao3Bridge.init()` does this; `SettingsManager.prime()` does the same on FFN.

17. **AO3 bridge: login-gating.** `Ao3Bridge._processPendingRequest()` checks
    `Ao3Service._isLoggedInDocument()` before processing. If not logged in
    (Cloudflare challenge or signed-out state), request stays in storage and
    heartbeat poll retries. FFN's `Ao3BridgeClient` reads heartbeat login status
    to decide whether to reuse existing AO3 tab or open a new one.

18. **`SettingsIconHijacker` depends on FFN DOM.** If FFN removes or renames
    `.icon-kub-mobile`, settings become inaccessible. The MutationObserver
    timeout (5s post-DOMContentLoaded) prevents perpetual DOM watching.
    A future fallback could add a dedicated settings button injected into the
    page, but for now the gear icon hijack is the sole entry point.

19. **`StoryEditContent` route matches `/story/story_edit_content.php` via
    `path.includes()` — this is a query-string-heavy PHP endpoint.** The
    `includes` check is intentional to match regardless of query parameters
    (e.g., `?storyid=123&chapter=4`).

20. **`runBulkOperation()` is a generic bulk runner** — used by both
    `DocManager` (export/delete/import) and `StoryEditContent` (chapter
    replacement). Config is `IBulkOperationConfig` with items, operation
    function, delays, cooldowns, and retry settings from SettingsManager.

---

## 13. Checklist: Adding a New Setting

1. `src/enums/` - Add new enum if value constrained (e.g., `MyEnum`).
2. `src/modules/SettingsManager.ts`:
   - Add field + type to `FFNSettings`.
   - Add default to `DEFAULTS`.
   - Add one-liner in `_loadAll()`: `_loadBool(key)` / `_loadEnum(key, EnumObj)` / `_loadPositiveNumber(key)`.
   - `_registerOnChangedListener()` automatic (iterates `Object.keys(DEFAULTS)`).
3. `src/modules/SettingsPage.ts`:
   - If numeric: add key to `NUMERIC_KEYS`.
   - Add `_buildXxxRow(...)` call in `_buildHTML()` under appropriate section.
   - Add `SettingsManager.subscribe(key, ...)` call in `_registerSubscriptions()`
     (numeric keys handled automatically by `NUMERIC_KEYS` forEach loop).
4. Wire consuming module(s) to call `SettingsManager.get('yourKey')` at
   call time (not init time) — changes take effect immediately, no reload.
   Use `SettingsManager.subscribe()` for live reactive updates.

---

## 14. Checklist: Adding a New Page Module

1. `src/enums/Elements.ts` - Add selector keys for new page elements.
2. `src/delegates/` - Create `MyPageDelegate.ts` (spread `BaseDelegate`, implement
   relevant keys).
3. `src/delegates/GlobalDelegate.ts` - Check if any new keys belong here instead.
4. `src/modules/Core.ts` -> `setDelegate()` - add `else if` branch for new path.
5. `src/modules/MyPageModule.ts` - create module (object literal, `MODULE_NAME`,
   `init()`).
6. `src/bootstrap.ts` -> `initActiveRoute()` - add routing branch calling
   `MyPageModule.init()`.

*Modify this file as new paradigms arise.*
