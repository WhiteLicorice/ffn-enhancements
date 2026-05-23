# Privacy Policy

**FFN Enhancements** is a browser extension for FanFiction.net and Archive of Our Own. This policy describes what data the extension touches and what it does not.

---

## What the extension stores

The extension stores your settings (theme, layout preferences, export format, and similar options) locally in your browser using `chrome.storage.local` and `localStorage`. All keys are prefixed with `ffne_`.

Nothing is uploaded to any server. Settings never leave your browser.

---

## Network requests

The extension makes network requests only when you trigger an action that requires one.

| Action | Request goes to |
|---|---|
| Download via FicHub | `fichub.net` — the story identifier is sent to retrieve the file |
| Download via Native | `fanfiction.net` — the extension scrapes chapter content directly |
| Doc export (fetch path) | `fanfiction.net` — the extension fetches your own document pages |
| AO3 migration | `archiveofourown.org` — content is pushed to the AO3 tab you opened |

No requests are made to any server run by this extension or its developer. There is no backend.

---

## Third-party services

FicHub (`fichub.net`) is an independent service. When you choose FicHub as your download source, your request is subject to [FicHub's own privacy policy](https://fichub.net). The extension has no control over how FicHub handles requests.

FicHub is optional. Native download does not contact FicHub.

---

## AO3 migration

The AO3 migration tool moves content between your FFN and AO3 browser tabs using extension storage as an in-memory message bus. No data passes through any external server. The extension writes to `chrome.storage.local` in one tab and reads from it in the other. That data is cleared after each migration session.

---

## What the extension does not do

- Does not collect analytics or usage data
- Does not track which stories or documents you access
- Does not send any data to the extension developer
- Does not use crash reporting or telemetry services
- Does not store passwords, account credentials, or personal information

---

## Permissions

The extension requests access to `fanfiction.net`, `archiveofourown.org`, and `fichub.net` as optional host permissions. These are granted on first use. You can revoke them at any time through your browser's extension settings.

---

## Open source

The full source code is available at [github.com/WhiteLicorice/ffn-enhancements](https://github.com/WhiteLicorice/ffn-enhancements). You can verify everything described here by reading the code directly.

---

## Contact

Questions or concerns: open an issue at [github.com/WhiteLicorice/ffn-enhancements/issues](https://github.com/WhiteLicorice/ffn-enhancements/issues).
