// Tab management abstraction for browser extension APIs.

import { runtimeSendMessage } from './chromeApi';

/**
 * Opens a new tab. Content scripts delegate to the service worker via messaging.
 */
export async function openTab(url: string, active: boolean = true): Promise<void> {
    try {
        await runtimeSendMessage({
            type: 'OPEN_TAB',
            url,
            active,
        });
    } catch {
        // Fallback: try direct window.open (may be blocked by the browser).
        window.open(url, '_blank');
    }
}
