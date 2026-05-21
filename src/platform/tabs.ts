import browser from 'webextension-polyfill';

export async function openTab(url: string, active: boolean = true): Promise<void> {
    try {
        await browser.runtime.sendMessage({
            type: 'OPEN_TAB',
            url,
            active,
        });
    } catch {
        window.open(url, '_blank');
    }
}
