import { describe, it, expect, beforeEach } from 'vitest';
import '../__mocks__/chrome';
import { mockChromeStorage } from '../__mocks__/chrome';
import { platformStorage } from '../../platform/storage';

describe('platformStorage', () => {
    beforeEach(() => {
        mockChromeStorage._reset();
        localStorage.clear();
        platformStorage._resetForTesting();
    });

    describe('get', () => {
        it('returns null for unknown key', () => {
            expect(platformStorage.get('nonexistent')).toBeNull();
        });

        it('returns string value from localStorage', () => {
            localStorage.setItem('ffne_theme', 'dark');
            expect(platformStorage.get('theme')).toBe('dark');
        });

        it('returns boolean from localStorage (JSON-encoded)', () => {
            localStorage.setItem('ffne_fluidMode', 'true');
            expect(platformStorage.get('fluidMode')).toBe(true);
        });

        it('returns number from localStorage (JSON-encoded)', () => {
            localStorage.setItem('ffne_scrollStep', '300');
            expect(platformStorage.get('scrollStep')).toBe(300);
        });

        it('gracefully handles localStorage errors', () => {
            const orig = localStorage.getItem;
            localStorage.getItem = () => { throw new Error('quota exceeded'); };
            expect(platformStorage.get('theme')).toBeNull();
            localStorage.getItem = orig;
        });
    });

    describe('set', () => {
        it('writes to localStorage synchronously', async () => {
            await platformStorage.set('theme', 'dark');
            expect(localStorage.getItem('ffne_theme')).toBe('dark');
        });

        it('writes boolean to localStorage as JSON', async () => {
            await platformStorage.set('fluidMode', true);
            expect(localStorage.getItem('ffne_fluidMode')).toBe('true');
        });

        it('writes number to localStorage as JSON', async () => {
            await platformStorage.set('scrollStep', 300);
            expect(localStorage.getItem('ffne_scrollStep')).toBe('300');
        });

        it('writes to chrome.storage.local', async () => {
            await platformStorage.set('theme', 'dark');
            const stored = await mockChromeStorage.get();
            expect(stored['ffne_theme']).toBe('dark');
        });

        it('subsequent get returns new value', async () => {
            await platformStorage.set('theme', 'sepia');
            expect(platformStorage.get('theme')).toBe('sepia');
        });
    });

    describe('remove', () => {
        it('removes from localStorage and chrome.storage', async () => {
            await platformStorage.set('theme', 'dark');
            await platformStorage.remove('theme');
            expect(platformStorage.get('theme')).toBeNull();
            const stored = await mockChromeStorage.get();
            expect(stored['ffne_theme']).toBeUndefined();
        });
    });

    describe('onChanged', () => {
        it('fires callback for remote storage changes', async () => {
            const calls: Array<{ key: string; newVal: unknown; oldVal: unknown }> = [];
            const unsub = platformStorage.onChanged((key, newVal, oldVal) => {
                calls.push({ key, newVal, oldVal });
            });

            // Simulate remote change (not via platformStorage.set).
            await mockChromeStorage.set({ ffne_theme: 'sepia' });

            expect(calls).toHaveLength(1);
            expect(calls[0].key).toBe('theme');
            expect(calls[0].newVal).toBe('sepia');

            unsub();
        });

        it('mirrors remote changes to localStorage', async () => {
            const unsub = platformStorage.onChanged(() => {});

            await mockChromeStorage.set({ ffne_fluidMode: false });

            // The onChanged handler should mirror the value to localStorage.
            expect(localStorage.getItem('ffne_fluidMode')).toBe('false');

            unsub();
        });

        it('skips local writes (guard against double-fire)', async () => {
            const calls: unknown[] = [];
            const unsub = platformStorage.onChanged((key) => {
                calls.push(key);
            });

            // Local set should notify subscribers directly, not via onChanged.
            await platformStorage.set('theme', 'light');

            // The onChanged handler should skip this because it was a local write.
            expect(calls).toHaveLength(0);

            // But a subsequent remote change should still fire.
            await mockChromeStorage.set({ ffne_theme: 'dark' });
            expect(calls).toHaveLength(1);
            expect(calls[0]).toBe('theme');

            unsub();
        });

        it('ignores keys without ffne_ prefix', async () => {
            const calls: unknown[] = [];
            const unsub = platformStorage.onChanged((key) => {
                calls.push(key);
            });

            await mockChromeStorage.set({ other_key: 'value' });
            expect(calls).toHaveLength(0);

            unsub();
        });

        it('unsubscribe stops receiving events', async () => {
            const calls: unknown[] = [];
            const unsub = platformStorage.onChanged((key) => {
                calls.push(key);
            });

            unsub();

            await mockChromeStorage.set({ ffne_theme: 'dark' });
            expect(calls).toHaveLength(0);
        });

        it('handles key removal (undefined newValue)', async () => {
            // Pre-populate localStorage.
            localStorage.setItem('ffne_theme', 'dark');

            const calls: Array<{ key: string; newVal: unknown }> = [];
            const unsub = platformStorage.onChanged((key, newVal) => {
                calls.push({ key, newVal });
            });

            await mockChromeStorage.remove('ffne_theme');

            expect(calls).toHaveLength(1);
            expect(calls[0].newVal).toBeUndefined();
            expect(localStorage.getItem('ffne_theme')).toBeNull();

            unsub();
        });
    });
});
