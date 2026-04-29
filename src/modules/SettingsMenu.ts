// modules/SettingsMenu.ts

import { GM_registerMenuCommand, GM_openInTab } from '$';
import { FFNLogger } from './FFNLogger';
import { ISitewideModule } from '../interfaces/ISiteWideModule';

// ─── Constants ────────────────────────────────────────────────────────────────

const MODULE_NAME = 'SettingsMenu';

/**
 * The URL of the dedicated settings page.
 * The `?ffne_settings=1` query parameter is detected by the routing guard in
 * `main.ts`, which intercepts the page load and renders the settings UI in place
 * of the normal page content. The page still inherits FFN's layout shell
 * (header, nav, footer) for a fully native appearance.
 */
const SETTINGS_URL = 'https://www.fanfiction.net/?ffne_settings=1';

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * SettingsMenu
 * Registers a single Tampermonkey menu command that opens the settings page
 * in a new tab via `GM_openInTab`.
 *
 * **Why a dedicated page instead of `GM_registerMenuCommand` entries per setting?**
 * The old approach registered one cycling menu command per setting. Two problems:
 * 1. Tampermonkey closes the extension menu immediately on click, making any
 *    rapid-cycle UX feel janky.
 * 2. With `autoClose: false`, the menu options visually re-sort themselves after
 *    each label update, which is disorienting.
 * A full settings page opened in a new tab eliminates both issues and allows for
 * richer UI (grouping, descriptions, number inputs, etc.).
 *
 * **Execution model:**
 * - Phase 1 (`prime`): Registers the single "Open Settings" menu command.
 * - Phase 2 (`init`): No-op.
 *
 * **Adding a new setting to the settings page:**
 * 1. Add the field to `FFNSettings` in SettingsManager.ts.
 * 2. Add a control row in `SettingsPage.ts` (HTML builder + subscriber).
 * SettingsMenu.ts itself does not need to change.
 */
export const SettingsMenu: ISitewideModule = {

    /**
     * ISitewideModule Phase 1 — document-start.
     * Registers the "Open Settings" Tampermonkey menu command.
     */
    prime(): void {
        GM_registerMenuCommand('⚙️ FFN Enhancements Settings', () => {
            FFNLogger.log(MODULE_NAME, 'openSettings', `Opening settings page: ${SETTINGS_URL}`);
            GM_openInTab(SETTINGS_URL, { active: true });
        });
    },

    /**
     * ISitewideModule Phase 2 — DOMContentLoaded. No-op.
     */
    init(): void { /* no-op */ },
};

