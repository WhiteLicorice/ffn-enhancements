import { beforeEach, describe, expect, it } from 'vitest';
import { _parseStoredValue, SettingsManager } from '../modules/SettingsManager';
import type { FFNSettings } from '../modules/SettingsManager';
import { Theme } from '../enums/Theme';
import { mockChromeStorage } from './__mocks__/browser';
import { platformStorage } from '../platform/storage';

function populateStorage(entries: Record<string, string | number | boolean>): void {
    for (const [key, value] of Object.entries(entries)) {
        localStorage.setItem(`ffne_${key}`, typeof value === 'string' ? value : JSON.stringify(value));
    }
}

describe('_parseStoredValue — boolean', () => {
    const key = 'fluidMode' as keyof FFNSettings;

    it('parses true as true', () => {
        expect(_parseStoredValue(key, true)).toBe(true);
    });

    it('parses false as false', () => {
        expect(_parseStoredValue(key, false)).toBe(false);
    });

    it('accepts string booleans', () => {
        expect(_parseStoredValue(key, 'true')).toBe(true);
        expect(_parseStoredValue(key, 'false')).toBe(false);
    });

    it('rejects non-boolean values', () => {
        expect(_parseStoredValue(key, 1)).toBeUndefined();
        expect(_parseStoredValue(key, 0)).toBeUndefined();
        expect(_parseStoredValue(key, '')).toBeUndefined();
        expect(_parseStoredValue(key, 'anything')).toBeUndefined();
        expect(_parseStoredValue(key, null)).toBeUndefined();
        expect(_parseStoredValue(key, undefined)).toBeUndefined();
    });
});

describe('_parseStoredValue — number', () => {
    const key = 'scrollStep' as keyof FFNSettings;

    it('parses valid positive integers', () => {
        expect(_parseStoredValue(key, 300)).toBe(300);
        expect(_parseStoredValue(key, 1)).toBe(1);
        expect(_parseStoredValue(key, 9999)).toBe(9999);
    });

    it('parses string numbers', () => {
        expect(_parseStoredValue(key, '300')).toBe(300);
        expect(_parseStoredValue(key, '50')).toBe(50);
    });

    it('parses valid positive floats', () => {
        expect(_parseStoredValue(key, 3.14)).toBe(3.14);
        expect(_parseStoredValue(key, 0.5)).toBe(0.5);
    });

    it('rejects zero', () => {
        expect(_parseStoredValue(key, 0)).toBeUndefined();
    });

    it('rejects negative numbers', () => {
        expect(_parseStoredValue(key, -1)).toBeUndefined();
        expect(_parseStoredValue(key, -100)).toBeUndefined();
    });

    it('rejects NaN', () => {
        expect(_parseStoredValue(key, NaN)).toBeUndefined();
    });

    it('rejects Infinity', () => {
        expect(_parseStoredValue(key, Infinity)).toBeUndefined();
        expect(_parseStoredValue(key, -Infinity)).toBeUndefined();
    });

    it('rejects non-numeric strings', () => {
        expect(_parseStoredValue(key, 'abc')).toBeUndefined();
        expect(_parseStoredValue(key, '')).toBeUndefined();
    });

    it('rejects null/undefined', () => {
        expect(_parseStoredValue(key, null)).toBeUndefined();
        expect(_parseStoredValue(key, undefined)).toBeUndefined();
    });
});

describe('_parseStoredValue — string enum', () => {
    const key = 'docDownloadFormat' as keyof FFNSettings;

    it('accepts valid enum value "md"', () => {
        expect(_parseStoredValue(key, 'md')).toBe('md');
    });

    it('accepts valid enum value "html"', () => {
        expect(_parseStoredValue(key, 'html')).toBe('html');
    });

    it('rejects unknown string values', () => {
        expect(_parseStoredValue(key, 'epub')).toBeUndefined();
        expect(_parseStoredValue(key, 'pdf')).toBeUndefined();
        expect(_parseStoredValue(key, '')).toBeUndefined();
    });

    it('rejects non-string values', () => {
        expect(_parseStoredValue(key, 123)).toBeUndefined();
        expect(_parseStoredValue(key, true)).toBeUndefined();
        expect(_parseStoredValue(key, null)).toBeUndefined();
    });

    it('case-sensitive — rejects "MD"', () => {
        expect(_parseStoredValue(key, 'MD')).toBeUndefined();
    });

    it('returns undefined for undefined raw value', () => {
        expect(_parseStoredValue(key, undefined)).toBeUndefined();
    });
});

describe('_parseStoredValue — theme enum', () => {
    const key = 'theme' as keyof FFNSettings;

    it('accepts valid theme values', () => {
        expect(_parseStoredValue(key, Theme.SYSTEM)).toBe(Theme.SYSTEM);
        expect(_parseStoredValue(key, Theme.DARK)).toBe(Theme.DARK);
        expect(_parseStoredValue(key, Theme.SEPIA)).toBe(Theme.SEPIA);
        expect(_parseStoredValue(key, Theme.HIGH_CONTRAST)).toBe(Theme.HIGH_CONTRAST);
    });

    it('rejects unknown theme values', () => {
        expect(_parseStoredValue(key, 'amoled')).toBeUndefined();
        expect(_parseStoredValue(key, '')).toBeUndefined();
    });
});

describe('_parseStoredValue — edge cases', () => {
    it('handles all known boolean keys', () => {
        const boolKeys: (keyof FFNSettings)[] = [
            'fluidMode', 'pasteConvertMarkdown', 'pasteConvertHtml',
            'pasteForceIntercept', 'ao3HtmlCompatibility', 'normalizeHtmlParagraphs',
            'appendSeparator', 'bulkReplaceAutofill',
        ];
        for (const k of boolKeys) {
            expect(_parseStoredValue(k, true)).toBe(true);
            expect(_parseStoredValue(k, false)).toBe(false);
        }
    });

    it('handles all known number keys', () => {
        const numKeys: (keyof FFNSettings)[] = [
            'scrollStep', 'fetchMaxRetries', 'fetchRetryBaseMs',
            'iframeLoadTimeoutMs', 'iframeSaveTimeoutMs',
            'bulkExportDelayMs', 'bulkCooldownMs', 'bulkRetryDelayMs',
            'chapterFetchMaxRetries', 'chapterRetryBaseMs', 'chapterFetchTimeoutMs',
            'chapterPass1DelayMs', 'chapterCooldownMs', 'chapterPass2DelayMs',
        ];
        for (const k of numKeys) {
            expect(_parseStoredValue(k, 100)).toBe(100);
            expect(_parseStoredValue(k, 0)).toBeUndefined();
        }
    });
});

describe('SettingsManager prime', () => {
    beforeEach(() => {
        mockChromeStorage._reset();
        localStorage.clear();
        platformStorage._resetForTesting();
    });

    it('resets the cache to defaults before each reload', () => {
        populateStorage({ pasteForceIntercept: true });
        SettingsManager.prime();
        expect(SettingsManager.get('pasteForceIntercept')).toBe(true);

        localStorage.clear();
        // Re-prime after clearing — should fall back to defaults.
        SettingsManager.prime();
        expect(SettingsManager.get('pasteForceIntercept')).toBe(false);
    });

    it('mirrors the validated theme into localStorage during prime', () => {
        populateStorage({ theme: Theme.SEPIA });
        SettingsManager.prime();
        expect(window.localStorage.getItem('ffne_theme_cache')).toBe(Theme.SEPIA);
    });

    it('persists local set to localStorage', async () => {
        SettingsManager.prime();
        await SettingsManager.set('theme', Theme.HIGH_CONTRAST);
        // platformStorage mirrors theme to localStorage — but SettingsManager
        // no longer has a separate _mirrorThemeCache. The theme value IS the
        // localStorage entry used by the prelude.
        expect(platformStorage.get('theme')).toBe(Theme.HIGH_CONTRAST);
    });

    it('updates cache on remote storage change', () => {
        SettingsManager.prime();

        // Simulate a remote tab changing the theme via chrome.storage.onChanged.
        // The local-write guard in platformStorage skips self-triggered events,
        // so direct mockChromeStorage.set() fires as a "remote" change.
        void mockChromeStorage.set({ ffne_theme: Theme.DARK });

        expect(SettingsManager.get('theme')).toBe(Theme.DARK);
    });

    it('hydrates cache from chrome.storage.local when the local mirror is empty', async () => {
        await mockChromeStorage.set({ ffne_theme: Theme.SEPIA });

        SettingsManager.prime();
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(SettingsManager.get('theme')).toBe(Theme.SEPIA);
        expect(localStorage.getItem('ffne_theme')).toBe(Theme.SEPIA);
        expect(localStorage.getItem('ffne_theme_cache')).toBe(Theme.SEPIA);
    });
});
