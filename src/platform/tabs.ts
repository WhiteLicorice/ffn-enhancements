import { extensionApi } from './extensionApi';

interface OpenTabResponse {
    ok: boolean;
    error?: string;
}

export async function openTab(url: string, active: boolean = true): Promise<void> {
    try {
        const response = await extensionApi.runtime.sendMessage<OpenTabResponse>({
            type: 'OPEN_TAB',
            url,
            active,
        });
        if (!response.ok) {
            throw new Error(response.error || 'Unable to open tab.');
        }
    } catch {
        window.open(url, '_blank');
    }
}
