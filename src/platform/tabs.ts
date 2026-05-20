// Tab management abstraction for browser extension APIs.

import { MessageType } from '../background/message-types';

/**
 * Opens a new tab. In a content script context, delegates to the service worker
 * via messaging. In service worker / popup contexts, uses chrome.tabs directly.
 */
export async function openTab(url: string, active: boolean = true): Promise<void> {
    try {
        await chrome.runtime.sendMessage({
            type: MessageType.OPEN_TAB,
            url,
            active,
        });
    } catch {
        // Fallback: try direct window.open (may be blocked by popup blockers).
        window.open(url, '_blank');
    }
}
