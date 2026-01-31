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
* [ ] Make story text more large-screen friendly?
* [x] Integrate Ao3's export to EPUB/PDF/HTML/MOBI feature (AZW3 is prioprietary and out of scope).
* [x] Integrate native dark theme (gave up: may I suggest using the mature [Dark Reader](https://darkreader.org/) instead?).

*Feel free to open issues and make suggestions!*

---

## Updating

This script is designed to update automatically.

* Your userscript manager will check for updates periodically.
* To force an update, open your Tampermonkey/Violentmonkey dashboard, click the "Check for updates" button, or reinstall using the process above.

## Compatibility

* **Tested on Browsers:** Edge & Firefox.

## Development

This project uses Vite, TypeScript, and vite-plugin-monkey to bundle multiple modules into a single userscript.

### Prerequisites

You need Node.js installed on your machine to run the build tools.

### Setup

1. Clone this repository or download the source code.
2. Open your terminal in the project folder.
3. Install the necessary dependencies:
`npm install`

### Building

To generate the final ffn-enhancements.user.js file, run:
`npm run build`

The bundled script will appear in the dist/ folder. You can then drag this file into your browser or copy-paste it into your userscript manager.

### Local Development

If you want to see your changes in real-time without building manually every time, run:
`npm run dev`

Vite will provide a local URL (typically http://localhost:5173/__monkey.user.js). If you install this URL into Tampermonkey once, the script will automatically reload on FanFiction.net whenever you save a change in your code editor.

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


3. Make your changes and test them using `npm run dev`.
4. Submit a Pull Request.

### Commit Messages

This project follows the semantic commits. Start your commit message with a type, followed by a colon and a brief description.

* `feat:` A new feature
* `fix:` A bug fix
* `ux:` User interface or user experience improvements
* `docs:` Documentation only changes
* `style:` Changes that do not affect the meaning of the code (formatting, missing semi-colons, etc)
* `refactor:` A code change that neither fixes a bug nor adds a feature, but makes the codebase better
* `chore:` Build process or auxiliary tool changes
* `meta:` License, metadata, dependency changes, etc.
* Example: `feat: add markdown export to doc manager`