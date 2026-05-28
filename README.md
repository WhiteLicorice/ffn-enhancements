# ffn-enhancements

[![Firefox Add-ons](https://img.shields.io/badge/Firefox-Add--on-orange?style=for-the-badge&logo=firefox-browser&logoColor=white)](https://addons.mozilla.org/en-US/firefox/addon/ffn-enhancements/)
[![Stable Build](https://img.shields.io/github/v/tag/WhiteLicorice/ffn-enhancements?label=Stable&style=for-the-badge&color=orange&sort=semver&filter=*.*.*)](https://github.com/WhiteLicorice/ffn-enhancements/releases/latest)
[![Beta Build](https://img.shields.io/badge/Beta-Latest-orange?style=for-the-badge)](https://github.com/WhiteLicorice/ffn-enhancements/releases/tag/beta)
[![License](https://img.shields.io/github/license/WhiteLicorice/ffn-enhancements?style=for-the-badge&color=green)](LICENSE)

A suite of modern enhancements to FFN's old-school interface, for readers and writers. Inspired by [ao3-enhancements](https://github.com/jsmnbom/ao3-enhancements). Available on Firefox and Chromium.

---

## Release channels

| Channel | Install link | Updates |
|---|---|---|
| **Stable Chrome/Edge** | [ffn-enhancements-chrome.zip](https://github.com/WhiteLicorice/ffn-enhancements/releases/latest/download/ffn-enhancements-chrome.zip) | Manual trigger, tested |
| **Stable Firefox** | [ffn-enhancements-firefox.zip](https://github.com/WhiteLicorice/ffn-enhancements/releases/latest/download/ffn-enhancements-firefox.zip) | Manual trigger, tested |
| **Beta Chrome/Edge** | [ffn-enhancements-chrome-beta.zip](https://github.com/WhiteLicorice/ffn-enhancements/releases/download/beta/ffn-enhancements-chrome-beta.zip) | Every push to `main`, bleeding-edge |
| **Beta Firefox** | [ffn-enhancements-firefox-beta.zip](https://github.com/WhiteLicorice/ffn-enhancements/releases/download/beta/ffn-enhancements-firefox-beta.zip) | Every push to `main`, bleeding-edge |

FFN Enhancements is a native Manifest V3 browser extension. Stable is cut manually and gets extra testing. Beta is built straight from `main` on every push.

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

Theme token CSS is declared in the extension manifest, so the browser injects it before page content is rendered. A tiny `document_start` prelude only applies the saved theme class, which avoids the userscript-era white flash.

---

## For writers

### Export documents in multiple formats

In the **Doc Manager** and **Doc Editor**, an Export button downloads any document as **Markdown** (`.md`), **HTML** (`.html`), or **DOCX** (`.docx`). The format is set in Settings and applies everywhere: single exports, bulk export, and the Editor toolbar.

Markdown doesn't preserve HTML-specific formatting like text alignment. Use HTML or DOCX if you need those.

### Copy to clipboard

In the Doc Editor toolbar, a **Copy** button (two overlapping pages icon) copies the current document in the active format. Markdown and HTML modes copy plain text. DOCX mode copies rich HTML so you can paste it into another editor with formatting intact. A toast confirms the copy.

### Bulk export all documents

In the Doc Manager, **Bulk Export** opens a selection modal. Check off the documents you want, hold Shift to select a range, then confirm. Exports everything as a timestamped `.zip`. Two-pass system with automatic cooldown and retry for documents that fail on the first pass. Failed items get placeholder files in the ZIP so nothing disappears silently.

### Bulk import documents

In the Doc Manager, the **Advanced** panel has a **Bulk Import** button. Point it at a folder of Markdown, HTML, or DOCX files and it maps them to existing documents by semantic numbering (`Chapter 01.md` matches the doc named `1. Chapter 01`). A preview shows what matched, what's missing, and any duplicates before you confirm. Same two-pass retry system as bulk export.

### Bulk delete documents

In the Doc Manager, **Bulk Delete** opens a selection modal. Check off documents to delete and confirm. Each deletion uses an authenticated same-origin request. A second confirmation dialog lists the affected documents before anything is removed. Two-pass retry system catches transient failures.

### Refresh documents (reset the 365-day expiry)

FFN documents expire after 365 days untouched. The Doc Manager has a **Refresh** button per row and a **Refresh All** button that opens a selection modal. Check off the documents to refresh, hold Shift to select a range. Bulk refresh skips documents already at 365 days, highlights each row as it processes, and updates the Life column in place.

### Paste Markdown or HTML into the editor

Writing in Markdown or raw HTML and pasting into FFN's TinyMCE editor? The extension intercepts the paste and converts it to rich text. Markdown syntax is detected and rendered. HTML source is detected and rendered. Both can be toggled independently in Settings. A **Force Intercept** option handles pastes that carry rich-text clipboard data (from Word or Google Docs).

### Migrate stories to AO3

The Doc Manager has an **AO3 Migration** tool. Pick a work URL on AO3, map FFN documents to AO3 chapters, and a cross-tab bridge pushes the content across. The bridge uses extension storage for communication between FFN and AO3 tabs. No server involved. Your data is safe. The migration modal shows progress as each chapter uploads. Failures get a summary you can copy.

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

Open **FFN Enhancements Settings** by clicking the phone icon in the FFN site header (top-left of any FFN page). Changes save immediately and sync across all open FanFiction.net tabs.

| Setting | Description |
|---|---|
| Theme | System, Light, Dark, Sepia, or High Contrast |
| Fluid Layout | Toggle full-width reading layout |
| Download Format | Markdown, HTML, or DOCX for doc exports |
| AO3 HTML Compatibility | Convert `text-align` style to `align` attribute on export |
| Normalize HTML Paragraphs | Flatten multi-line paragraph content on export |
| Append End Separator | Add format-specific separator to exported content |
| Convert Markdown on Paste | Auto-render Markdown pasted into the Doc Editor |
| Convert HTML on Paste | Auto-render HTML source pasted into the Doc Editor |
| Always Convert Pasted Text | Run detection even on rich-text clipboard data |
| Keyboard Scroll Distance | Pixels scrolled per keypress on story pages |
| Autofill in Bulk Replace | Auto-map nearby numbered docs after manual source selection |
| Advanced | Doc fetch retry limits, iframe timeouts, bulk export delays, native chapter scraping delays |

---

## Installation

### Firefox

Install from the [Firefox Add-ons store](https://addons.mozilla.org/en-US/firefox/addon/ffn-enhancements/). Updates are automatic.

To install manually (advanced):

1. Download `ffn-enhancements-firefox.zip` from the [latest release](https://github.com/WhiteLicorice/ffn-enhancements/releases/latest).
2. Extract the ZIP somewhere permanent.
3. Open `about:debugging#/runtime/this-firefox`.
4. Choose **Load Temporary Add-on** and select `manifest.json` from the extracted folder.

Temporary add-ons are removed when Firefox restarts. The signed AMO build is permanent.

### Chrome / Edge / Brave

There is no Chrome Web Store listing. Google charges a 5 USD registration fee to publish on the store. Unlike Firefox, Chromium browsers allow unpacked debug extensions to persist indefinitely, so a store listing is unnecessary.

1. Download `ffn-enhancements-chrome.zip` from the [latest release](https://github.com/WhiteLicorice/ffn-enhancements/releases/latest).
2. Extract the ZIP somewhere permanent.
3. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
4. Select the extracted extension folder.

### First-paint theming

Critical theme and fluid-layout CSS are injected through `manifest.json` content-script CSS. The browser applies these files before the content scripts run, so saved non-light themes do not depend on JavaScript-injected `<style>` tags.

### Verify

1. Go to any [FanFiction.net](https://www.fanfiction.net/j/0/2/0/) story.
2. You should see a **Download** button next to **Follow/Favourite**. If you see it, the extension is running.

---

## Updating

Store builds will auto-update after Chrome Web Store and AMO publishing is in place. GitHub release ZIPs are updated by downloading the new ZIP and replacing the unpacked extension folder.

- **Stable:** receives updates when a new version is cut manually. Safer, less frequent.
- **Beta:** receives updates on every push to `main`. Bleeding-edge, may have rough edges.

---

## Compatibility

Tested on Chrome, Edge, and Firefox. Also runs on archiveofourown.org for the AO3 migration bridge, but does nothing else.

---

## Development

TypeScript and Vite build the MV3 extension into target-specific output folders. Tests use [Vitest](https://vitest.dev/) with a `jsdom` environment.

### Setup

```bash
git clone https://github.com/WhiteLicorice/ffn-enhancements.git
cd ffn-enhancements
npm install
```

### Build

```bash
npm run build:chrome
npm run build:firefox
npm run dev      # rebuild extension files in watch mode
npm run package  # build and zip both browser targets
npm run lint     # ESLint (eslint-plugin-no-unsanitized enforced)
```

Chrome/Edge builds emit `dist-chrome/` with a `background.service_worker` entry. Firefox builds emit `dist-firefox/` with `background.scripts`, because Firefox MV3 does not support service-worker backgrounds. Both targets use `chrome.*` APIs directly; both browsers expose the full `chrome.*` alias with Promise support in MV3 for everything this extension needs. CI sets `FFNE_VERSION` and `FFNE_BETA` to produce release ZIPs with the right manifest version metadata.

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
| `SettingsIconHijacker.test.ts` | FFN nav icon interception, click-to-modal binding, double-bind guard |
| `EpubBuilder.test.ts` | EPUB ZIP structure and OPF/NCX XML validity |
| `DocxBuilder.test.ts` | DOCX ZIP structure and OOXML document content |
| `FicHubDownloader.test.ts` | FicHub API response parsing |
| `DocManager.test.ts` | Bulk export, refresh, delete button wiring and smoke tests |
| `DocFetchService.test.ts` | Doc page fetch and content extraction |
| `DocIframeHandler.test.ts` | Paste listener attachment and Markdown/HTML detection |
| `StoryEditContent.test.ts` | Bulk Replace modal and mapping logic |
| `clipboard.test.ts` | Clipboard write fallback chain (ClipboardItem, execCommand) |
| `exportTransform.test.ts` | AO3 HTML compat, paragraph normalization, separator append, marker strip |
| `CssScanner.test.ts` | Runtime CSS scanner color remapping and caching |
| `ThemeManager.test.ts` | Theme switching, token injection, and prelude integration |
| `LayoutManager.test.ts` | Fluid mode class application and viewport meta injection |
| `bootstrap.test.ts` | Route dispatch and module registration |
| `UiOwnership.test.ts` | Injected style/UI element ID ownership and selector collision |
| `htmlSanitizer.test.ts` | HTML sanitizer safety and tag allowlisting |
| `runBulkOperation.test.ts` | Bulk operation retry and cooldown orchestration |
| `injectStyleOnce.test.ts` | Style injection ordering and document-start migration to head |
| `viteConfig.test.ts` | Manifest patching for Chrome (service_worker) vs Firefox (scripts) |
| `contentScriptManifest.test.ts` | Manifest host permission drift detection |
| `service-worker.test.ts` | Service worker message routing (OPEN_TAB, CROSS_ORIGIN_FETCH) |
| `zipAdapter.test.ts` | ZIP utility round-trip, deflate, and blob conversion |
| `nativeDownloader.test.ts` | NativeDownloader retry flow, pass-2 fallback, and chapter order |
| `platform/extensionApi.test.ts` | Browser API normalization wrapper |
| `platform/storage.test.ts` | Storage layer: localStorage mirror, remote change dedup |

### CI / CD

| Workflow | Trigger | Output |
|---|---|---|
| `beta-release.yml` | Push to `main` | Chrome/Edge and Firefox beta ZIPs attached to [beta release](https://github.com/WhiteLicorice/ffn-enhancements/releases/tag/beta) |
| `stable-release.yml` | Manual (`workflow_dispatch`) | Chrome/Edge and Firefox ZIPs attached to new versioned release |

Both workflows auto-generate categorized patch notes from conventional commit messages.

To cut a stable release:
1. Go to **Actions > Stable Release > Run workflow**.
2. Enter the version (e.g. `0.16.0`).
3. The workflow builds, tags `v0.16.0`, creates a GitHub Release, and uploads the ZIPs.

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
- [x] AO3 migration bridge (cross-tab extension-storage IPC)
- [x] Bulk Replace on Story Edit Content page
- [x] Export transforms: AO3 HTML compat, paragraph normalization, end separator
- [x] Site theme support with Light, Dark, Sepia, High Contrast, and System modes
- [x] Critical theme prelude for FOUC prevention
- [x] Automated beta extension ZIP releases on push to main
- [x] Manual stable extension ZIP release pipeline with auto-generated patch notes
- [x] Bulk delete documents from Doc Manager
- [x] Selection modals with Shift-click range select for bulk operations
- [x] ESLint with `eslint-plugin-no-unsanitized` for DOM safety
- [ ] Custom font settings sitewide (needs a `FontManager` module hooked into the `EarlyBoot` system)
