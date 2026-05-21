export async function openTab(url: string, active: boolean = true): Promise<void> {
    try {
        await chrome.runtime.sendMessage({
            type: 'OPEN_TAB',
            url,
            active,
        });
    } catch {
        window.open(url, '_blank');
    }
}
