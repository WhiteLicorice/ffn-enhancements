// Extension popup script. Provides quick access to settings and FFN/AO3.

import { MessageType } from '../background/message-types';
import { sendToActiveTab } from '../platform/messaging';

document.getElementById('btn-settings')?.addEventListener('click', async () => {
    await sendToActiveTab({ type: MessageType.OPEN_SETTINGS });
    window.close();
});

document.getElementById('btn-ffn')?.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://www.fanfiction.net/' });
});

document.getElementById('btn-ao3')?.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://archiveofourown.org/' });
});
