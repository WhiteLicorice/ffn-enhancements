﻿# FFN Enhancements - Agent Orientation Guide

> This file is a jumpstart reference for AI agents working in this repository.
> It captures architecture decisions, conventions, gotchas, and patterns that
> took non-trivial investigation to discover. Update it when you learn something
> new or change something fundamental.

---

## Conventions

Adhere to best software-engineering and UX/UI conventions. Favor modular, scalable, maintainable, readable, correct, and well-documented code. Fix bugs at the root. Implement features to be future-proof. Avoid bandaids or hacks unless genuinely constrained by the environment. Be liberal with GOTCHAs and TODOs in the codebase; these are for future developers. Update tests as updates to the codebase are done. Refrain from using non-ASCII characters anywhere in the codebase, to avoid encoding errors.

---

## 1. What This Project Is

A **Manifest V3 browser extension** (Chrome + Firefox) that enhances FanFiction.net's interface for both readers and authors. It was migrated from a Tampermonkey userscript to achieve zero-FOUC theme injection via native `manifest.json` `content_scripts.css`.

The extension runs on `https://www.fanfiction.net/*` and `https://archiveofourown.org/*`.

Extension store distribution: Chrome Web Store + Firefox Add-ons (AMO). Load unpacked from `dist/` for development.

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

- TypeScript is strict (`strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true`).
- Vite multi-entry build produces 4 entry points + shared chunks:
  - `content/main.js` — main content script (all modules)
  - `content/prelude.js` — document-start theme prelude (minimal, <1 KB)
  - `background/service-worker.js` — service worker (fetch proxy, tab management)
  - `popup/popup.js` — extension popup
- `build.minify: 'esbuild'` and `build.target: 'es2020'` for production.
- `emptyOutDir: true` — dist/ is fully regenerated each build.
- Static assets (manifest.json, CSS, icons, popup.html) live in `extension/` and
  are copied to `dist/` by the `copy-extension-assets` Vite plugin after bundling.
- Shared chunks land in `dist/chunks/` (e.g., `message-types-*.js`, `themeClass-*.js`).
- `modulePreload: false` — extension content scripts don't support module preload.
- Target-specific output directories: `dist-chrome/` and `dist-firefox/`. The
  `FFNE_TARGET` env var controls which target is built (`chrome` or `firefox`).
- `patchManifest()` in `vite.config.ts` handles target-specific manifest tweaks:
  - **Chrome:** Removes `browser_specific_settings` (CWS rejects it).
  - **Firefox:** Uses event-page `background.scripts` only — does NOT include
    `service_worker` and does NOT set `type: "module"` (see Gotcha #15).

### 2.1 Extension Icon Click → Settings Modal Flow

**Prerequisite: optional host permissions.** All four host origins (FFN, AO3,
fichub.net) live under `optional_host_permissions` in
`extension/manifest.json`. Neither Chrome nor Firefox auto-grants optional
patterns at install — `content_scripts` do NOT auto-execute until the user
accepts the prompt triggered by `chrome.permissions.request` from the service
worker's `action.onClicked` handler. We use `optional_host_permissions` (not
`host_permissions`) because Firefox MV3 forbids requesting required
`host_permissions` via `permissions.request` (MDN: "The permissions that can be
requested with the request() method are limited to the optional_permissions and
optional_host_permissions declared in manifest.json"). On grant,
`chrome.permissions.onAdded` fires and the service worker injects the full
content-script bundle (`CONTENT_SCRIPT_CSS_FILES` + `CONTENT_SCRIPT_JS_FILES`)
into all currently open FFN/AO3 tabs via `injectIntoMatchingTabs()`. Future
navigations auto-load `content_scripts` as normal.

The extension icon click (`action.onClicked`) opens the settings modal on the
active FFN/AO3 tab. The dispatch chain in
`src/background/service-worker.ts` → `openSettingsInTab(tabId)` is:

1. **Step 1 (primary):** `chrome.tabs.sendMessage(tabId, { type: OPEN_SETTINGS })`.
   The content script's `SettingsMenu.prime()` registers a
   `chrome.runtime.onMessage` handler that calls `SettingsPage.openModal()` and
   acknowledges with `{ ok: true }`. This gives clean failure semantics: missing
   listener rejects with "Receiving end does not exist", so we can detect it.

2. **Step 2 (inject):** If step 1 fails, inject the full content-script bundle
   via `injectFullContentScripts(tabId)`: first
   `chrome.scripting.insertCSS({ files: CONTENT_SCRIPT_CSS_FILES })`, then
   `chrome.scripting.executeScript({ files: ['content/prelude.js'] })`, then
   `chrome.scripting.executeScript({ files: ['content/main.js'] })`. This is
   required on Firefox MV3 when optional host permissions have not been granted
   yet — manifest `content_scripts` do NOT auto-execute until the user grants
   host access. The `activeTab` permission (granted by the toolbar click) lets
   the service worker inject the bundle regardless of current host-access
   state. `prelude.js` is guarded by `__ffnePreludeBootstrapped` and `main.ts`
   is guarded by `__ffneContentBootstrapped`, so re-injection on an
   already-loaded tab is a no-op.

3. **Step 3 (retry):** Repeat `sendMessage`. After step 2 completes, the
   `OPEN_SETTINGS` listener is registered synchronously by `SettingsMenu.prime()`
   (inside `EarlyBoot.prime()`), so the retry hits the listener and the modal
   opens.

4. **Tab routing:** If the active tab is not on a supported host (FFN/AO3),
   `openSettingsForTab` opens `https://www.fanfiction.net/` in a new tab and
   queues `openSettingsInTab` on `tabs.onUpdated` (status `complete`).

Each step logs success or failure to the background console with the
`FFN-Enhancements:` prefix so the chain is easy to grep in Firefox
about:debugging.

The dispatch flow does NOT use `window.postMessage` — that approach has a silent
failure mode: `scripting.executeScript({ func })` returns true if the func
*ran*, regardless of whether any `message` listener received the post. On
Firefox MV3 without granted optional host permissions, the content script
never loads, so the listener never exists, but the executeScript call still
succeeds. Using `sendMessage` as primary avoids the false positive.

---

## 3. Platform Abstraction Layer

All browser-extension APIs are accessed through thin wrappers in `src/platform/`:

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
- `set()` writes to localStorage (sync) + `chrome.storage.local` (async persistence).
- `onChanged()` wraps `chrome.storage.onChanged` with local-write guard
  (200ms timestamp window) to prevent double subscriber notification.
- Bridge keys (`ao3_bridge_*`) use the same prefix — do NOT include `ffne_` in
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

- `backgroundFetch()` never throws — errors returned in `response.error`.
- Service worker handles `CrossOriginFetchMessage` by executing `fetch()` with
  full granted host access (no CORS restrictions).
- Blob responses are converted `number[]` → `Uint8Array` → `Blob` (JSON-safe messaging).

### 3.3 Tabs (`src/platform/tabs.ts`)

```typescript
import { openTab } from '../platform/tabs';
await openTab('https://archiveofourown.org/', true);
```

- Delegates to service worker via `OPEN_TAB` message.
- Falls back to `window.open()` if messaging fails.

### 3.4 Message Types (`src/background/message-types.ts`)

Shared type definitions for content-script <-> service-worker communication.
Used by platform layer and service worker. Keep in sync with `service-worker.ts` handler.

---

## 4. Core Architecture Patterns

### 4.1 Module-as-Object-Literal

All modules are plain object literals exported as `const`. There are no classes.

```typescript
export const MyModule = {
    MODULE_NAME: 'my-module',     // used for logging
    init: function () { ... },
    doThing: function () { ... },
};
```

`this` works correctly inside these objects when methods are called as
`MyModule.doThing()`. Be careful when passing methods as callbacks - use
`.bind(this)` or arrow wrappers if needed.

### 4.2 Two-Phase Boot via `EarlyBoot` + `ISitewideModule`

Sitewide modules (ones that need to run on every page, not just one route)
implement the `ISitewideModule` interface:

```typescript
export interface ISitewideModule {
    prime(): void;   // Phase 1: document-start (before HTML is parsed)
    init(): void;    // Phase 2: DOMContentLoaded (DOM fully ready)
}
```

They register themselves with `EarlyBoot` in `main.ts`:

```typescript
EarlyBoot.register(SettingsManager);   // MUST be first
EarlyBoot.register(SettingsMenu);      // MUST be after SettingsManager
EarlyBoot.register(ThemeManager);      // MUST be after SettingsManager, before LayoutManager
EarlyBoot.register(LayoutManager);     // MUST be after ThemeManager
EarlyBoot.prime();                     // Calls prime() on all, synchronously

// Inside the DOMContentLoaded callback:
EarlyBoot.init();                      // Calls init() on all
```

Registration order = execution order. The current required order is:

1. `SettingsManager` - must load all settings into cache before anyone reads them.
2. `SettingsMenu` - reads settings to build menu labels; must come after SettingsManager.
3. `ThemeManager` - reads `theme` setting, injects CSS custom properties and component styles at `prime()` to prevent FOUC; must come before LayoutManager so token vars are available.
4. `LayoutManager` - reads `fluidMode` in `prime()` to prevent FOUC; must come after ThemeManager so fluid CSS layers correctly over theme tokens.

**Phase 1 rules:** `prime()` runs synchronously at `document-start`. Do not
read `document.body` or `document.head` (not guaranteed to exist yet). Safe
operations: inject `<style>` on `document.documentElement`, arm `MutationObserver`,
call synchronous GM functions.

**Phase 2 rules:** `init()` runs at `DOMContentLoaded`. All DOM operations are
safe here.

Programmatic reinjection re-runs `prelude.js` and `main.js`. Keep both guarded
by bootstrap flags (`__ffnePreludeBootstrapped`,
`__ffneContentBootstrapped`) so already-primed tabs do not accumulate duplicate
style tags or listeners.

### 4.3 Delegate / Strategy Pattern (Page Objects)

FFN's DOM structure differs between pages. All CSS selector knowledge lives in
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

DOM keys are defined in `src/enums/Elements.ts`. Add a new key there first,
then implement it in the relevant delegate.

`Core.setDelegate(path)` is called in `Core.startup()` (invoked from `main.ts`)
and sets `Core.activeDelegate`. After that, all modules call:

```typescript
Core.getElement(Elements.MY_KEY)      // single element (null on miss)
Core.getElements(Elements.MY_KEY)     // array (empty on miss)
```

`Core.getElement` first tries the active page-specific delegate, then falls back
to `GlobalDelegate` (chain of responsibility).

### 4.4 Page-Specific Module Routing

`main.ts` routes to page-specific modules after `EarlyBoot.init()`:

```typescript
if (path === "/docs/docs.php")             DocManager.init();
else if (path.includes("/docs/edit.php"))   DocEditor.init();
else if (path.startsWith("/s/"))          { StoryReader.init(); StoryDownloader.init(); }
```

Page-specific modules do not implement `ISitewideModule`. They have a single
`init()` entry point and are called directly.

### 4.5 Services Layer

Doc-related network and parsing concerns were extracted from `Core` into focused
services in `src/services/`:

- `ContentParser` - `TurndownService` instance, `parseHtmlFromPrivateDoc()`,
  `parseContentFromPrivateDoc()`. Consumed by `DocEditor` and `DocFetchService`.
- `DocFetchService` - `_fetchDocPage()`, `fetchAndConvertPrivateDoc()`,
  `fetchPrivateDocAsHtml()`, `refreshPrivateDoc()`. Consumed by `DocManager`.

Both services import `Core` for `getElement`/`getLogger` - no circular deps.

---

## 5. Settings System

### 5.1 SettingsManager (`src/modules/SettingsManager.ts`)

Central key-value store backed by `chrome.storage.local` + `localStorage` mirror
(via `platformStorage`).

- `FFNSettings` interface defines the full schema with types.
- `DEFAULTS` object provides fallbacks for first-time users.
- Storage prefix: `ffne_` (added by `platformStorage` internally).
- In-memory cache (`_cache`) is populated in `prime()` and used for all reads.
  Reads are synchronous and cheap (from `localStorage` via `platformStorage.get()`).
- `_loadAll()` validates enum values on load to guard against stale storage.

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
- `subscribe(key, cb)` returns an unsubscribe function.
- Fires for both local changes (`set()`) and remote changes (cross-tab via
  `chrome.storage.onChanged`).
- Internal storage uses `Map<string, Set<(unknown, unknown)=>void>>`.
- Subscriber errors are caught individually.

**Cross-tab sync (`chrome.storage.onChanged`):**
- Single listener registered in `prime()` via `platformStorage.onChanged()`.
- `platformStorage` handles local-write guard (200ms timestamp window) so
  same-tab changes don't double-fire subscribers.
- `_mirrorThemeCache()` writes theme to `localStorage['ffne_theme_cache']` for
  the prelude to read synchronously at `document_start`.

**To add a new setting:**
1. Add field + type to `FFNSettings` interface.
2. Add default to `DEFAULTS`.
3. Add one-liner in `_loadAll()`: `_loadBool(key)`, `_loadEnum(key, EnumObj)`, or `_loadPositiveNumber(key)`.
4. Automatic: `_registerOnChangedListener()` handles all keys via a single
   `chrome.storage.onChanged` listener.
5. Add a control row in `SettingsPage.ts` (see checklist Section 11).

### 5.2 SettingsMenu (`src/modules/SettingsMenu.ts`)

Registers a single Tampermonkey menu command that opens the settings modal
on the current page via `SettingsPage.openModal()`:

```typescript
GM_registerMenuCommand('FFN Enhancements Settings', () => {
    SettingsPage.openModal();
});
```

**Why not per-setting menu commands?**
The old approach cycled labels via `GM_registerMenuCommand` / `GM_unregisterMenuCommand`.
Two problems:
1. TM closes the extension menu immediately on click - rapid-cycle UX is janky.
2. With `autoClose: false`, labels re-sort alphabetically after each update, which is
   disorienting.
A modal eliminates both issues and allows richer UI.

**Why a modal instead of a new tab?**
Opening `https://www.fanfiction.net/?ffne_settings=1` made an unnecessary server
request just to render our own UI. A modal runs in the same script context, needs
no URL interception, and has direct GM storage access.

`SettingsMenu.ts` itself does not need to change when new settings are added.
Add settings UI in `SettingsPage.ts` instead.

### 5.3 SettingsPage (`src/modules/SettingsPage.ts`)

Modal settings UI injected into `document.body` on the current FFN page.
Opened via `SettingsPage.openModal()`, dismissed via `closeModal()` (x button,
backdrop click, or ESC key).

**No URL interception:**
There is no `?ffne_settings=1` URL or routing intercept in `main.ts`. The modal
runs entirely in the current tab's context - no server request, no navigation.

**Styling:**
Self-contained styles injected into `document.head` on first open (guarded by
`#ffne-settings-styles` ID to prevent duplicates). Uses FFN's colour palette
(`#336699` navy, `#f0f4f8` header bg) and Verdana/Arial for visual consistency.

**Save-on-change UX:**
Changes are persisted immediately via `SettingsManager.set()` on `input/change`
events. A per-row "+" flash indicator (`_flashSaved()`) confirms each save.

**Cross-tab sync:**
`_registerSubscriptions()` registers `SettingsManager.subscribe()` callbacks for
every setting and returns their unsubscribe functions. `closeModal()` calls all
unsubscribers to prevent accumulation across multiple open/close cycles.

**`NUMERIC_KEYS` constant:**
Drives bulk wiring of numeric `<input type="number">` controls. Must stay in sync
with numeric fields in `FFNSettings`. Adding a new numeric setting requires:
1. Adding the key to `NUMERIC_KEYS` in `SettingsPage.ts`.
2. The subscribe loop in `_registerSubscriptions()` then handles it automatically.

**Sections:**
| Section | Settings |
|---|---|
| Appearance | `fluidMode` |
| Document Export | `docDownloadFormat` |
| Reader | `scrollStep` |
| Advanced (collapsible) | `fetchMaxRetries`, `fetchRetryBaseMs`, `iframeLoadTimeoutMs`, `iframeSaveTimeoutMs`, `bulkExportDelayMs`, `bulkCooldownMs`, `bulkRetryDelayMs` |

**GOTCHA:** `openModal()` appends to `document.body` - safe to call any time after
`DOMContentLoaded`. It must NOT be called from `prime()` (document-start, body may
not exist). The TM menu command callback only fires after user interaction, which
is always post-DOMContentLoaded, so this is naturally satisfied.

**GOTCHA:** Always call `closeModal()` to clean up subscriptions and the ESC key
listener. Removing the backdrop element alone leaves listeners dangling.

---

## 5b. Theme System

### Architecture

All colors in the extension flow through **CSS custom properties** (`--ffne-*`).
Default values are defined in `src/styles/ThemeTokens.ts` and injected as a
`:root { ... }` block at `document-start` by `ThemeManager.prime()`. Themes
override these variables; all CSS files consume them via `var(--ffne-*)`.

**Token categories:**
- `--ffne-brand-*` (FFN navy palette)
- `--ffne-semantic-*` (success/error/warning/running)
- `--ffne-ui-*` (surfaces, text levels, borders, toggles)
- `--ffne-shadow-*` (modal, overlay, toast, etc.)
- `--ffne-ui-text-on-accent` (always light text for use on colored backgrounds)

**GOTCHA:** `--ffne-ui-white` maps to a surface color (dark in dark theme).
Do NOT use it for text on colored backgrounds (modal headers, toasts, badges).
Use `--ffne-ui-text-on-accent` instead.

### ThemeManager (`src/modules/ThemeManager.ts`)

Implements `ISitewideModule`. Registered in EarlyBoot between SettingsMenu and
LayoutManager.

**Phase 1 (`prime()`):** Injects token CSS, component CSS, applies HTML class
(`ffne-theme-<name>`), and sets `color-scheme`. Prevents FOUC for our own UI.

**Phase 2 (`init()`):** Runs `CssScanner` to generate FFN native element
overrides, subscribes to theme setting changes, watches `prefers-color-scheme`
for SYSTEM mode, and arms a `MutationObserver` for TinyMCE iframe theming.

**Public API:**
- `setTheme(theme: Theme)` - switch theme (persists via SettingsManager)
- `getResolvedTheme(): Theme` - resolves `SYSTEM` to actual `LIGHT`/`DARK`

### CssScanner (`src/services/CssScanner.ts`)

Runtime CSS scanner (Dark Reader-style). Reads `document.styleSheets`, extracts
color-related properties, maps them via the theme's `colorMap`, and generates
scoped override CSS under `html.ffne-theme-<name>`.

- Skips our own `<style>` tags (ID prefix `ffne-`/`ffe-`/`ffn-enhancements`)
- Handles `@media`/`@supports` grouping rules
- Preserves `!important` and alpha channels
- Caches results per page/theme combination

### Theme Definitions (`src/themes/`)

Each theme implements `IThemeDefinition`:
- `tokens` - CSS var overrides for our injected UI
- `colorMap` - FFN color remapping table for the scanner
- `isDark` - controls `color-scheme` property

Available themes: `SYSTEM` (auto), `LIGHT`, `DARK`, `SEPIA`, `HIGH_CONTRAST`.

Adding a new theme:
1. Create `src/themes/MyTheme.ts` implementing `IThemeDefinition`.
2. Add entry to `src/themes/index.ts` (`THEME_DEFINITIONS`).
3. Add value to `src/enums/Theme.ts`.
4. Add option to `SettingsPage._buildModalHTML()` Appearance section.

### CSS Files

All module CSS is extracted to dedicated `.css` files in `src/styles/`:
- `settings-modal.css` - settings UI
- `fluid-mode.css` - fluid layout overrides
- `components.css` - shared components (cover modal, dropdown, toast, Ao3 panel, status classes)
- `doc-manager.css` - DocManager modals, drawer, table
- `story-edit-content.css` - StoryEditContent bulk replace UI
- `native-overrides.css` - FFN native element overrides (fallback for cross-origin CSS)

Imported via `?raw` and injected as `<style>` tags.

---

## 6. Doc Download Feature

Author documents (from the FFN doc manager/editor) can be exported as
Markdown (default), HTML, or DOCX. The format is controlled by the
`docDownloadFormat` setting.

### DOCX conversion

The DOCX path converts HTML -> OOXML via `DocxBuilder.build(html, title)`.
It reuses the existing `fetchPrivateDocAsHtml()` / `parseHtmlFromPrivateDoc()`
paths - no new fetch or parsing infrastructure needed. `DocxBuilder` produces a
valid Office Open XML archive (ZIP-wrapped) using the already-available `JSZip`
library.

### Content extraction flow

1. `ContentParser.parseHtmlFromPrivateDoc(doc, title)` - reads the raw HTML from the
   TinyMCE `<textarea>` (`Elements.EDITOR_TEXT_AREA`). Returns `string | null`.
2. `ContentParser.parseContentFromPrivateDoc(doc, title)` - calls `parseHtmlFromPrivateDoc`,
   then converts via Turndown. Returns Markdown `string | null`.
3. `DocFetchService._fetchDocPage(docId, title)` - internal shared fetch helper
   that delegates to the generic `fetchWithBackoff` utility for retry/backoff.
   Returns `Document | null`.
4. `DocFetchService.fetchAndConvertPrivateDoc(docId, title)` - fetches a doc page
   and returns Markdown.
5. `DocFetchService.fetchPrivateDocAsHtml(docId, title)` - fetches a doc page
   and returns raw HTML.

**Note:** The shared `fetchWithBackoff(url, options)` utility lives in
`src/utils/fetchWithBackoff.ts` and is used by both `DocFetchService._fetchDocPage` and
`NativeDownloader._fetchChapter`. Centralizes retry count, delay strategy, and
429 handling in one place.

### Format-aware download in modules

Both `DocManager.runSingleExport`, `DocManager.runBulkExport`, and
`DocEditor.exportCurrentDoc` follow the same pattern:

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

**`DocDownloadFormat` enum values ARE the file extensions** (`'md'`, `'html'`),
so `${title}.${format}` produces the correct filename directly.

**`StoryReader` / `StoryDownloader` are NOT affected** by this setting - they
use FicHub integration and `NativeDownloader`, which is reader-facing and outside
the doc-download scope.

---

## 7. Logging

All logging goes through `FFNLogger` (or `Core.getLogger` which delegates to it):

```typescript
// Module-level logger factory (preferred - eliminates repetition)
const log = Core.getLogger(this.MODULE_NAME, 'myFunction');
log('Something happened', optionalData);

// Direct call
FFNLogger.log('ModuleName', 'funcName', 'message', optionalData);
```

Log format: `(ffn-enhancements) <ModuleName> <funcName>: <message>`.

`MODULE_NAME` is a string constant on each module object (e.g., `'doc-manager'`,
`'LayoutManager'`). Keep it consistent and meaningful - it appears in every log line.

---

## 8. Reader Download Stack

Reader-side story downloads (EPUB, MOBI, PDF) are handled separately and are
not related to the doc-download feature:

- `StoryDownloader` - wires the UI; delegates to `IFanficDownloader` implementations.
- `FicHubDownloader` - fetches via the FicHub API using `GM_xmlhttpRequest` (CORS bypass).
  Also injects local FFN cover art into the EPUB via `JSZip`.
- `NativeDownloader` - falls back to the FFN-native download if FicHub is unavailable.
- `EpubBuilder` - low-level EPUB ZIP construction utility.
- `LocalMetadataSerializer` / `FicHubMetadataSerializer` - scrape story metadata
  for EPUB metadata injection.

`GM_xmlhttpRequest` is needed (and granted) because `fichub.net` is a cross-origin
request; normal `fetch()` would be blocked by CORS.

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

1. `document.body` may not exist in `prime()` - use `document.documentElement`
   or arm a `MutationObserver` watching `{ childList: true }` on `documentElement`.
   `LayoutManager._applyFluidClass()` has a complete example of this pattern.

2. TinyMCE loads asynchronously - `DocEditor` and `DocManager` both use
   `MutationObserver` to detect the toolbar/iframe injection rather than assuming
   it is present at `DOMContentLoaded`.

3. `file-saver` is a named export - import as `import { saveAs } from 'file-saver'`
   (not a default import).

4. `vite-plugin-monkey` defaults to unminified output unless `build.minify` is
   explicitly set in the returned Vite config. Keep `build.minify: 'esbuild'`
   enabled for production builds or document-start logic loses parse-time races
   against FFN's first paint.

5. `DocFetchService.refreshPrivateDoc` exists and uses different logic
   (iframe form submission) than `_fetchDocPage`. They were deliberately
   not unified.

6. `SupportedFormats` vs `DocDownloadFormat` - keep them separate. `SupportedFormats`
   is reader-facing (EPUB/MOBI/PDF/etc.). `DocDownloadFormat` is author doc export only.
   They overlap on `HTML` and `MARKDOWN` but serve different contexts.

7. `GM_registerMenuCommand` return type - returns `string | number`; varies by
   Tampermonkey version. Store as `string | number | null` if you ever need to
   unregister. The current `SettingsMenu.ts` does not store the return value.

8. `enableFluidMode()` / `disableFluidMode()` on `LayoutManager` do not persist
   the preference - they are imperative helpers for internal use. Only
   `toggleFluidMode()` persists via `SettingsManager.set()`. If you add new
   explicit enable/disable public calls, make sure to persist there too.

9. `GM_addValueChangeListener` fires for same-tab changes in some TM builds -
   the `!remote` guard in `SettingsManager._registerValueListeners` prevents
   double-applying changes already handled by `set()`. Always include this guard
   when writing new `GM_addValueChangeListener` callbacks.

10. `--ffne-ui-white` is a surface color that becomes dark in dark theme. Never
    use it for text on colored backgrounds (modal headers, toasts, badges). Use
    `--ffne-ui-text-on-accent` instead - it stays light across all themes.

11. `CssScanner` skips `<style>` tags whose `id` starts with `ffne-`, `ffe-`, or
    `ffn-enhancements`. When adding new injected style tags, use one of these
    prefixes to prevent the scanner from generating redundant overrides.

12. FFN's main CSS is cross-origin (CDN-served), so `CssScanner` cannot read
    `cssRules` from those sheets. `native-overrides.css` provides fallback
    element-level overrides using `var(--ffne-*)` tokens. When FFN adds new
    UI patterns not covered by these overrides, add rules there rather than
    trying to expand the scanner's reach.

13. **GOTCHA: Scanner vs native-overrides injection order.** `_injectFfnOverrides`
    concatenates `[scannerCss, elementCss]`. Scanner preserves `!important` from
    original rules. When scanner and native-overrides produce identical selectors
    with `!important` (e.g., `#gui_table1 tbody tr:hover td`), native-overrides
    wins because it comes LAST. If you swap the order, scanner's mechanically-
    remapped colors win and semantic tokens stop working. Native-overrides must
    always be the final word.

14. `userscript.noframes` is intentional. TinyMCE editor iframes are themed from
    the parent document via `iframe.contentDocument`, so do not build features
    that depend on the userscript executing inside subframes.

15. **GOTCHA: Do NOT include `service_worker` in the Firefox manifest.** Firefox
    MV3 uses event pages (`background.scripts`). Firefox 121+ has experimental
    `background.service_worker` support behind the
    `extensions.backgroundServiceWorker.enabled` pref. When BOTH `scripts` and
    `service_worker` keys are present, Firefox may prefer `service_worker`,
    attempt to load the bundle as a real ServiceWorker, fail silently (no
    `type: "module"`; uses `chrome.action.*` which is not on the SW scope on
    Firefox), and never fall back to `scripts`. Result: `action.onClicked`
    listener never registers and the toolbar icon click is a silent no-op.

    The Firefox manifest must contain ONLY `background.scripts` — no
    `service_worker`, no `type: "module"`. Module scripts execute deferred,
    missing the wake-up event dispatch in event-page lifecycles. The bundled
    `service-worker.js` has no imports/exports, so module mode is unnecessary.

    Chrome's manifest retains `service_worker` + `type: "module"`. The
    `patchManifest` helper in `vite.config.ts` handles the per-target split and
    is exported for unit testing in `src/__tests__/viteConfig.test.ts`.

    Register listeners against
    `(globalThis.browser?.action ?? chrome.action).onClicked` so the binding
    works regardless of which namespace Firefox exposes first during
    event-page wake-up.

16. **GOTCHA: `chrome.scripting.executeScript({ func })` does not confirm
    receipt of `window.postMessage` from the injected closure.** The
    `executeScript` promise resolves when the injected function *finishes
    executing*, NOT when any `message` listener acknowledges the post. If the
    content script is not loaded — for example, on Firefox MV3 where optional
    host permissions have not been granted yet —
    `window.postMessage` posts to a window with no `'message'` listener for the
    expected type, the executeScript still resolves successfully, and the
    service worker falsely reports the open-settings dispatch as successful.

    Use `chrome.tabs.sendMessage` for any dispatch where you need to know
    whether the content script actually received the message. sendMessage
    rejects with "Receiving end does not exist" when no listener is registered,
    which is the failure signal the dispatch chain in
    `openSettingsInTab` relies on to trigger the inject + retry fallback. See
    Section 2.1 for the full chain.

17. **GOTCHA: Use `optional_host_permissions`, NOT `host_permissions`, when
    you need `chrome.permissions.request` to prompt the user.** Per MDN:
    `permissions.request()` can ONLY request permissions/origins declared in
    `optional_permissions` / `optional_host_permissions`. On Firefox, calling
    `permissions.request({ origins: [<pattern in host_permissions>] })`
    resolves false (or rejects) without showing a prompt — silently breaking
    any first-run UX that depends on it.

    This extension declares all FFN/AO3/fichub.net patterns under
    `optional_host_permissions` so the service worker's `action.onClicked`
    handler can prompt on first click. Side effect: Chrome no longer shows the
    install-time "Read and change data on..." warning; users see the same
    first-click prompt as Firefox. Tradeoff accepted — one consistent UX
    across browsers beats divergent flows.

    `content_scripts.matches` works against either `host_permissions` or
    `optional_host_permissions` once the corresponding origin is granted —
    no change needed there.

    The drift test in `src/__tests__/contentScriptManifest.test.ts` reads
    `manifest.optional_host_permissions` and asserts it matches
    `REQUESTED_HOST_PATTERNS`. Keep them in sync when adding/removing hosts.

---

## 11. Checklist: Adding a New Setting

1. `src/enums/` - Add a new enum if the value is constrained (e.g., `MyEnum`).
2. `src/modules/SettingsManager.ts`:
   - Add field + type to `FFNSettings`.
   - Add default to `DEFAULTS`.
   - Add one-liner in `_loadAll()`: `_loadBool(key)` / `_loadEnum(key, EnumObj)` / `_loadPositiveNumber(key)`.
   - `_registerValueListeners()` is automatic (iterates `Object.keys(DEFAULTS)`).
3. `src/modules/SettingsPage.ts`:
   - If numeric: add the key to `NUMERIC_KEYS`.
   - Add a `_buildXxxRow(...)` call in `_buildHTML()` under the appropriate section.
   - Add a `SettingsManager.subscribe(key, ...)` call in `_registerSubscriptions()`
     (numeric keys are handled automatically by the `NUMERIC_KEYS` forEach loop).
4. Wire up consuming module(s) to call `SettingsManager.get('yourKey')` at
   call time (not at init time), so changes take effect immediately without reload.
   Use `SettingsManager.subscribe()` for live reactive updates.
5. Add grants to `vite.config.ts` if new GM functions are needed.

`SettingsMenu.ts` does not need to change when new settings are added.

---

## 12. Checklist: Adding a New Page Module

1. `src/enums/Elements.ts` - Add selector keys for new page elements.
2. `src/delegates/` - Create `MyPageDelegate.ts` (spread `BaseDelegate`, implement
   relevant keys).
3. `src/delegates/GlobalDelegate.ts` - Check if any new keys belong here instead.
4. `src/modules/Core.ts` -> `setDelegate()` - add `else if` branch for the new path.
5. `src/modules/MyPageModule.ts` - create the module (object literal, `MODULE_NAME`,
   `init()`).
6. `src/main.ts` - add routing branch calling `MyPageModule.init()`.

*This file must be modified as new paradigms arise.*
