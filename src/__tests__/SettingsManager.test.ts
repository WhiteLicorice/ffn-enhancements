import { describe, it, expect } from 'vitest';
import { _parseStoredValue } from '../modules/SettingsManager';
import type { FFNSettings } from '../modules/SettingsManager';

// ─── boolean values ──────────────────────────────────────────────────────

describe('_parseStoredValue — boolean', () => {
    const key = 'fluidMode' as keyof FFNSettings;

    it('parses true as true', () => {
        expect(_parseStoredValue(key, true)).toBe(true);
    });

    it('parses false as false', () => {
        expect(_parseStoredValue(key, false)).toBe(false);
    });

    it('coerces truthy values to true', () => {
        expect(_parseStoredValue(key, 1)).toBe(true);
        expect(_parseStoredValue(key, 'true')).toBe(true);
        expect(_parseStoredValue(key, 'anything')).toBe(true);
    });

    it('coerces falsy values to false', () => {
        expect(_parseStoredValue(key, 0)).toBe(false);
        expect(_parseStoredValue(key, '')).toBe(false);
        expect(_parseStoredValue(key, null)).toBe(false);
        expect(_parseStoredValue(key, undefined)).toBe(false);
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

// ─── edge cases ──────────────────────────────────────────────────────────

describe('_parseStoredValue — edge cases', () => {
    it('handles all known boolean keys', () => {
        expect(_parseStoredValue('fluidMode', true)).toBe(true);
        expect(_parseStoredValue('fluidMode', false)).toBe(false);
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
