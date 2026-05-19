import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SettingsPage } from '../modules/SettingsPage';
import { SettingsManager } from '../modules/SettingsManager';
import { Theme } from '../enums/Theme';

describe('SettingsPage', () => {
    beforeEach(() => {
        SettingsManager.prime();
    });

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

    it('shows the HTML paragraph normalization toggle enabled by default', () => {
        SettingsPage.openModal();

        const toggle = document.querySelector<HTMLInputElement>('[data-setting="normalizeHtmlParagraphs"]');

        expect(document.body.textContent).toContain('Normalize HTML Paragraph Lines');
        expect(toggle).not.toBeNull();
        expect(toggle?.type).toBe('checkbox');
        expect(toggle?.checked).toBe(true);
    });

    it('shows the theme selector defaulted to system', () => {
        SettingsPage.openModal();

        const select = document.querySelector<HTMLSelectElement>('[data-setting="theme"]');

        expect(document.body.textContent).toContain('Theme');
        expect(select).not.toBeNull();
        expect(select?.value).toBe(Theme.SYSTEM);
        expect(Array.from(select?.options || []).map(option => option.value)).toEqual([
            Theme.SYSTEM,
            Theme.LIGHT,
            Theme.DARK,
            Theme.SEPIA,
            Theme.HIGH_CONTRAST,
        ]);
    });

    it('marks the settings modal root as FFNE-owned UI', () => {
        SettingsPage.openModal();

        expect(document.getElementById('ffne-settings-modal')?.getAttribute('data-ffne-ui')).toBe('');
    });
});
