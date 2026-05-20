# ffn-enhancements

A suite of modern enhancements to FFN's old-school interface, for readers and writers. Inspired by [ao3-enhancements](https://github.com/jsmnbom/ao3-enhancements).

---

## Release Channels

| Channel | Install Link | Updates |
|---|---|---|
| **Stable** | [ffn-enhancements.user.js](https://github.com/WhiteLicorice/ffn-enhancements/releases/latest/download/ffn-enhancements.user.js) | Manual trigger, tested |
| **Beta** | [ffn-enhancements.beta.user.js](https://github.com/WhiteLicorice/ffn-enhancements/releases/download/beta/ffn-enhancements.beta.user.js) | Every push to `main`, bleeding-edge |

Both channels auto-update through Tampermonkey. Install one or both — they have different names in the TM dashboard and won't collide. Beta is built straight from `main` on every push. Stable is cut manually and gets extra testing.

---

## For readers

### Download stories in any format

A **Download** button shows up next to Follow/Favourite on every story page. Pick your format:

| Format | Native | FicHub |
|---|---|---|
| EPUB | Yes | Yes |
| MOBI | -- | Yes |
| PDF | -- | Yes |
| HTML | -- | Yes |

**Native** scrapes the story fresh from FFN. Always current, slower. **FicHub** pulls from their archive. Near instant, sometimes behind. If FicHub is down, the extension offers Native as fallback.

EPUB downloads (both sources) embed the story's cover art as the thumbnail.

### Fluid reading mode

FFN boxes content into a narrow column with wide margins. This stretches the page edge to edge, same as AO3. Works at any zoom level and screen width.

### Unlock text selection

FFN blocks text selection and copy on story pages. This removes the block.

### Keyboard navigation

Arrow keys or WASD to move around:

| Key | Action |
|---|---|
| Right / D | Next chapter |
| Left / A | Previous chapter |
| Down / S | Scroll down |
| Up / W | Scroll up |

Hotkeys don't fire when you're typing in a text field or review box.

### Fixed cover art modal

Clicking a story's cover image should open it full size. FFN's jQuery plugin is broken. It just darkens the screen. The extension replaces it with a working lightbox. Click the cover, see the image, click anywhere to close.

### Themes

Five themes: **System** (follows your OS), **Light**, **Dark**, **Sepia**, and **High Contrast**. Picking one restyles both the extension's own UI panels and FFN's native page elements. Switch in Settings. Changes apply instantly across all open FFN tabs.

A critical theme prelude runs at `document-start` (before FFN's own CSS) to set background, text color, and color-scheme, preventing the white flash during page load. On Chromium and Firefox, Tampermonkey Beta's **Instant** inject mode minimizes the remaining injection-delay flash to near-zero. **If this is undesired, then just set theme to Light (default) in the settings and use [Dark Reader](https://darkreader.org/) for dark mode instead.**

---

## For writers

### Export documents in multiple formats

In the **Doc Manager** and **Doc Editor**, an Export button downloads any document as **Markdown** (`.md`), **HTML** (`.html`), or **DOCX** (`.docx`). The format is set in Settings and applies everywhere: single exports, bulk export, and the Editor toolbar.

Markdown doesn't preserve HTML-specific formatting like text alignment. Use HTML or DOCX if you need those.

### Copy to clipboard

In the Doc Editor toolbar, a **Copy** button (two overlapping pages icon) copies the current document in the active format. Markdown and HTML modes copy plain text. DOCX mode copies rich HTML so you can paste it into another editor with formatting intact. A toast confirms the copy.

### Bulk export all documents

In the Doc Manager, **Download All** exports every document as a timestamped `.zip`. Two-pass system with automatic cooldown and retry for documents that fail on the first pass. Failed items get placeholder files in the ZIP so nothing disappears silently.

### Bulk import documents

In the Doc Manager, the **Advanced** panel has a **Bulk Import** button. Point it at a folder of Markdown, HTML, or DOCX files and it maps them to existing documents by semantic numbering (`Chapter 01.md` matches the doc named `1. Chapter 01`). A preview shows what matched, what's missing, and any duplicates before you confirm. Same two-pass retry system as bulk export.

### Refresh documents (reset the 365-day expiry)

FFN documents expire after 365 days untouched. The Doc Manager has a **Refresh** button per row and a **Refresh All** button. Bulk refresh skips documents already at 365 days, highlights each row as it processes, and updates the Life column in place.

### Paste Markdown or HTML into the editor

Writing in Markdown or raw HTML and pasting into FFN's TinyMCE editor? The extension intercepts the paste and converts it to rich text. Markdown syntax is detected and rendered. HTML source is detected and rendered. Both can be toggled independently in Settings. A **Force Intercept** option handles pastes that carry rich-text clipboard data (from Word or Google Docs).

### Migrate stories to AO3

The Doc Manager has an **AO3 Migration** tool. Pick a work URL on AO3, map FFN documents to AO3 chapters, and a cross-tab bridge pushes the content across. The bridge uses GM storage for communication between FFN and AO3 tabs. No server involved. Your data is safe. The migration modal shows progress as each chapter uploads. Failures get a summary you can copy.

### Bulk Replace (Story Edit Content)

On the Story Edit Content page (`/story/story_edit_content.php`), a **Bulk Replace** feature maps documents to chapters and replaces their content in bulk. Same document-to-chapter mapping logic as the AO3 migration tool. Also supports live chapter content preloading and auto-fill for nearby doc-to-chapter mappings.

### Export transforms

Several Settings control how content is processed on export. These apply to single exports, bulk export, clipboard copy, and AO3 migration:

- **AO3 HTML Compatibility**: converts inline `style="text-align:*"` to `align="*"` attributes. AO3's editor strips the former, keeps the latter.
- **Normalize HTML Paragraphs**: flattens multi-line text inside `<p>` tags to single lines and adds blank lines between adjacent paragraphs.
- **Append End Separator**: adds a separator to exported content (`---` for Markdown, `<hr>` for HTML/DOCX).
- **Strip After Marker** (AO3 migration only): drops everything after a custom marker line, so author's notes and trailing content stay behind.

---

## Settings

Open **FFN Enhancements Settings** from your Tampermonkey/Violentmonkey menu on any FFN page. Changes save immediately and sync across all open FanFiction.net tabs.

| Setting | Description |
|---|---|
| Theme | System, Light, Dark, Sepia, or High Contrast |
| Fluid Layout | Toggle full-width reading layout |
| Download Format | Markdown, HTML, or DOCX for doc exports |
| Convert Markdown on Paste | Auto-render Markdown pasted into the Doc Editor |
| Convert HTML on Paste | Auto-render HTML source pasted into the Doc Editor |
| Force Intercept All Pastes | Run detection even on rich-text clipboard data |
| AO3 HTML Compatibility | Convert `text-align` style to `align` attribute on export |
| Normalize HTML Paragraphs | Flatten multi-line paragraph content on export |
| Append End Separator | Add format-specific separator to exported content |
| Bulk Replace Autofill | Auto-map nearby numbered docs after manual source selection |
| Keyboard Scroll Distance | Pixels scrolled per keypress on story pages |
| Advanced | Fetch retry limits, iframe timeouts, bulk export/import delays |

---

## Installation

### Step 1: Install a userscript manager

For the best first-paint behavior and theme injection speed, use **Tampermonkey Beta**:

- **Chrome / Brave:** [Tampermonkey Beta on the Chrome Web Store](https://chromewebstore.google.com/detail/tampermonkey-beta/gcalenpjmijncebpfijmoaglllgpjagf)
- **Edge:** [Tampermonkey Beta on Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/tampermonkey-beta/fcmfnpggmnlmfebfghbfnillijihnkoh)
- **Firefox:** [Tampermonkey](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/) or [Violentmonkey](https://addons.mozilla.org/en-US/firefox/addon/violentmonkey/)
- **Safari:** [Userscripts](https://apps.apple.com/us/app/userscripts/id1463298887)

After installing Tampermonkey Beta on Chrome / Edge / Brave, open **Dashboard -> Settings**, set **Config Mode** to **Advanced**, then under **Experimental** set **Inject Mode** to **Instant**.

### Step 2: Install FFN Enhancements

**Stable release:** [Click here to install](https://github.com/WhiteLicorice/ffn-enhancements/releases/latest/download/ffn-enhancements.user.js).

**Beta release:** [Click here to install](https://github.com/WhiteLicorice/ffn-enhancements/releases/download/beta/ffn-enhancements.beta.user.js).

Your userscript manager should prompt to confirm installation. If the link opens as code or downloads as a file, copy the text, open your userscript manager dashboard, create a new script, and paste it in.

### Theme Flash Limitation

FFN Enhancements injects a compact theme prelude at `document-start`, but userscripts still run through the userscript manager's injection backend. On Chromium browsers, standard injection can briefly show FFN's native light page before the theme prelude lands. Tampermonkey Beta's **Instant** inject mode minimizes this flash, but a tiny first-paint flash may still be possible. A native browser extension would have stronger first-paint primitives than a userscript.

### Step 3: Verify

1. Go to any [FanFiction.net](https://www.fanfiction.net/j/0/2/0/) story.
2. You should see a **Download** button next to **Follow/Favourite**. If you see it, the extension is running.

---

## Updating

Both stable and beta channels auto-update through your userscript manager. Tampermonkey/Violentmonkey checks for updates periodically.

- **Stable:** receives updates when a new version is cut manually. Safer, less frequent.
- **Beta:** receives updates on every push to `main`. Bleeding-edge, may have rough edges.

To force an update, open your userscript manager dashboard and click "Check for updates," or reinstall from the links above.

---

## Compatibility

Tested on Edge and Firefox. Also runs on archiveofourown.org only for the AO3 migration bridge.

---

## Development

TypeScript, Vite, and `vite-plugin-monkey` bundle multiple modules into a single userscript. Tests use [Vitest](https://vitest.dev/) with a `jsdom` environment.

### Setup

```bash
git clone https://github.com/WhiteLicorice/ffn-enhancements.git
cd ffn-enhancements
npm install
```

### Build

```bash
npm run build    # tsc type-check + vite bundle -> dist/ffn-enhancements.user.js
npm run dev      # vite dev server with hot reload (install the local URL into TM once)
```

Local builds use version `0.0.0-dev` with no update URL pointing to production. CI sets `FFNE_VERSION` and `FFNE_BETA` environment variables to produce release artifacts with correct versioning and update URLs.

### Testing

```bash
npm test              # run all tests once
npx vitest            # watch mode -- re-runs on save
npx vitest --ui       # interactive browser UI
```

Test files under `src/__tests__/`, matching `**/*.test.ts`:

| File | What it tests |
|---|---|
| `SimpleMarkdownParser.test.ts` | Markdown detection heuristic and HTML output |
| `SettingsManager.test.ts` | Setting load, save, subscribe, cross-tab sync |
| `SettingsPage.test.ts` | Settings modal HTML structure and control wiring |
| `EpubBuilder.test.ts` | EPUB ZIP structure and OPF/NCX XML validity |
| `DocxBuilder.test.ts` | DOCX ZIP structure and OOXML document content |
| `FicHubDownloader.test.ts` | FicHub API response parsing |
| `DocManager.test.ts` | Bulk export/refresh button reference and smoke tests |
| `DocFetchService.test.ts` | Doc page fetch and content extraction |
| `DocIframeHandler.test.ts` | Paste listener attachment and Markdown/HTML detection |
| `StoryEditContent.test.ts` | Bulk Replace modal and mapping logic |
| `clipboard.test.ts` | Clipboard write fallback chain (GM_setClipboard, ClipboardItem, execCommand) |
| `exportTransform.test.ts` | AO3 HTML compat, paragraph normalization, separator append, marker strip |
| `Ao3Bridge.test.ts` | Bridge message serialization and heartbeat logic |
| `Ao3Service.test.ts` | AO3 page interaction and chapter management |
| `Ao3BridgeClient.test.ts` | FFN-side bridge client request/response handling |
| `CssScanner.test.ts` | Runtime CSS scanner color remapping and caching |
| `ThemeManager.test.ts` | Theme switching, token injection, and prelude integration |
| `LayoutManager.test.ts` | Fluid mode class application and viewport meta injection |
| `bootstrap.test.ts` | Route dispatch and module registration |
| `criticalThemeRequire.test.ts` | Critical theme require payload size and encoding |
| `themePrelude.test.ts` | Prelude guard conditions and localStorage fallback |
| `UiOwnership.test.ts` | Injected style/UI element ID ownership and selector collision |
| `htmlSanitizer.test.ts` | HTML sanitizer safety and tag allowlisting |
| `runBulkOperation.test.ts` | Bulk operation retry and cooldown orchestration |
| `jszip-lock.test.ts` | JSZip version pin and API compatibility |

### CI / CD

| Workflow | Trigger | Output |
|---|---|---|
| `beta-release.yml` | Push to `main` | `ffn-enhancements.beta.user.js` attached to [beta release](https://github.com/WhiteLicorice/ffn-enhancements/releases/tag/beta) |
| `stable-release.yml` | Manual (`workflow_dispatch`) | `ffn-enhancements.user.js` attached to new versioned release |

Both workflows auto-generate categorized patch notes from conventional commit messages.

To cut a stable release:
1. Go to **Actions > Stable Release > Run workflow**.
2. Enter the version (e.g. `0.16.0`).
3. The workflow builds, tags `v0.16.0`, creates a GitHub Release, and uploads the script.

### Commit messages

This project follows semantic commits:

- `feat:` A new feature
- `fix:` A bug fix
- `ux:` UI/UX improvements
- `docs:` Documentation only
- `style:` Formatting, missing semicolons, etc.
- `refactor:` Code restructuring that neither fixes a bug nor adds a feature
- `chore:` Build process or tooling changes
- `meta:` License, metadata, dependency changes
- `debug/test:` Testing, scaffolding, and debugging

Example: `feat: add markdown export to doc manager`

### Contributing

1. Fork the repository.
2. Create a branch with a descriptive prefix:
   - `feat/` for new features
   - `fix/` for bug fixes
   - `refactor/` for code restructuring
   - `docs/` for documentation updates
3. Make your changes. Run `npm test` then `npm run build` to confirm everything is clean.
4. Submit a Pull Request.

---

## Roadmap

- [x] Download documents as Markdown, HTML, or DOCX in both Doc Manager and Doc Editor
- [x] Text selection unlocked on story pages
- [x] Arrow key and WASD chapter navigation
- [x] Download stories as EPUB/PDF/HTML/MOBI (FicHub + Native)
- [x] Fix FFN's broken cover art modal
- [x] Fluid reading mode (edge-to-edge layout)
- [x] Paste Markdown and HTML source into the Doc Editor, auto-converted to rich text
- [x] Single and bulk refresh of document expiry in Doc Manager
- [x] Story cover art embedded in EPUBs as thumbnail
- [x] Settings menu with per-setting controls and cross-tab sync
- [x] Clipboard copy from Doc Editor toolbar
- [x] Bulk import Markdown/HTML/DOCX files into Doc Manager
- [x] AO3 migration bridge (cross-tab, GM-storage IPC)
- [x] Bulk Replace on Story Edit Content page
- [x] Export transforms: AO3 HTML compat, paragraph normalization, end separator
- [x] Site theme support with Light, Dark, Sepia, High Contrast, and System modes
- [x] Critical theme prelude for FOUC prevention
- [x] Automated beta releases on push to main
- [x] Manual stable release pipeline with auto-generated patch notes
- [ ] Custom font settings sitewide (needs a `FontManager` module hooked into the `EarlyBoot` system)
