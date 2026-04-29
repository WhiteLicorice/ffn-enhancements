# FFN Enhancements — Agent Orientation Guide

> This file is a jumpstart reference for AI agents working in this repository.
> It captures architecture decisions, conventions, gotchas, and patterns that
> took non-trivial investigation to discover. Update it when you learn something
> new or change something fundamental.

---

## 1. What This Project Is

A **Tampermonkey userscript** that enhances FanFiction.net's interface for both
readers and authors. It is compiled from TypeScript by Vite + `vite-plugin-monkey`
into a single self-contained `.user.js` file that runs on `https://www.fanfiction.net/*`.

The output artifact lives at `dist/ffn-enhancements.user.js` and is distributed
via GitHub Releases (see `vite.config.ts` for `updateURL`/`downloadURL`).

**In-scope pages:**

| Path | Module | Audience |
|---|---|---|
| `/s/*` | `StoryReader` + `StoryDownloader` | Readers |
| `/docs/docs.php` | `DocManager` | Authors |
| `/docs/edit.php` | `DocEditor` | Authors |
| All pages | `LayoutManager`, `SettingsManager`, `SettingsMenu` | Everyone |

---

## 2. Build System

```
npm run build   # tsc && vite build  (TypeScript check + bundle)
npm run dev     # vite               (dev server, hot reload for quick iteration)
```

- TypeScript is **strict** (`strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true`).
  Fix all type errors before considering a build clean.
- `tsconfig.json` targets `ESNext` modules. `tsconfig.node.json` is for Vite config only.
- Vite bundles everything into **one file**. There are no lazy chunks.
- The `require` array in `vite.config.ts` maps CDN scripts to module imports via
  `externalGlobals`. These are **not bundled** — they are injected as `@require`
  directives in the userscript header instead:
  - `jszip` → `JSZip`
  - `file-saver` → `saveAs`
  - `turndown` → `TurndownService`
  - `marked` → `marked`

---

## 3. Importing GM Functions

**CRITICAL.** All `GM_*` functions must be imported from the virtual module `'$'`
(provided by `vite-plugin-monkey`), not from `@types/tampermonkey` globals or
any other package:

```typescript
import { GM_getValue, GM_setValue } from '$';
import { GM_registerMenuCommand, GM_unregisterMenuCommand } from '$';
import { GM_xmlhttpRequest } from '$';
```

Any new GM grant also needs to be added to the `grant` array in `vite.config.ts`.

Current grants: `GM_xmlhttpRequest`, `GM_getValue`, `GM_setValue`,
`GM_registerMenuCommand`, `GM_unregisterMenuCommand`, `GM_openInTab`,
`GM_addValueChangeListener`.

---

## 4. Core Architecture Patterns

### 4.1 Module-as-Object-Literal

All modules are plain **object literals** exported as `const`. There are no classes.

```typescript
export const MyModule = {
    MODULE_NAME: 'my-module',     // used for logging
    init: function () { ... },
    doThing: function () { ... },
};
```

`this` works correctly inside these objects when methods are called as
`MyModule.doThing()`. Be careful when passing methods as callbacks — use
`.bind(this)` or arrow wrappers if needed.

### 4.2 Two-Phase Boot via `EarlyBoot` + `ISitewideModule`

Sitewide modules (ones that need to run on **every** page, not just one route)
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
EarlyBoot.register(LayoutManager);     // MUST be after SettingsManager
EarlyBoot.prime();                     // Calls prime() on all, synchronously

// Inside the DOMContentLoaded callback:
EarlyBoot.init();                      // Calls init() on all
```

**Registration order = execution order.** The current required order is:

1. `SettingsManager` — must load all settings into cache before anyone reads them.
2. `SettingsMenu` — reads settings to build menu labels; must come after SettingsManager.
3. `LayoutManager` — reads `fluidMode` in `prime()` to prevent FOUC; must come after SettingsManager.

**Phase 1 rules:** `prime()` runs synchronously at `document-start`. Do not
read `document.body` or `document.head` (not guaranteed to exist yet). Safe
operations: inject `<style>` on `document.documentElement`, arm `MutationObserver`,
call synchronous GM functions.

**Phase 2 rules:** `init()` runs at `DOMContentLoaded`. All DOM operations are
safe here.

### 4.3 Delegate / Strategy Pattern (Page Objects)

FFN's DOM structure differs between pages. All CSS selector knowledge lives in
**Delegate** objects, never in module business logic.

```
src/delegates/
  IDelegate.ts          — interface: getElement(key, doc?), getElements(key, doc?)
  BaseDelegate.ts       — default no-op implementation (spread to inherit)
  GlobalDelegate.ts     — selectors present on every page (header, wrapper, etc.)
  StoryDelegate.ts      — /s/* specific selectors
  DocManagerDelegate.ts — /docs/docs.php specific selectors
  DocEditorDelegate.ts  — /docs/edit.php specific selectors
  LayoutManagerDelegate.ts — fluid-mode element selectors
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
else if (path.includes("/docs/edit.php")) DocEditor.init();
else if (path.startsWith("/s/"))          { StoryReader.init(); StoryDownloader.init(); }
```

Page-specific modules do **not** implement `ISitewideModule`. They have a single
`init()` entry point and are called directly.

---

## 5. Settings System

### 5.1 SettingsManager (`src/modules/SettingsManager.ts`)

Central key-value store backed by Tampermonkey's `GM_getValue`/`GM_setValue`.

- **`FFNSettings` interface** defines the full schema with types.
- **`DEFAULTS` object** provides fallbacks for first-time users.
- **Storage prefix:** `ffne_` (prevents collisions with other userscripts).
- **In-memory cache** (`_cache`) is populated in `prime()` and used for all reads.
  Reads are synchronous and cheap.
- **`_loadAll()`** validates enum values on load to guard against stale storage.

**API:**
```typescript
SettingsManager.get('docDownloadFormat')      // → DocDownloadFormat
SettingsManager.get('fluidMode')              // → boolean
SettingsManager.set('docDownloadFormat', DocDownloadFormat.HTML)
SettingsManager.set('fluidMode', false)

// Subscribe to changes (returns unsubscribe fn)
const unsub = SettingsManager.subscribe('fluidMode', (newVal, oldVal) => { ... });
unsub(); // remove listener
```

**`subscribe()` pub-sub API:**
- `subscribe(key, cb)` returns an unsubscribe function. Store and call it to clean up.
- Fires for **both** local changes (`set()`) and remote changes (cross-tab via
  `GM_addValueChangeListener`).
- Internal storage uses `Map<string, Set<(unknown, unknown)=>void>>`. Type safety is
  enforced at the public API layer; internals use `unknown`.
- Subscriber errors are caught individually — one bad subscriber can't block others.

**Cross-tab sync (`GM_addValueChangeListener`):**
- Registered in `prime()` for every setting key.
- Fires when another browser tab writes a new value to GM storage.
- The listener calls `_parseStoredValue()` then notifies all `subscribe()` callbacks.
- **GOTCHA:** Some TM builds fire the listener for same-tab changes too (`remote=false`).
  The `!remote` guard prevents double-applying updates already handled by `set()`.
- Wrapped in `try/catch` so it degrades gracefully in non-TM environments.

**To add a new setting:**
1. Add field + type to `FFNSettings` interface.
2. Add default to `DEFAULTS`.
3. Add explicit load line in `_loadAll()` (explicit > generic for type safety).
4. Add `GM_addValueChangeListener` entry in `_registerValueListeners()` — or it's
   automatic since `_registerValueListeners` iterates `Object.keys(DEFAULTS)`.
5. Add a control row in `SettingsPage.ts` (see checklist §11).

**GOTCHA:** `GM_getValue`/`GM_setValue` are synchronous in Tampermonkey but
asynchronous in some MV3 extension runners. If you ever need to support those,
the entire load/save path needs to become async.

### 5.2 SettingsMenu (`src/modules/SettingsMenu.ts`)

Registers a **single** Tampermonkey menu command that opens the settings modal
on the current page via `SettingsPage.openModal()`:

```typescript
GM_registerMenuCommand('⚙️ FFN Enhancements Settings', () => {
    SettingsPage.openModal();
});
```

**Why not per-setting menu commands?**
The old approach cycled labels via `GM_registerMenuCommand` / `GM_unregisterMenuCommand`.
Two problems:
1. TM closes the extension menu immediately on click — rapid-cycle UX is janky.
2. With `autoClose: false`, labels re-sort alphabetically after each update, which is
   disorienting.
A modal eliminates both issues and allows richer UI.

**Why a modal instead of a new tab?**
Opening `https://www.fanfiction.net/?ffne_settings=1` made an unnecessary server
request just to render our own UI. A modal runs in the same script context, needs
no URL interception, and has direct GM storage access.

`SettingsMenu.ts` itself does **not** need to change when new settings are added.
Add settings UI in `SettingsPage.ts` instead.

### 5.3 SettingsPage (`src/modules/SettingsPage.ts`)

Modal settings UI injected into `document.body` on the current FFN page.
Opened via `SettingsPage.openModal()`, dismissed via `closeModal()` (× button,
backdrop click, or ESC key).

**No URL interception:**
There is no `?ffne_settings=1` URL or routing intercept in `main.ts`. The modal
runs entirely in the current tab's context — no server request, no navigation.

**Styling:**
Self-contained styles injected into `document.head` on first open (guarded by
`#ffne-settings-styles` ID to prevent duplicates). Uses FFN's colour palette
(`#336699` navy, `#f0f4f8` header bg) and Verdana/Arial for visual consistency.

**Save-on-change UX:**
Changes are persisted immediately via `SettingsManager.set()` on `input/change`
events. A per-row "✓" flash indicator (`_flashSaved()`) confirms each save.

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

**GOTCHA:** `openModal()` appends to `document.body` — safe to call any time after
`DOMContentLoaded`. It must NOT be called from `prime()` (document-start, body may
not exist). The TM menu command callback only fires after user interaction, which
is always post-DOMContentLoaded, so this is naturally satisfied.

**GOTCHA:** Always call `closeModal()` to clean up subscriptions and the ESC key
listener. Removing the backdrop element alone leaves listeners dangling.

---

## 6. Doc Download Feature

Author documents (from the FFN doc manager/editor) can be exported as either
**Markdown** (default) or **HTML**. The format is controlled by the
`docDownloadFormat` setting.

### Content extraction flow

1. `Core.parseHtmlFromPrivateDoc(doc, title)` — reads the raw HTML from the
   TinyMCE `<textarea>` (`Elements.EDITOR_TEXT_AREA`). Returns `string | null`.
2. `Core.parseContentFromPrivateDoc(doc, title)` — calls `parseHtmlFromPrivateDoc`,
   then converts via Turndown. Returns Markdown `string | null`.
3. `Core._fetchDocPage(docId, title, attempt)` — **internal** shared fetch helper
   with retry logic. Returns `Document | null`.
4. `Core.fetchAndConvertPrivateDoc(docId, title, attempt)` — fetches a doc page
   and returns Markdown.
5. `Core.fetchPrivateDocAsHtml(docId, title, attempt)` — fetches a doc page and
   returns raw HTML.

### Format-aware download in modules

Both `DocManager.runSingleExport`, `DocManager.runBulkExport`, and
`DocEditor.exportCurrentDoc` follow the same pattern:

```typescript
const format = SettingsManager.get('docDownloadFormat');
if (format === DocDownloadFormat.HTML) {
    const html = Core.parseHtmlFromPrivateDoc(doc, title);   // or fetchPrivateDocAsHtml
    saveAs(new Blob([html], { type: "text/html;charset=utf-8" }), `${title}.html`);
} else {
    const md = Core.parseContentFromPrivateDoc(doc, title);  // or fetchAndConvertPrivateDoc
    saveAs(new Blob([md], { type: "text/markdown;charset=utf-8" }), `${title}.md`);
}
```

**`DocDownloadFormat` enum values ARE the file extensions** (`'md'`, `'html'`),
so `` `${title}.${format}` `` produces the correct filename directly.

**`StoryReader` / `StoryDownloader` are NOT affected** by this setting — they
use FicHub integration and `NativeDownloader`, which is reader-facing and outside
the doc-download scope.

---

## 7. Logging

All logging goes through `FFNLogger` (or `Core.getLogger` which delegates to it):

```typescript
// Module-level logger factory (preferred — eliminates repetition)
const log = Core.getLogger(this.MODULE_NAME, 'myFunction');
log('Something happened', optionalData);

// Direct call
FFNLogger.log('ModuleName', 'funcName', 'message', optionalData);
```

Log format: `(ffn-enhancements) <ModuleName> <funcName>: <message>`.

`MODULE_NAME` is a string constant on each module object (e.g., `'doc-manager'`,
`'LayoutManager'`). Keep it consistent and meaningful — it appears in every log line.

---

## 8. Reader Download Stack

Reader-side story downloads (EPUB, MOBI, PDF) are handled separately and are
not related to the doc-download feature:

- `StoryDownloader` — wires the UI; delegates to `IFanficDownloader` implementations.
- `FicHubDownloader` — fetches via the FicHub API using `GM_xmlhttpRequest` (CORS bypass).
  Also injects local FFN cover art into the EPUB via `JSZip`.
- `NativeDownloader` — falls back to the FFN-native download if FicHub is unavailable.
- `EpubBuilder` — low-level EPUB ZIP construction utility.
- `LocalMetadataSerializer` / `FicHubMetadataSerializer` — scrape story metadata
  for EPUB metadata injection.

`GM_xmlhttpRequest` is needed (and granted) because `fichub.net` is a cross-origin
request; normal `fetch()` would be blocked by CORS.

---

## 9. Key Files at a Glance

```
src/
  main.ts                        — Entry point / router; EarlyBoot registration
  enums/
    Elements.ts                  — All DOM selector keys (add new keys here first)
    DocDownloadFormat.ts         — MARKDOWN = 'md' / HTML = 'html'
    SupportedFormats.ts          — Reader-facing formats (EPUB, MOBI, PDF, HTML, MD)
    Globals.ts                   — USER_AGENT string
    FicHubStatus.ts              — FicHub API status codes
  interfaces/
    ISiteWideModule.ts           — prime() / init() contract
    IDelegate.ts                 — getElement / getElements contract
    IFanficDownloader.ts         — downloadAsEPUB / downloadAsMOBI contract
    StoryMetadata.ts             — Metadata shape for serializers
    ChapterData.ts               — Chapter data shape
  delegates/
    BaseDelegate.ts              — No-op defaults (spread to inherit)
    GlobalDelegate.ts            — Selectors common to all pages
    StoryDelegate.ts             — /s/* selectors
    DocManagerDelegate.ts        — /docs/docs.php selectors
    DocEditorDelegate.ts         — /docs/edit.php selectors
    LayoutManagerDelegate.ts     — Fluid mode DOM targets
  modules/
    EarlyBoot.ts                 — Two-phase boot sequencer
    SettingsManager.ts           — Persistent settings (GM storage + in-memory cache + pub-sub)
    SettingsMenu.ts              — Single Tampermonkey menu command → opens SettingsPage
    SettingsPage.ts              — Full-page settings UI (fanfiction.net/?ffne_settings=1)
    LayoutManager.ts             — Fluid layout / viewport meta injection
    Core.ts                      — Delegate broker, logging, content parsing, fetch helpers
    FFNLogger.ts                 — Shared logger (used to avoid circular deps with Core)
    DocManager.ts                — /docs/docs.php: bulk export, export column injection
    DocEditor.ts                 — /docs/edit.php: single-doc export button in TinyMCE toolbar
    DocIframeHandler.ts          — Shared: Markdown paste listener for TinyMCE iframes
    StoryReader.ts               — /s/*: text selection unlock, keyboard nav, cover modal fix
    StoryDownloader.ts           — /s/*: FicHub/Native download button injection
    FicHubDownloader.ts          — FicHub API integration (EPUB/MOBI via GM_xmlhttpRequest)
    NativeDownloader.ts          — FFN-native download fallback
    EpubBuilder.ts               — Low-level EPUB ZIP builder
    SimpleMarkdownParser.ts      — Lightweight Markdown → HTML for paste listener
  serializers/
    LocalMetadataSerializer.ts   — Scrapes FFN story page for EPUB metadata
    FicHubMetadataSerializer.ts  — Parses FicHub API response for EPUB metadata
  factories/
    TinyMCEButtonFactory.ts      — Creates native-looking TinyMCE 4 toolbar buttons
vite.config.ts                   — Build config; GM grants; CDN requires; externalGlobals
tsconfig.json                    — Strict TypeScript config
```

---

## 10. Common Gotchas

1. **`document.body` may not exist in `prime()`** — use `document.documentElement`
   or arm a `MutationObserver` watching `{ childList: true }` on `documentElement`.
   `LayoutManager._applyFluidClass()` has a complete example of this pattern.

2. **TinyMCE loads asynchronously** — `DocEditor` and `DocManager` both use
   `MutationObserver` to detect the toolbar/iframe injection rather than assuming
   it is present at `DOMContentLoaded`.

3. **`file-saver` is a named export** — import as `import { saveAs } from 'file-saver'`
   (not a default import).

4. **`externalGlobals` maps the npm package name to the CDN global** — if you add
   a new CDN dependency, you must add both a `require` entry (the CDN URL) and an
   `externalGlobals` entry (the global variable name) in `vite.config.ts`.

5. **Dead code in `Core.ts`** — `bulkExportPrivateDocs` and `bulkRefreshPrivateDocs`
   exist but are never called externally. They are from an older design iteration.
   Do not call them; consider removing them if they cause confusion.

6. **`Core.refreshPrivateDoc`** exists and fetches the same URL as `_fetchDocPage`
   but uses completely different logic (iframe form submission). It was deliberately
   NOT refactored to use `_fetchDocPage`.

7. **`SupportedFormats` vs `DocDownloadFormat`** — keep them separate. `SupportedFormats`
   is reader-facing (EPUB/MOBI/PDF/etc.). `DocDownloadFormat` is author doc export only.
   They overlap on `HTML` and `MARKDOWN` but serve different contexts.

8. **`GM_registerMenuCommand` return type** — returns `string | number`; varies by
   Tampermonkey version. Store as `string | number | null` if you ever need to
   unregister. The current `SettingsMenu.ts` does not store the return value.

9. **`enableFluidMode()` / `disableFluidMode()`** on `LayoutManager` do NOT persist
   the preference — they are imperative helpers for internal use. Only
   `toggleFluidMode()` persists via `SettingsManager.set()`. If you add new
   explicit enable/disable public calls, make sure to persist there too.

10. **`GM_addValueChangeListener` fires for same-tab changes in some TM builds** —
    the `!remote` guard in `SettingsManager._registerValueListeners` prevents
    double-applying changes already handled by `set()`. Always include this guard
    when writing new GM_addValueChangeListener callbacks.

---

## 11. Checklist: Adding a New Setting

1. `src/enums/` — Add a new enum if the value is constrained (e.g., `MyEnum`).
2. `src/modules/SettingsManager.ts`:
   - Add field + type to `FFNSettings`.
   - Add default to `DEFAULTS`.
   - Add explicit load line in `_loadAll()`.
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

`SettingsMenu.ts` does **not** need to change when new settings are added.

---

## 12. Checklist: Adding a New Page Module

1. `src/enums/Elements.ts` — Add selector keys for new page elements.
2. `src/delegates/` — Create `MyPageDelegate.ts` (spread `BaseDelegate`, implement
   relevant keys).
3. `src/delegates/GlobalDelegate.ts` — Check if any new keys belong here instead.
4. `src/modules/Core.ts` → `setDelegate()` — add `else if` branch for the new path.
5. `src/modules/MyPageModule.ts` — create the module (object literal, `MODULE_NAME`,
   `init()`).
6. `src/main.ts` — add routing branch calling `MyPageModule.init()`.

*This file must be modifed as new paradigms arise.*