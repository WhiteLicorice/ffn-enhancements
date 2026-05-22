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

    it('describes native-form save timing without old Save-button polling copy', () => {
        SettingsPage.openModal();

        const text = document.body.textContent || '';

        expect(text).toContain('How long to wait for FFN to return a hidden native-form save response.');
        expect(text).toContain('How long to wait for iframe-backed page loads before giving up.');
        expect(text).not.toContain('after clicking Save in the hidden iframe');
        expect(text).not.toContain('readyState="complete" during doc refresh');
    });

    it('shows the native downloader tuning controls under Advanced Settings', () => {
        SettingsPage.openModal();

        const retryInput = document.querySelector<HTMLInputElement>('[data-setting="chapterFetchMaxRetries"]');
        const cooldownInput = document.querySelector<HTMLInputElement>('[data-setting="chapterCooldownMs"]');

        expect(document.body.textContent).toContain('Native Downloader');
        expect(document.body.textContent).toContain('Native Chapter Retry Limit');
        expect(retryInput?.value).toBe('5');
        expect(cooldownInput?.value).toBe('10000');
    });
});
