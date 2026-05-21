import { beforeEach, describe, expect, it, vi } from 'vitest';

import './__mocks__/browser';
import { SettingsIconHijacker } from '../modules/SettingsIconHijacker';
import { SettingsPage } from '../modules/SettingsPage';

vi.mock('../modules/SettingsPage', () => ({
    SettingsPage: { openModal: vi.fn() },
}));

describe('SettingsIconHijacker', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        document.documentElement.innerHTML = '<body></body>';
        vi.clearAllMocks();
    });

    it('binds an existing icon during prime', () => {
        document.body.innerHTML = '<button class="icon-kub-mobile"></button>';

        SettingsIconHijacker.prime();

        const icon = document.querySelector('.icon-kub-mobile');
        expect(icon?.getAttribute('data-ffne-hijacked')).toBe('1');
        expect(icon?.getAttribute('aria-label')).toBe('FFN Enhancements settings');
        expect(icon?.nextElementSibling?.getAttribute('data-ffne-ui')).toBe('');
    });

    it('opens the modal and suppresses default handling on click', () => {
        document.body.innerHTML = '<button class="icon-kub-mobile"></button>';
        SettingsIconHijacker.prime();

        const icon = document.querySelector('.icon-kub-mobile') as HTMLElement;
        const event = new MouseEvent('click', { bubbles: true, cancelable: true });
        const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
        const stopImmediatePropagationSpy = vi.spyOn(event, 'stopImmediatePropagation');

        icon.dispatchEvent(event);

        expect(preventDefaultSpy).toHaveBeenCalled();
        expect(stopImmediatePropagationSpy).toHaveBeenCalled();
        expect(SettingsPage.openModal).toHaveBeenCalledTimes(1);
    });

    it('binds icons added after prime', async () => {
        SettingsIconHijacker.prime();

        const icon = document.createElement('button');
        icon.className = 'icon-kub-mobile';
        document.body.appendChild(icon);
        await Promise.resolve();

        expect(icon.getAttribute('data-ffne-hijacked')).toBe('1');
    });

    it('does not double-bind an already hijacked icon', () => {
        document.body.innerHTML = '<button class="icon-kub-mobile"></button>';
        const icon = document.querySelector('.icon-kub-mobile') as HTMLElement;

        SettingsIconHijacker.prime();
        const firstSiblingCount = document.querySelectorAll('[data-ffne-ui]').length;
        SettingsIconHijacker.prime();

        expect(icon.getAttribute('data-ffne-hijacked')).toBe('1');
        expect(document.querySelectorAll('[data-ffne-ui]')).toHaveLength(firstSiblingCount);
    });
});
