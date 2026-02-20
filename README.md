# 📃 ffn-enhancements

A suite of modern enhancements to FFN's old-school interface, for both readers and writers. Inspired by [ao3-enhancements](https://github.com/jsmnbom/ao3-enhancements).

# Features

FFN Enhancements is a web extension that quietly fixes the things that have always bugged you about FanFiction.net: as a reader *and* as a writer.

---

## For Readers

### Download Stories in Any Format
A familiar **Download ▾** button appears right next to Follow/Favourite on every story page, just like AO3's. Click it and pick your format:

| Format | Native | FicHub |
|---|---|---|
| EPUB 🔥 | ✅ | ✅ |
| MOBI | — | ✅ |
| PDF | — | ✅ |
| HTML | — | ✅ |

**Native** scrapes the story fresh from FFN itself. Always up to date, takes a little longer. **FicHub** pulls from their archive. Nearly instant, occasionally behind. If FicHub is down, the extension offers to fall back to Native automatically.

EPUB downloads (both Native and FicHub) include the story's **cover art as the thumbnail** inside the file.

---

### Fluid Reading Mode
FFN boxes its content into a narrow column with wide letterboxed margins on either side. FFN Enhancements removes all of that, stretching the page edge-to-edge the way AO3 and most modern sites do. Works correctly at any zoom level and on any screen width.

---

### Unlock Text Selection
FFN disables text selection and copy on story pages. This extension removes that restriction entirely. Select and copy whatever you want.

---

### Keyboard Navigation
Stop reaching for your mouse between chapters. Use **Arrow keys** or **WASD** to navigate:

| Key | Action |
|---|---|
| `→` / `D` | Next chapter |
| `←` / `A` | Previous chapter |
| `↓` / `S` | Scroll down |
| `↑` / `W` | Scroll up |

The hotkeys are smart enough to stay out of the way when you're typing in a text field or the review box.

---

### Fixed Cover Art Modal
Clicking a story's cover image on FFN is supposed to open it full-size. It doesn't. FFN's own jQuery plugin is broken and just darkens the screen. This extension replaces the whole interaction with a working implementation: click the cover, get a proper lightbox with a dark backdrop that displays the cover image. Click anywhere to close.

---

### Proper Mobile Viewport
FFN is missing a `<meta name="viewport">` tag, which causes browsers to assume a fixed ~980px desktop layout regardless of your actual screen or zoom level. The extension injects the missing tag so the page behaves correctly on tablets, phones, and when zooming in on desktop.

---

## For Writers

### Export Documents as Markdown
In both the **Doc Manager** and the **Doc Editor**, a new Export button lets you download any document as a clean `.md` Markdown file. Perfect for backing up your work or moving it to another editor. Markdown is a universal format: feed it into another program to convert it to `.docx`, `.rtf`, or whatever floats your boat.

---

### Bulk Export All Documents
In the Doc Manager, a single **↓ All** button downloads every document in your library in one go, packaged into a timestamped `.zip` file. The extension is polite about rate limits: it uses a two-pass system with automatic cool-down and retry for any documents that fail on the first attempt. Failed items get placeholder files in the ZIP so nothing is silently lost and you know what to re-export.

---

### Paste Markdown Directly into the Editor
Working in Markdown externally and then copying into FFN's editor? The extension intercepts your paste in both the Doc Editor (TinyMCE) and the Doc Manager's Copy-N-Paste box and automatically converts Markdown syntax to the rich-text format FFN expects. No manual reformatting or relying on another app.

---

### Refresh Documents (Reset the 365-Day Expiry)
FFN documents expire after 365 days if they're not touched. The Doc Manager now has a **Refresh** button on each row, and a **↻ All** button that refreshes your entire library in one operation. The bulk refresh is smart: it skips documents that already show 365 days remaining, highlights each row as it processes, and uses the same two-pass retry system as bulk export. When it's done, the Life column updates in place so you can see the result immediately.

---

## Under the Hood

- **Zero configuration** — install and everything works immediately. Plug and forget.
- **Auto-updates** — your web extension manager keeps the extension up to date in the background.
- **Tested on Edge and Firefox.**
- Built with TypeScript, Vite, and `vite-plugin-monkey`. Made with love.

---

# Installation

## Step 1: Install a Web Extension Manager

To run this extension, you need a browser extension that manages web extensions like this one. We recommend:

* **Chrome / Edge / Brave:** [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/)
* **Firefox:** [Tampermonkey](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/) or [Violentmonkey](https://addons.mozilla.org/en-US/firefox/addon/violentmonkey/)
* **Safari:** [Userscripts](https://apps.apple.com/us/app/userscripts/id1463298887)

## Step 2: Install FFN Enhancements

Once you have the extension manager installed, [Click This Button](https://github.com/WhiteLicorice/ffn-enhancements/releases/latest/download/ffn-enhancements.user.js). Your extension manager should automatically prompt you to confirm the installation.

*(Note: If the link opens as code or downloads as one, copy the text, open your extension manager dashboard, create a new script, and paste it in.)*

## Step 3: Verify

1. Go to [FanFiction.net](https://www.fanfiction.net/j/0/2/0/) and view any story.
2. You should see a new **Download** button next to **Follow/Favorite** inspired by Ao3. This means that installation was successful and all other features are available.
3. Enjoy! Please star the repository if you find ffn-enhancements useful!

---

# Roadmap

* [x] Download documents as Markdown in both Doc Manager and Doc Editor. Bulk export allowed.
* [x] Make text selectable while reading.
* [x] Bind arrow keys or WASD keys to chapter navigation.
* [x] Integrate Ao3's export to EPUB/PDF/HTML/MOBI feature (AZW3 is proprietary and out of scope).
* [x] Allow slow, but fresh exporting of stories because FicHub's API may be stale for a while.
* [ ] Integrate native dark theme (gave up: may I suggest using the mature [Dark Reader](https://darkreader.org/) instead? - see the [attempt](https://github.com/WhiteLicorice/ffn-enhancements/pull/20) here, maybe you can help me).
* [x] Make story text more large-screen friendly? Expand it so the borders at the sides are gone.
* [x] Fix FFN's bug where clicking on a story's picture doesn't do anything and just darkens the screen lmao.
* [x] Allow pasting of Markdown into the Doc Editor and Doc Manager's story boxes. It is automatically converted into Docx format.
* [x] Allow single and bulk refresh of author documents life in Doc Manager.
* [x] Inject the story's cover art into EPUBs (from Native and FicHub) as its thumbnail.
* [x] Get rid of the letterboxed borders at the side of the page (requires a `LayoutManager` of some sort).
* [ ] Allow setting of fonts and custom fonts sitewide (requires a `FontManager` module that hooks in the `EarlyBoot` system).
* [ ] UX enhancements from a menu like ao3-enhancements: font, author doc export type, etc, to wire it all up together.
 
*Feel free to open issues and make suggestions!*

---

# Updating

This extension is designed to update automatically.

* Your extension manager will check for updates periodically.
* To force an update, open your Tampermonkey/Violentmonkey dashboard, click the "Check for updates" button, or reinstall using the process above.

# Compatibility

* **Tested on Browsers:** Edge & Firefox.

# Development

This project uses Vite, TypeScript, and vite-plugin-monkey to bundle multiple modules into a single web extension.

## Prerequisites

You need Node.js installed on your machine to run the build tools.

### Setup

1. Clone this repository or download the source code.
2. Open your terminal in the project folder.
3. Install the necessary dependencies:
`npm install`

### Building

To generate the final ffn-enhancements.user.js file, run:
`npm run build`

The bundled extension will appear in the dist/ folder. You can then drag this file into your browser or copy-paste it into your extension manager.

### Local Development

If you want to see your changes in real-time without building manually every time, run:
`npm run dev`

Vite will provide a local URL (typically http://localhost:5173/__monkey.user.js). If you install this URL into Tampermonkey once, the extension will automatically reload on FanFiction.net whenever you save a change in your code editor.

## Contributing

Contributions are welcome. Please follow these guidelines to keep the project organized.

### Workflow

1. Fork the repository.
2. Create a new branch for your changes. Use a prefix that describes the type of change, followed by a specific name:
* `feat/` for new features
* `fix/` for bug fixes
* `refactor/` for code restructuring
* `docs/` for documentation updates
* Example: `feat/vite-plugin-monkey`


3. Make your changes and test them using `npm run build`.
4. Submit a Pull Request.

### Commit Messages

This project follows semantic commits. Start your commit message with a type, followed by a colon and a brief description.

* `feat:` A new feature
* `fix:` A bug fix
* `ux:` User interface or user experience improvements
* `docs:` Documentation only changes
* `style:` Changes that do not affect the meaning of the code (formatting, missing semi-colons, etc)
* `refactor:` A code change that neither fixes a bug nor adds a feature, but makes the codebase better
* `chore:` Build process or auxiliary tool changes
* `meta:` License, metadata, dependency changes, etc.
* `debug/test:` Testing, scaffolding, and debugging.
* Example: `feat: add markdown export to doc manager`
