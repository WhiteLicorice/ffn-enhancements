import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from '../modules/SettingsPage';
import './__mocks__/chrome';

vi.mock('../modules/SettingsPage', () => ({
    SettingsPage: { openModal: vi.fn() },
}));

describe('SettingsMenu postMessage listener', () => {
    beforeAll(async () => {
        const { SettingsMenu } = await import('../modules/SettingsMenu');
        SettingsMenu.prime();
    });

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('opens modal when FFNE_OPEN_SETTINGS arrives with null source (Firefox case)', () => {
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'FFNE_OPEN_SETTINGS' },
            source: null,
        }));

        expect(SettingsPage.openModal).toHaveBeenCalledTimes(1);
    });

    it('opens modal when FFNE_OPEN_SETTINGS arrives with window as source (Chrome case)', () => {
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'FFNE_OPEN_SETTINGS' },
            source: window,
        }));

        expect(SettingsPage.openModal).toHaveBeenCalledTimes(1);
    });

    it('ignores messages with the wrong type', () => {
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'EVIL_ATTACK' },
        }));

        expect(SettingsPage.openModal).not.toHaveBeenCalled();
    });
});
