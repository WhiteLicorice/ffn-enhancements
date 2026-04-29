// modules/SettingsMenu.ts

import { GM_registerMenuCommand } from '$';
import { FFNLogger } from './FFNLogger';
import { ISitewideModule } from '../interfaces/ISiteWideModule';
import { SettingsPage } from './SettingsPage';

// ─── Constants ────────────────────────────────────────────────────────────────

const MODULE_NAME = 'SettingsMenu';

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * SettingsMenu
 * Registers a single Tampermonkey menu command that opens the settings modal
 * on the current page via `SettingsPage.openModal()`.
 *
 * **Why a modal instead of per-setting menu commands?**
 * The old approach registered one cycling menu command per setting. Two problems:
 * 1. Tampermonkey closes the extension menu immediately on click, making any
 *    rapid-cycle UX feel janky.
 * 2. With `autoClose: false`, the menu options visually re-sort themselves after
 *    each label update, which is disorienting.
 *
 * **Why a modal instead of a new tab?**
 * Opening a new FFN tab just to host settings made an unnecessary server request.
 * A modal runs in the same script context as all other modules, needs no URL
 * interception, and has direct access to GM storage via SettingsManager.
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
        GM_registerMenuCommand('FFN Enhancements', () => {
            FFNLogger.log(MODULE_NAME, 'openSettings', 'Opening settings modal.');
            SettingsPage.openModal();
        });
    },

    /**
     * ISitewideModule Phase 2 — DOMContentLoaded. No-op.
     */
    init(): void { /* no-op */ },
};
