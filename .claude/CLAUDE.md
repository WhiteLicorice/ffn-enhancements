# FFN Enhancements - Agent Orientation Guide

> Jumpstart reference for AI agents in repo.
> Captures architecture, conventions, gotchas, patterns
> needing non-trivial investigation. Update when learn
> new or change fundamental.

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
| All pages | `LayoutManager`, `ThemeManager`, `SettingsManager`, `SettingsMenu` | Everyone |

---

## 2. Build System

```bash
npm run build   # tsc && vite build  (TypeScript check + bundle)
npm run dev     # vite build --watch  (rebuild on file changes)
npm test        # vitest run -v
```

- TypeScript strict (`strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true`).
- Vite multi-entry build: 4 entry points + shared chunks:
  - `content/main.js` — main content script (all modules)
  - `content/prelude.js` — document-start theme prelude (<1 KB)
  - `background/service-worker.js` — service worker (fetch proxy, tab mgmt)
  - `popup/popup.js` — extension popup
- `build.minify: 'esbuild'` + `build.target: 'es2020'` for prod.
- `emptyOutDir: true` — dist/ fully regenerated each build.
- Static assets (manifest.json, CSS, icons, popup.html) live in `extension/`,
  copied to `dist/` by `copy-extension-assets` Vite plugin post-bundle.
- Shared chunks land in `dist/chunks/` (e.g., `message-types-*.js`, `themeClass-*.js`).
- `modulePreload: false` — extension content scripts no support module preload.
- Target-specific output dirs: `dist-chrome/` + `dist-firefox/`.
  `FFNE_TARGET` env var picks target (`chrome` or `firefox`).
- `patchManifest()` in `vite.config.ts` handles target-specific tweaks:
  - **Chrome:** Strips `browser_specific_settings` (CWS rejects).
  - **Firefox:** Event-page `background.scripts` only — no
    `service_worker`, no `type: "module"` (see Gotcha #15).

### 2.1 Extension Icon Click → Settings Modal Flow

**Prerequisite: optional host permissions.** All four host origins (FFN, AO3,
fichub.net) under `optional_host_permissions` in
`extension/manifest.json`. Chrome + Firefox no auto-grant optional
patterns at install — `content_scripts` no auto-execute until user
accepts prompt triggered by `chrome.permissions.request` from service
worker's `action.onClicked` handler. Use `optional_host_permissions` (not
`host_permissions`) because Firefox MV3 forbids requesting required
`host_permissions` via `permissions.request` (MDN: "The permissions that can be
requested with the request() method are limited to the optional_permissions and
optional_host_permissions declared in manifest.json"). On grant,
`chrome.permissions.onAdded` fires, service worker injects full
content-script bundle (`CONTENT_SCRIPT_CSS_FILES` + `CONTENT_SCRIPT_JS_FILES`)
into all open FFN/AO3 tabs via `injectIntoMatchingTabs()`. Future
navigations auto-load `content_scripts` normally.

Extension icon click (`action.onClicked`) opens settings modal on
active FFN/AO3 tab. Dispatch chain in
`src/background/service-worker.ts` → `openSettingsInTab(tabId)`:

1. **Step 1 (primary):** `chrome.tabs.sendMessage(tabId, { type: OPEN_SETTINGS })`.
   Content script's `SettingsMenu.prime()` registers
   `chrome.runtime.onMessage` handler calling `SettingsPage.openModal()`,
   acks with `{ ok: true }`. Clean failure semantics: missing
   listener rejects with "Receiving end does not exist" — detectable.

2. **Step 2 (inject):** If step 1 fails, inject full content-script bundle
   via `injectFullContentScripts(tabId)`: first
   `chrome.scripting.insertCSS({ files: CONTENT_SCRIPT_CSS_FILES })`, then
   `chrome.scripting.executeScript({ files: ['content/prelude.js'] })`, then
   `chrome.scripting.executeScript({ files: ['content/main.js'] })`.
   Required on Firefox MV3 when optional host permissions not granted
   yet — manifest `content_scripts` no auto-execute until user grants
   host access. `activeTab` permission (granted by toolbar click) lets
   service worker inject bundle regardless of current host-access
   state. `prelude.js` guarded by `__ffnePreludeBootstrapped`, `main.ts`
   guarded by `__ffneContentBootstrapped` — re-injection on
   already-loaded tab is no-op.

3. **Step 3 (retry):** Repeat `sendMessage`. After step 2,
   `OPEN_SETTINGS` listener registered synchronously by `SettingsMenu.prime()`
   (inside `EarlyBoot.prime()`), retry hits listener, modal opens.

4. **Tab routing:** If active tab not on supported host (FFN/AO3),
   `openSettingsForTab` opens `https://www.fanfiction.net/` in new tab,
   queues `openSettingsInTab` on `tabs.onUpdated` (status `complete`).

Each step logs success/failure to background console with
`FFN-Enhancements:` prefix — easy to grep in Firefox
about:debugging.

Dispatch flow no use `window.postMessage` — that has silent
failure mode: `scripting.executeScript({ func })` returns true if func
*ran*, regardless of whether `message` listener received post. On
Firefox MV3 without granted optional host permissions, content script
never loads, listener never exists, but executeScript still
succeeds. Using `sendMessage` as primary avoids false positive.

---

## 3. Platform Abstraction Layer

All browser-extension APIs accessed through thin wrappers in `src/platform/`:

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
```

- All keys use `ffne_` prefix (added internally by platformStorage).
- `get()` reads from localStorage (sync, available at document-start).
- `set()` writes localStorage (sync) + `chrome.storage.local` (async persist).
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
- Blob responses converted `number[]` → `Uint8Array` → `Blob` (JSON-safe messaging).

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

Sitewide modules (run on every page, not one route)
implement `ISitewideModule`:

```typescript
export interface ISitewideModule {
    prime(): void;   // Phase 1: document-start (before HTML is parsed)
    init(): void;    // Phase 2: DOMContentLoaded (DOM fully ready)
}
```

Register with `EarlyBoot` in `main.ts`:

```typescript
EarlyBoot.register(SettingsManager);   // MUST be first
EarlyBoot.register(SettingsMenu);      // MUST be after SettingsManager
EarlyBoot.register(ThemeManager);      // MUST be after SettingsManager, before LayoutManager
EarlyBoot.register(LayoutManager);     // MUST be after ThemeManager
EarlyBoot.prime();                     // Calls prime() on all, synchronously

// Inside the DOMContentLoaded callback:
EarlyBoot.init();                      // Calls init() on all
```

Registration order = execution order. Required order:

1. `SettingsManager` - load all settings into cache before reads.
2. `SettingsMenu` - reads settings to build menu labels; after SettingsManager.
3. `ThemeManager` - reads `theme` setting, injects CSS vars + component styles at `prime()` to prevent FOUC; before LayoutManager so token vars available.
4. `LayoutManager` - reads `fluidMode` in `prime()` to prevent FOUC; after ThemeManager so fluid CSS layers over theme tokens.

**Phase 1 rules:** `prime()` runs synchronously at `document-start`. No
read `document.body` or `document.head` (not guaranteed exist yet). Safe
ops: inject `<style>` on `document.documentElement`, arm `MutationObserver`,
call sync GM funcs.

**Phase 2 rules:** `init()` runs at `DOMContentLoaded`. All DOM ops
safe.

Programmatic reinjection re-runs `prelude.js` + `main.js`. Keep both guarded
by bootstrap flags (`__ffnePreludeBootstrapped`,
`__ffneContentBootstrapped`) so already-primed tabs no accumulate duplicate
style tags or listeners.

### 4.3 Delegate / Strategy Pattern (Page Objects)

FFN DOM differs between pages. All CSS selector knowledge lives in
**Delegate** objects, never in module business logic.

```
src/delegates/
  IDelegate.ts          - interface: getElement(key, doc?), getElements(key, doc?)
  BaseDelegate.ts       - default no-op implementation (spread to inherit)
  GlobalDelegate.ts     - selectors present on every page (header, wrapper, etc.)
  StoryDelegate.ts      - /s/* specific selectors
  DocManagerDelegate.ts - /docs/docs.php specific selectors
  DocEditorDelegate.ts  - /docs/edit.php specific selectors
  LayoutManagerDelegate.ts - fluid-mode element selectors
```

DOM keys defined in `src/enums/Elements.ts`. Add new key there first,
then implement in relevant delegate.

`Core.setDelegate(path)` called in `Core.startup()` (from `main.ts`),
sets `Core.activeDelegate`. After, all modules call:

```typescript
Core.getElement(Elements.MY_KEY)      // single element (null on miss)
Core.getElements(Elements.MY_KEY)     // array (empty on miss)
```

`Core.getElement` tries active page-specific delegate first, falls back
to `GlobalDelegate` (chain of responsibility).

### 4.4 Page-Specific Module Routing

`main.ts` routes to page-specific modules after `EarlyBoot.init()`:

```typescript
if (path === "/docs/docs.php")             DocManager.init();
else if (path.includes("/docs/edit.php"))   DocEditor.init();
else if (path.startsWith("/s/"))          { StoryReader.init(); StoryDownloader.init(); }
```

Page-specific modules no implement `ISitewideModule`. Single
`init()` entry point, called directly.

### 4.5 Services Layer

Doc-related network + parsing concerns extracted from `Core` into focused
services in `src/services/`:

- `ContentParser` - `TurndownService` instance, `parseHtmlFromPrivateDoc()`,
  `parseContentFromPrivateDoc()`. Consumed by `DocEditor` + `DocFetchService`.
- `DocFetchService` - `_fetchDocPage()`, `fetchAndConvertPrivateDoc()`,
  `fetchPrivateDocAsHtml()`, `refreshPrivateDoc()`. Consumed by `DocManager`.

Both services import `Core` for `getElement`/`getLogger` — no circular deps.

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
- `_mirrorThemeCache()` writes theme to `localStorage['ffne_theme_cache']` for
  prelude to read synchronously at `document_start`.

**Add new setting:**
1. Add field + type to `FFNSettings` interface.
2. Add default to `DEFAULTS`.
3. Add one-liner in `_loadAll()`: `_loadBool(key)`, `_loadEnum(key, EnumObj)`, or `_loadPositiveNumber(key)`.
4. Automatic: `_registerOnChangedListener()` handles all keys via single
   `chrome.storage.onChanged` listener.
5. Add control row in `SettingsPage.ts` (see checklist Section 11).

### 5.2 SettingsMenu (`src/modules/SettingsMenu.ts`)

Registers single Tampermonkey menu command opening settings modal
on current page via `SettingsPage.openModal()`:

```typescript
GM_registerMenuCommand('FFN Enhancements Settings', () => {
    SettingsPage.openModal();
});
```

**Why no per-setting menu commands?**
Old approach cycled labels via `GM_registerMenuCommand` / `GM_unregisterMenuCommand`.
Two problems:
1. TM closes extension menu immediately on click — rapid-cycle UX janky.
2. With `autoClose: false`, labels re-sort alphabetically after each update —
   disorienting.
Modal eliminates both, enables richer UI.

**Why modal instead of new tab?**
Opening `https://www.fanfiction.net/?ffne_settings=1` made unnecessary server
request just to render own UI. Modal runs in same script context, no
URL interception, direct GM storage access.

`SettingsMenu.ts` no need change when new settings added.
Add settings UI in `SettingsPage.ts` instead.

### 5.3 SettingsPage (`src/modules/SettingsPage.ts`)

Modal settings UI injected into `document.body` on current FFN page.
Opened via `SettingsPage.openModal()`, dismissed via `closeModal()` (x button,
backdrop click, or ESC key).

**No URL interception:**
No `?ffne_settings=1` URL or routing intercept in `main.ts`. Modal
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
no exist). TM menu command callback only fires after user interaction, always
post-DOMContentLoaded — naturally satisfied.

**GOTCHA:** Always call `closeModal()` to clean up subscriptions + ESC key
listener. Removing backdrop element alone leaves listeners dangling.

---

## 5b. Theme System

### Architecture

All colors flow through **CSS custom properties** (`--ffne-*`).
Defaults defined in `src/styles/ThemeTokens.ts`, injected as
`:root { ... }` block at `document-start` by `ThemeManager.prime()`. Themes
override these vars; all CSS files consume via `var(--ffne-*)`.

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

Implements `ISitewideModule`. Registered in EarlyBoot between SettingsMenu +
LayoutManager.

**Phase 1 (`prime()`):** Injects token CSS, component CSS, applies HTML class
(`ffne-theme-<name>`), sets `color-scheme`. Prevents FOUC for own UI.

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

### CSS Files

All module CSS extracted to dedicated `.css` files in `src/styles/`:
- `settings-modal.css` - settings UI
- `fluid-mode.css` - fluid layout overrides
- `components.css` - shared components (cover modal, dropdown, toast, Ao3 panel, status classes)
- `doc-manager.css` - DocManager modals, drawer, table
- `story-edit-content.css` - StoryEditContent bulk replace UI
- `native-overrides.css` - FFN native element overrides (fallback for cross-origin CSS)

Imported via `?raw`, injected as `<style>` tags.

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

## 7. Logging

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

## 8. Reader Download Stack

Reader-side story downloads (EPUB, MOBI, PDF) handled separately,
not related to doc-download feature:

- `StoryDownloader` - wires UI; delegates to `IFanficDownloader` implementations.
- `FicHubDownloader` - fetches via FicHub API using `GM_xmlhttpRequest` (CORS bypass).
  Also injects local FFN cover art into EPUB via `JSZip`.
- `NativeDownloader` - falls back to FFN-native download if FicHub unavailable.
- `EpubBuilder` - low-level EPUB ZIP construction utility.
- `LocalMetadataSerializer` / `FicHubMetadataSerializer` - scrape story metadata
  for EPUB metadata injection.

`GM_xmlhttpRequest` needed (granted) because `fichub.net` is cross-origin;
normal `fetch()` blocked by CORS.

---

## 9. Key Files at a Glance

```
src/
  main.ts                        - Entry point / router; EarlyBoot registration
  bootstrap.ts                   - Sitewide module registration + routing
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
    StoryMetadata.ts             - Metadata shape for serializers
    ChapterData.ts               - Chapter data shape
  delegates/
    BaseDelegate.ts              - No-op defaults (spread to inherit)
    GlobalDelegate.ts            - Selectors common to all pages
    StoryDelegate.ts             - /s/* selectors
    DocManagerDelegate.ts       - /docs/docs.php selectors
    DocEditorDelegate.ts        - /docs/edit.php selectors
    LayoutManagerDelegate.ts     - Fluid mode DOM targets
  modules/
    EarlyBoot.ts                 - Two-phase boot sequencer
    SettingsManager.ts           - Persistent settings (platformStorage + in-memory cache + pub-sub)
    SettingsMenu.ts              - Message listener for popup -> settings modal
    SettingsPage.ts              - Settings modal UI
    ThemeManager.ts              - Theme switching engine (CSS custom properties + CssScanner)
    LayoutManager.ts             - Fluid layout / viewport meta injection
    Core.ts                      - Delegate broker, logging, DOM readiness
    FFNLogger.ts                 - Shared logger
    DocManager.ts                - /docs/docs.php: bulk export, export column injection
    DocEditor.ts                 - /docs/edit.php: single-doc export button in TinyMCE toolbar
    DocIframeHandler.ts          - Shared: Markdown paste listener for TinyMCE iframes
    StoryReader.ts               - /s/*: text selection unlock, keyboard nav, cover modal fix
    StoryDownloader.ts           - /s/*: FicHub/Native download button injection
    FicHubDownloader.ts          - FicHub API integration (via backgroundFetch)
    NativeDownloader.ts          - FFN-native download fallback (via fetchRequest)
    EpubBuilder.ts               - Low-level EPUB ZIP builder
    DocxBuilder.ts               - Low-level DOCX (OOXML) ZIP builder
    SimpleMarkdownParser.ts       - Lightweight Markdown -> HTML for paste listener
  platform/
    storage.ts                   - chrome.storage.local + localStorage mirror
    messaging.ts                 - Content-script <-> service-worker messaging
    tabs.ts                      - Tab management (open, etc.)
  background/
    service-worker.ts            - Service worker: fetch proxy, tab creation, settings forwarding
    message-types.ts             - Shared message type definitions
  popup/
    popup.html                   - Extension popup HTML
    popup.ts                     - Extension popup logic
  prelude/
    themePrelude.ts              - Document-start theme prelude (autonomous IIFE)
  serializers/
    LocalMetadataSerializer.ts    - Scrapes FFN story page for EPUB metadata
    FicHubMetadataSerializer.ts   - Parses FicHub API response for EPUB metadata
  factories/
    TinyMCEButtonFactory.ts       - Creates native-looking TinyMCE 4 toolbar buttons
  services/
    ContentParser.ts             - Turndown setup, HTML/Markdown parsing from doc pages
    DocFetchService.ts           - Doc page fetch, content extraction, hidden-iframe refresh
    CssScanner.ts                - Runtime CSS scanner for FFN native element theming
    Ao3Service.ts                - AO3 API service (uses fetchRequest)
    Ao3BridgeClient.ts           - FFN-side AO3 bridge client (uses platformStorage + tabs)
  styles/
    ThemeTokens.ts               - CSS custom property defaults + buildTokenCss()
    fluid-mode.css               - Fluid layout overrides (injected via LayoutManager)
    settings-modal.css           - Settings modal UI (injected via SettingsPage)
    components.css               - Shared components (cover modal, dropdown, toast, status)
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
extension/
  manifest.json                  - MV3 manifest
  popup/popup.html               - Popup HTML (copied to dist/ at build)
  styles/                        - Static CSS for manifest injection (copied to dist/ at build)
  icons/                         - Extension icons (copied to dist/ at build)
vite.config.ts                   - Multi-entry Vite build config
tsconfig.json                    - Strict TypeScript config
```

---

## 10. Common Gotchas

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

6. `SupportedFormats` vs `DocDownloadFormat` — keep separate. `SupportedFormats`
   reader-facing (EPUB/MOBI/PDF/etc.). `DocDownloadFormat` author doc export only.
   Overlap on `HTML` + `MARKDOWN` but serve different contexts.

7. `GM_registerMenuCommand` return type — returns `string | number`; varies by
   Tampermonkey version. Store as `string | number | null` if need to
   unregister. Current `SettingsMenu.ts` no store return value.

8. `enableFluidMode()` / `disableFluidMode()` on `LayoutManager` no persist
   preference — imperative helpers for internal use. Only
   `toggleFluidMode()` persists via `SettingsManager.set()`. If add new
   explicit enable/disable public calls, persist there too.

9. `GM_addValueChangeListener` fires for same-tab changes in some TM builds —
   `!remote` guard in `SettingsManager._registerValueListeners` prevents
   double-applying changes already handled by `set()`. Always include guard
   when writing new `GM_addValueChangeListener` callbacks.

10. `--ffne-ui-white` is surface color, becomes dark in dark theme. Never
    use for text on colored backgrounds (modal headers, toasts, badges). Use
    `--ffne-ui-text-on-accent` instead — stays light across all themes.

11. `CssScanner` skips `<style>` tags whose `id` starts with `ffne-`, `ffe-`, or
    `ffn-enhancements`. When adding new injected style tags, use one of these
    prefixes to prevent scanner generating redundant overrides.

12. FFN main CSS cross-origin (CDN-served), so `CssScanner` cannot read
    `cssRules` from those sheets. `native-overrides.css` provides fallback
    element-level overrides using `var(--ffne-*)` tokens. When FFN adds new
    UI patterns not covered, add rules there rather than
    expanding scanner reach.

13. **GOTCHA: Scanner vs native-overrides injection order.** `_injectFfnOverrides`
    concatenates `[scannerCss, elementCss]`. Scanner preserves `!important` from
    original rules. When scanner + native-overrides produce identical selectors
    with `!important` (e.g., `#gui_table1 tbody tr:hover td`), native-overrides
    wins because comes LAST. Swap order, scanner's mechanically-
    remapped colors win + semantic tokens stop working. Native-overrides must
    always be final word.

14. `userscript.noframes` intentional. TinyMCE editor iframes themed from
    parent document via `iframe.contentDocument`, so no build features
    depending on userscript executing inside subframes.

15. **GOTCHA: Do NOT include `service_worker` in Firefox manifest.** Firefox
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
    `patchManifest` helper in `vite.config.ts` handles per-target split,
    exported for unit testing in `src/__tests__/viteConfig.test.ts`.

    Register listeners against
    `(globalThis.browser?.action ?? chrome.action).onClicked` so binding
    works regardless of which namespace Firefox exposes first during
    event-page wake-up.

16. **GOTCHA: `chrome.scripting.executeScript({ func })` no confirm
    receipt of `window.postMessage` from injected closure.**
    `executeScript` promise resolves when injected function *finishes
    executing*, NOT when `message` listener acks post. If
    content script not loaded — e.g., Firefox MV3 where optional
    host permissions not granted yet —
    `window.postMessage` posts to window with no `'message'` listener for
    expected type, executeScript still resolves successfully,
    service worker falsely reports open-settings dispatch as successful.

    Use `chrome.tabs.sendMessage` for any dispatch needing to know
    whether content script actually received message. sendMessage
    rejects with "Receiving end does not exist" when no listener registered —
    failure signal dispatch chain in
    `openSettingsInTab` relies on to trigger inject + retry fallback. See
    Section 2.1 for full chain.

17. **GOTCHA: Use `optional_host_permissions`, NOT `host_permissions`, when
    you need `chrome.permissions.request` to prompt user.** Per MDN:
    `permissions.request()` can ONLY request permissions/origins declared in
    `optional_permissions` / `optional_host_permissions`. On Firefox, calling
    `permissions.request({ origins: [<pattern in host_permissions>] })`
    resolves false (or rejects) without showing prompt — silently breaks
    any first-run UX depending on it.

    This extension declares all FFN/AO3/fichub.net patterns under
    `optional_host_permissions` so service worker `action.onClicked`
    handler can prompt on first click. Side effect: Chrome no longer shows
    install-time "Read and change data on..." warning; users see same
    first-click prompt as Firefox. Tradeoff accepted — one consistent UX
    across browsers beats divergent flows.

    `content_scripts.matches` works against either `host_permissions` or
    `optional_host_permissions` once corresponding origin granted —
    no change needed there.

    Drift test in `src/__tests__/contentScriptManifest.test.ts` reads
    `manifest.optional_host_permissions`, asserts matches
    `REQUESTED_HOST_PATTERNS`. Keep synced when adding/removing hosts.

---

## 11. Checklist: Adding a New Setting

1. `src/enums/` - Add new enum if value constrained (e.g., `MyEnum`).
2. `src/modules/SettingsManager.ts`:
   - Add field + type to `FFNSettings`.
   - Add default to `DEFAULTS`.
   - Add one-liner in `_loadAll()`: `_loadBool(key)` / `_loadEnum(key, EnumObj)` / `_loadPositiveNumber(key)`.
   - `_registerValueListeners()` automatic (iterates `Object.keys(DEFAULTS)`).
3. `src/modules/SettingsPage.ts`:
   - If numeric: add key to `NUMERIC_KEYS`.
   - Add `_buildXxxRow(...)` call in `_buildHTML()` under appropriate section.
   - Add `SettingsManager.subscribe(key, ...)` call in `_registerSubscriptions()`
     (numeric keys handled automatically by `NUMERIC_KEYS` forEach loop).
4. Wire consuming module(s) to call `SettingsManager.get('yourKey')` at
   call time (not init time) — changes take effect immediately, no reload.
   Use `SettingsManager.subscribe()` for live reactive updates.
5. Add grants to `vite.config.ts` if new GM functions needed.

`SettingsMenu.ts` no need change when new settings added.

---

## 12. Checklist: Adding a New Page Module

1. `src/enums/Elements.ts` - Add selector keys for new page elements.
2. `src/delegates/` - Create `MyPageDelegate.ts` (spread `BaseDelegate`, implement
   relevant keys).
3. `src/delegates/GlobalDelegate.ts` - Check if any new keys belong here instead.
4. `src/modules/Core.ts` -> `setDelegate()` - add `else if` branch for new path.
5. `src/modules/MyPageModule.ts` - create module (object literal, `MODULE_NAME`,
   `init()`).
6. `src/main.ts` - add routing branch calling `MyPageModule.init()`.

*Modify this file as new paradigms arise.*