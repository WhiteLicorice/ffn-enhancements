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

* [x] Download documents as Markdown in both Doc Manager and Doc Editor.
* [x] Make text selectable while reading.
* [x] Bind arrow keys or WASD keys to chapter navigation.
* [ ] Make story text more large-screen friendly.
* [x] Integrate Ao3's export to EPUB/PDF/HTML/MOBI feature (AZW3 is prioprietary and out of scope).
* [x] Integrate native dark theme (gave up: may I suggest using the mature [Dark Reader](https://darkreader.org/) instead?).

*Feel free to open issues and make suggestions!*

---

## Updating

This script is designed to update automatically.

* Your userscript manager will check for updates periodically.
* To force an update, open your Tampermonkey/Violentmonkey dashboard, click the "Check for updates" button, or reinstall using the process above.

## Compatibility

* **Supported Browsers:** Chrome, Firefox, Edge, Brave, Safari.
* **Mobile:** Works on Android via **Kiwi Browser** or **Firefox** (with Tampermonkey installed). iOS support is experimental via the Userscripts app.