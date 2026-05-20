// modules/SettingsMenu.ts

import { FFNLogger } from './FFNLogger';
import { ISitewideModule } from '../interfaces/ISiteWideModule';
import { SettingsPage } from './SettingsPage';
import { onMessage } from '../platform/messaging';

const MODULE_NAME = 'SettingsMenu';

/**
 * SettingsMenu
 * Registers a message listener for the extension action to open the settings modal.
 *
 * **Execution model:**
 * - Phase 1 (`prime`): Registers `chrome.runtime.onMessage` listener for
 *   `OPEN_SETTINGS` messages from the service worker.
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
     * Registers the message listener for opening the settings modal.
     */
    prime(): void {
        onMessage((message) => {
            const msg = message as Record<string, unknown>;
            if (msg.type === 'OPEN_SETTINGS') {
                FFNLogger.log(MODULE_NAME, 'openSettings', 'Opening settings modal.');
                SettingsPage.openModal();
                return { ok: true };
            }
            return undefined;
        });
    },

    /**
     * ISitewideModule Phase 2 — DOMContentLoaded. No-op.
     */
    init(): void { /* no-op */ },
};
