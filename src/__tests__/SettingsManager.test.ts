import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GM_addValueChangeListener, GM_getValue, GM_setValue } from '$';
import { _parseStoredValue, SettingsManager } from '../modules/SettingsManager';
import type { FFNSettings } from '../modules/SettingsManager';
import { Theme } from '../enums/Theme';

// ─── boolean values ──────────────────────────────────────────────────────

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

// ─── number values ───────────────────────────────────────────────────────

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

// ─── string enum values ──────────────────────────────────────────────────

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

// ─── edge cases ──────────────────────────────────────────────────────────

describe('_parseStoredValue — edge cases', () => {
    it('handles all known boolean keys', () => {
        const boolKeys: (keyof FFNSettings)[] = [
            'fluidMode',
            'pasteConvertMarkdown',
            'pasteConvertHtml',
            'pasteForceIntercept',
            'ao3HtmlCompatibility',
            'normalizeHtmlParagraphs',
            'appendSeparator',
            'bulkReplaceAutofill',
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
        ];
        for (const k of numKeys) {
            expect(_parseStoredValue(k, 100)).toBe(100);
            expect(_parseStoredValue(k, 0)).toBeUndefined();
        }
    });
});

describe('SettingsManager prime', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.mocked(GM_getValue).mockImplementation(() => undefined);
        vi.mocked(GM_setValue).mockImplementation(() => {});
        vi.mocked(GM_addValueChangeListener).mockImplementation(() => 1);
        window.localStorage.clear();
    });

    it('resets the cache to defaults before each reload', () => {
        vi.mocked(GM_getValue).mockImplementation((key: string) => (
            key === 'ffne_pasteForceIntercept' ? true : undefined
        ));

        SettingsManager.prime();
        expect(SettingsManager.get('pasteForceIntercept')).toBe(true);

        vi.mocked(GM_getValue).mockImplementation(() => undefined);
        SettingsManager.prime();

        expect(SettingsManager.get('pasteForceIntercept')).toBe(false);
    });

    it('mirrors the validated theme into localStorage during prime and local set', () => {
        vi.mocked(GM_getValue).mockImplementation((key: string) => (
            key === 'ffne_theme' ? Theme.SEPIA : undefined
        ));

        SettingsManager.prime();
        expect(window.localStorage.getItem('ffne_theme_cache')).toBe(Theme.SEPIA);

        SettingsManager.set('theme', Theme.HIGH_CONTRAST);

        expect(window.localStorage.getItem('ffne_theme_cache')).toBe(Theme.HIGH_CONTRAST);
    });

    it('mirrors remote theme changes into localStorage', () => {
        let themeListener: ((name: string, oldValue: unknown, newValue: unknown, remote?: boolean) => void) | undefined;
        vi.mocked(GM_addValueChangeListener).mockImplementation((name, listener) => {
            if (name === 'ffne_theme') {
                themeListener = listener;
            }
            return 1;
        });

        SettingsManager.prime();
        themeListener?.('ffne_theme', Theme.SYSTEM, Theme.DARK, true);

        expect(window.localStorage.getItem('ffne_theme_cache')).toBe(Theme.DARK);
    });
});
