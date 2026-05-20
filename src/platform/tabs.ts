// Tab management abstraction for browser extension APIs.

import { MessageType } from '../background/message-types';

/**
 * Opens a new tab. Content scripts delegate to the service worker via messaging.
 */
export async function openTab(url: string, active: boolean = true): Promise<void> {
    try {
        await chrome.runtime.sendMessage({
            type: MessageType.OPEN_TAB,
            url,
            active,
        });
    } catch {
        // Fallback: try direct window.open (may be blocked by the browser).
        window.open(url, '_blank');
    }
}
