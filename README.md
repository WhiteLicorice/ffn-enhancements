# ffn-enhancements

A suite of modern enhancements to FFN's old-school interface, for both readers and writers. Inspired by ao3-enhancements.

## Installation

### Step 1: Install a Userscript Manager

To run this script, you need a browser extension that manages userscripts. We recommend:

* **Chrome / Edge / Brave:** [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/)
* **Firefox:** [Tampermonkey](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/) or [Violentmonkey](https://addons.mozilla.org/en-US/firefox/addon/violentmonkey/)
* **Safari:** [Userscripts](https://apps.apple.com/us/app/userscripts/id1463298887)

### Step 2: Install FFN Enhancements

Once you have the extension installed, click the link below. Your userscript manager should automatically prompt you to confirm the installation.

**[Click here to Install](https://github.com/WhiteLicorice/ffn-enhancements/blob/main/ffn-enhancements.user.js)**

*(Note: If the link opens as code, click the `Raw` button or copy the text, open your Userscript Manager dashboard, create a new script, and paste it in.)*

### Step 3: Verify

1. Go to [FanFiction.net Document Manager](https://www.fanfiction.net/docs/docs.php).
2. You should see a new **"Export"** column in your document table and an **"↓ All"** button on the right side of the screen (among other things).
3. Enjoy!

---

## Roadmap by Features
 * [x] Markdown Export: Download documents as Markdown from both the Document Manager (Bulk/Single) and the Doc Editor.
 * [ ] Smart Paste: Copy text from your favorite Markdown editor and paste it directly into FFN's Doc Editor. It automatically renders to HTML. (Preserves standard Docx/HTML formatting if detected).
 * [x] Selectable Text: Forces text to be selectable on story pages, bypassing FFN's copy-paste block.
 * [x] Keyboard Navigation: Bind Arrow keys (or WASD) to navigate chapters and scroll.
 * [ ] Reading Stats: Displays estimated chapter word count and reading time (e.g., "15 min read") at the top of the text.
 * [x] AO3-Style Downloads: Integrated Fichub to allow downloading stories as EPUB, MOBI, PDF, or HTML directly from a story's page.
 * [ ] Layout Modernization: Make story text more large-screen friendly? (Width constraints, typography).
 * [x] Dark Mode: Integrate native dark theme (gave up: highly suggest using the mature [Dark Reader extension](https://darkreader.org/) instead as it handles FFN's legacy DOM much better).

_Feel free to open issues and make suggestions!_

---

## Updating

This script is designed to update automatically.

* Your userscript manager will check for updates periodically.
* To force an update, open your Tampermonkey/Violentmonkey dashboard, click the "Check for updates" button, or reinstall using the process above.

## Compatibility

* **Tested on Browsers:** Edge & Firefox.
