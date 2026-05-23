FFN Enhancements fills in what FanFiction.net is missing for readers and writers.

---

# For readers

A Download button appears next to Follow/Favourite on every story page. Pick EPUB, MOBI, PDF, or HTML. Native mode scrapes directly from FFN and is always current. FicHub pulls from their archive and is near-instant. If FicHub is down, Native takes over automatically. EPUB files from both sources include the story's cover art as the thumbnail.

Fluid layout stretches the content area edge to edge, like AO3. Arrow keys or WASD navigate between chapters (suppressed in text fields and review boxes). Text selection is unlocked. FFN blocks copy on story pages by default. The broken cover art lightbox is replaced with one that actually opens the image.

Five themes: System (follows OS preference), Light, Dark, Sepia, High Contrast. Theme CSS is injected before the page renders, so there's no flash on load when using a non-light theme.

---

# For writers

The Doc Manager and Doc Editor both get an Export button. Set the format to Markdown, HTML, or DOCX in Settings. That choice applies everywhere: single exports, bulk export, clipboard copy, and AO3 migration.

Doc Manager additions:

- **Download All**. bulk-exports every document as a timestamped ZIP. Two-pass system with automatic retry and cooldown for failures. Nothing disappears silently.
- **Bulk Import**. point it at a folder of Markdown, HTML, or DOCX files. It maps them to existing documents by name, shows a preview with matches, missing files, and duplicates, then uploads on confirm.
- **Refresh / Refresh All**. resets FFN's 365-day document expiry. Bulk refresh skips documents already at max life and updates the table in place.

The Doc Editor toolbar gets a Copy button. Markdown and HTML modes copy plain text. DOCX mode copies rich HTML so you can paste it into Word or Google Docs with formatting intact.

Pasting Markdown or raw HTML into TinyMCE converts it to rich text on the fly. Both can be toggled independently. A Force Intercept option handles pastes that already carry rich-text clipboard data.

The **AO3 Migration** tool maps FFN documents to AO3 chapters and pushes content across tabs using extension storage. No server involved.

Bulk Replace on the Story Edit Content page maps documents to chapters and replaces their content in one pass, with live preloading and auto-fill for nearby mappings.

Export transforms apply to all export paths: AO3 HTML compatibility (converts inline `text-align` style to `align` attribute), paragraph normalization, end separator, and strip-after-marker for AO3 migration.

---

# Settings

Open via the phone icon in the FFN site header on any FFN page at the top-left. Changes save immediately and sync across all open FanFiction.net tabs.

**Theme:** System, Light, Dark, Sepia, or High Contrast
Fluid Layout: Full-width reading layout
**Download Format:** Markdown, HTML, or DOCX for doc exports
**AO3 HTML Compatibility:** Convert `text-align` style to `align` attribute on export
**Normalize HTML Paragraphs:** Flatten multi-line paragraph content on export
**Append End Separator:** Add a format-specific separator to exported content
**Convert Markdown on Paste:** Auto-render Markdown pasted into the Doc Editor
**Convert HTML on Paste:** Auto-render HTML source pasted into the Doc Editor
**Always Convert Pasted Text:** Run conversion even on rich-text clipboard data
**Keyboard Scroll Distance:** Pixels scrolled per keypress on story pages
**Autofill in Bulk Replace:** Auto-map nearby numbered docs after manual source selection
**Advanced:** Doc fetch retry limits, iframe timeouts, bulk export delays, native chapter scraping delays

---

# Compatibility

Tested on Chrome, Edge, and Firefox. Also runs on archiveofourown.org for the AO3 migration bridge, and nothing else.
