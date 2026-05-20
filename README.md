# ffn-enhancements

A suite of modern enhancements to FFN's old-school interface, for both readers and writers. Inspired by [ao3-enhancements](https://github.com/jsmnbom/ao3-enhancements).

---

## For Readers

### Download Stories in Any Format

A **Download** button appears next to Follow/Favourite on every story page. Pick your format:

| Format | Native | FicHub |
|---|---|---|
| EPUB | Yes | Yes |
| MOBI | -- | Yes |
| PDF | -- | Yes |
| HTML | -- | Yes |

**Native** scrapes the story fresh from FFN. Always up to date, takes longer. **FicHub** pulls from their archive -- near instant, occasionally behind. If FicHub is down, the extension offers to fall back to Native.

EPUB downloads (both Native and FicHub) include the story's cover art as the thumbnail inside the file.

### Fluid Reading Mode

FFN boxes content into a narrow column with wide letterboxed margins. This stretches the page edge-to-edge, same as AO3 and most modern sites. Works at any zoom level and screen width.

### Unlock Text Selection

FFN disables text selection and copy on story pages. This removes that restriction. Select and copy freely.

### Keyboard Navigation

Arrow keys or WASD to navigate:

| Key | Action |
|---|---|
| Right / D | Next chapter |
| Left / A | Previous chapter |
| Down / S | Scroll down |
| Up / W | Scroll up |

Hotkeys stay out of the way when you're typing in a text field or review box.

### Fixed Cover Art Modal

Clicking a story's cover image on FFN is supposed to open it full-size. FFN's jQuery plugin is broken and just darkens the screen. This replaces it with a working lightbox -- click the cover, see it full-size, click anywhere to close.

### Proper Mobile Viewport

FFN is missing a `<meta name="viewport">` tag, so browsers assume a fixed ~980px desktop layout. The extension injects the missing tag so pages behave on tablets, phones, and when zooming.

---

## For Writers

### Export Documents in Multiple Formats

In both the **Doc Manager** and **Doc Editor**, an Export button downloads any document as **Markdown** (`.md`), **HTML** (`.html`), or **DOCX** (`.docx`). The format is controlled from Settings and applies everywhere: single exports, bulk export, and the Editor toolbar button.

Markdown does not preserve HTML-exclusive formatting like text alignment. Use HTML or DOCX if you need those.

### Copy to Clipboard

In the Doc Editor toolbar, a **Copy** button (the one with two overlapping pages) copies the current document to the clipboard in the active format. Markdown and HTML modes copy plain text. DOCX mode copies rich HTML so you can paste it straight into another editor and keep the formatting. A toast notification confirms the copy.

### Bulk Export All Documents

In the Doc Manager, **Download All** downloads every document in your library as a timestamped `.zip`. The extension respects rate limits: two-pass system with automatic cool-down and retry for documents that fail on the first pass. Failed items get placeholder files in the ZIP so nothing is silently lost.

### Bulk Import Documents

In the Doc Manager, the **Advanced** panel has a **Bulk Import** button. Point it at a folder of Markdown, HTML, or DOCX files and it maps them to existing documents by semantic numbering (e.g. `Chapter 01.md` matches the doc named "1. Chapter 01"). A preview modal shows what matched, what's missing, and any duplicates before you confirm. Uses the same two-pass retry system as bulk export.

### Refresh Documents (Reset the 365-Day Expiry)

FFN documents expire after 365 days untouched. The Doc Manager has a **Refresh** button per row and a **Refresh All** button. Bulk refresh skips documents already at 365 days, highlights each row as it processes, and updates the Life column in place when done.

### Paste Markdown or HTML into the Editor

Writing in Markdown or raw HTML and pasting into FFN's TinyMCE editor? The extension intercepts the paste and converts it to rich text automatically. Markdown syntax is detected and rendered. HTML source is detected and rendered. Both can be toggled independently in Settings. There's also a **Force Intercept** option for pastes that carry rich-text clipboard data (e.g. from Word or Google Docs).

### Migrate Stories to AO3

The Doc Manager has an **AO3 Migration** tool. Pick a work URL on AO3, map FFN documents to AO3 chapters, and a cross-tab bridge pushes the content across. The bridge uses GM storage as the communication channel between your FFN and AO3 tabs -- no server involved. The migration modal shows progress as each chapter uploads. Any failures get a summary you can copy.

This is also available standalone from the **Bulk Replace** feature on the Story Edit Content page (`/story/story_edit_content.php`), which maps documents to chapters and replaces their content in bulk.

### Export Transforms

Several Settings control how content is processed on export. These apply to single exports, bulk export, clipboard copy, and AO3 migration:

- **AO3 HTML Compatibility** -- converts inline `style="text-align:*"` to `align="*"` attributes since AO3's editor strips the former but keeps the latter.
- **Normalize HTML Paragraphs** -- flattens multi-line text inside `<p>` tags to single lines and adds blank lines between adjacent paragraphs.
- **Append End Separator** -- tacks a separator onto exported content (`---` for Markdown, `<hr>` for HTML/DOCX).
- **Strip After Marker** (AO3 migration only) -- drops everything after a custom marker line, so author's notes and other trailing content stay behind.

---

## Settings

Click **FFN Enhancements Settings** in your Tampermonkey/Violentmonkey menu on any FFN page. Changes save immediately and sync to all open FanFiction.net tabs.

| Setting | Description |
|---|---|
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

### Step 1: Install a Web Extension Manager

- **Chrome / Edge / Brave:** [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/)
- **Firefox:** [Tampermonkey](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/) or [Violentmonkey](https://addons.mozilla.org/en-US/firefox/addon/violentmonkey/)
- **Safari:** [Userscripts](https://apps.apple.com/us/app/userscripts/id1463298887)

### Step 2: Install FFN Enhancements

[Click here to install](https://github.com/WhiteLicorice/ffn-enhancements/releases/latest/download/ffn-enhancements.user.js). Your extension manager should prompt you to confirm.

If the link opens as code or downloads as a file, copy the text, open your extension manager dashboard, create a new script, and paste it in.

> Tampermonkey on Chrome / Edge / Brave: open Dashboard -> Settings -> Experimental and set **Inject Mode** to **Instant**. Chrome's MV3 injection path can otherwise flash FFN's native page before FFN Enhancements applies its document-start styling.

### Step 3: Verify

1. Go to any [FanFiction.net](https://www.fanfiction.net/j/0/2/0/) story.
2. You should see a **Download** button next to **Follow/Favourite**. That means the extension is running and all features are available.

---

## Roadmap

- [x] Download documents as Markdown, HTML, or DOCX in both Doc Manager and Doc Editor
- [x] Make text selectable while reading
- [x] Bind arrow keys and WASD to chapter navigation
- [x] Download stories as EPUB/PDF/HTML/MOBI via FicHub and Native
- [x] Fix FFN's broken cover art modal
- [x] Fluid reading mode (edge-to-edge layout)
- [x] Paste Markdown and HTML source into the Doc Editor, auto-converted to rich text
- [x] Single and bulk refresh of document expiry in Doc Manager
- [x] Inject story cover art into EPUBs as thumbnail
- [x] Settings menu with per-setting controls and cross-tab sync
- [x] Clipboard copy from Doc Editor toolbar
- [x] Bulk import Markdown/HTML/DOCX files into Doc Manager
- [x] AO3 migration bridge (cross-tab, GM-storage IPC)
- [x] Bulk Replace on Story Edit Content page
- [x] Export transforms: AO3 HTML compat, paragraph normalization, end separator
- [ ] Custom font settings sitewide (needs a `FontManager` module hooked into the `EarlyBoot` system)

[Dark theme](https://github.com/WhiteLicorice/ffn-enhancements/pull/20) was attempted but abandoned. Try the mature [Dark Reader](https://darkreader.org/) extension instead.

---

## Updating

The extension updates automatically. Your extension manager checks periodically. To force an update, open your Tampermonkey/Violentmonkey dashboard and click "Check for updates," or reinstall from the link above.

## Compatibility

Tested on Edge and Firefox.

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

### Testing

```bash
npm test              # run all tests once
npx vitest            # watch mode -- re-runs on save
npx vitest --ui       # interactive browser UI
```

Test files live under `src/__tests__/` and match `**/*.test.ts`:

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

### Contributing

1. Fork the repository.
2. Create a branch with a descriptive prefix:
   - `feat/` for new features
   - `fix/` for bug fixes
   - `refactor/` for code restructuring
   - `docs/` for documentation updates
3. Make your changes. Run `npm test` then `npm run build` to confirm everything is clean.
4. Submit a Pull Request.

### Commit Messages

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
