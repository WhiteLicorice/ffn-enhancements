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
        // Legacy path: chrome.runtime.onMessage (used by Chrome sendMessage and as fallback).
        onMessage((message) => {
            const msg = message as Record<string, unknown>;
            if (msg.type === 'OPEN_SETTINGS') {
                FFNLogger.log(MODULE_NAME, 'openSettings', 'Opening settings modal via runtime message.');
                SettingsPage.openModal();
                return { ok: true };
            }
            return undefined;
        });

        // Primary path: window.postMessage. Dispatched by the service worker
        // via scripting.executeScript({ func: triggerSettingsModalViaPostMessage }).
        //
        // GOTCHA: Do NOT compare event.source to window. In Firefox, messages
        // posted from a scripting.executeScript({ func }) injection can arrive
        // with event.source === null (the injected closure runs in the isolated
        // content world's window proxy, which serializes to null when the
        // message crosses the boundary). The event.data.type === 'FFNE_OPEN_SETTINGS'
        // gate is the actual access check; the message type is a private
        // contract between service worker and content script.
        window.addEventListener('message', (event) => {
            if (event.data?.type !== 'FFNE_OPEN_SETTINGS') return;
            FFNLogger.log(MODULE_NAME, 'openSettings', 'Opening settings modal via postMessage.');
            SettingsPage.openModal();
        });
    },

    /**
     * ISitewideModule Phase 2 — DOMContentLoaded. No-op.
     */
    init(): void { /* no-op */ },
};
