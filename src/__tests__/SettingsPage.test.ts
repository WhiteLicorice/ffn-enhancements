import { afterEach, describe, expect, it } from 'vitest';
import { SettingsPage } from '../modules/SettingsPage';

describe('SettingsPage', () => {
    afterEach(() => {
        SettingsPage.closeModal();
        document.body.innerHTML = '';
        document.head.innerHTML = '';
    });

    it('shows the Bulk Replace autofill toggle', () => {
        SettingsPage.openModal();

        const toggle = document.querySelector<HTMLInputElement>('[data-setting="bulkReplaceAutofill"]');

        expect(document.body.textContent).toContain('Autofill in Bulk Replace');
        expect(toggle).not.toBeNull();
        expect(toggle?.type).toBe('checkbox');
        expect(toggle?.checked).toBe(true);
    });
});
