// Platform storage abstraction over chrome.storage.local + localStorage mirror.
//
// Design:
// - get() reads synchronously from localStorage (needed for document-start reads).
// - set() writes to both localStorage (sync, for immediate reads) and
//   chrome.storage.local (async, for persistence + cross-tab sync).
// - onChanged() wraps chrome.storage.onChanged for cross-tab sync.
//   Returns unsubscribe function matching the SettingsManager.subscribe() pattern.
//
// Local-write guard: When set() writes a key, it stamps a pending entry so the
// subsequent chrome.storage.onChanged event (which fires in the same context)
// is skipped — local subscribers are already notified by set() itself.
// Remote changes (other tabs, service worker) pass through normally.

import { storageGet, storageRemove, storageSet } from './chromeApi';

const STORAGE_PREFIX = 'ffne_';

/** Keys recently written locally, mapped to the write timestamp. */
const _pendingLocalWrites = new Map<string, number>();

/** Window within which an onChanged event is considered a local echo (ms). */
const LOCAL_WRITE_GUARD_MS = 200;

function _cleanStalePendingWrites(): void {
    const now = Date.now();
    for (const [key, ts] of _pendingLocalWrites) {
        if (now - ts >= LOCAL_WRITE_GUARD_MS) {
            _pendingLocalWrites.delete(key);
        }
    }
}

export interface PlatformStorage {
    get(key: string): string | number | boolean | null;
    set(key: string, value: string | number | boolean): Promise<void>;
    remove(key: string): Promise<void>;
    hydrateFromPersistentStorage(): Promise<Record<string, string | number | boolean>>;
    onChanged(callback: (key: string, newValue: unknown, oldValue: unknown) => void): () => void;
    _resetForTesting(): void;
}

function fullKey(key: string): string {
    return `${STORAGE_PREFIX}${key}`;
}

function parseStored(raw: string | null): string | number | boolean | null {
    if (raw === null) return null;
    // chrome.storage.local preserves JS types. localStorage stores strings.
    // Try JSON.parse to recover numbers and booleans from localStorage strings.
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'number' || typeof parsed === 'boolean') return parsed;
    } catch {
        // Not JSON-encoded, return raw string.
    }
    return raw;
}

function serializeForLocal(value: string | number | boolean): string {
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
}

export const platformStorage: PlatformStorage = {
    get(key: string): string | number | boolean | null {
        try {
            const raw = localStorage.getItem(fullKey(key));
            return parseStored(raw);
        } catch {
            return null;
        }
    },

    async set(key: string, value: string | number | boolean): Promise<void> {
        const fk = fullKey(key);
        _cleanStalePendingWrites();

        // Sync write for immediate reads (document-start safe).
        try {
            localStorage.setItem(fk, serializeForLocal(value));
        } catch {
            // localStorage unavailable — non-fatal.
        }

        // Stamp before the async call so the onChanged handler can check it.
        _pendingLocalWrites.set(fk, Date.now());

        // Async write for persistence + cross-tab sync.
        await storageSet({ [fk]: value });
    },

    async remove(key: string): Promise<void> {
        const fk = fullKey(key);
        try {
            localStorage.removeItem(fk);
        } catch {
            // non-fatal
        }
        _pendingLocalWrites.set(fk, Date.now());
        await storageRemove(fk);
    },

    async hydrateFromPersistentStorage(): Promise<Record<string, string | number | boolean>> {
        const stored = await storageGet(null);
        const hydrated: Record<string, string | number | boolean> = {};

        for (const [key, value] of Object.entries(stored)) {
            if (!key.startsWith(STORAGE_PREFIX)) continue;
            if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue;

            try {
                localStorage.setItem(key, serializeForLocal(value));
            } catch {
                // localStorage unavailable — non-fatal.
            }

            hydrated[key.slice(STORAGE_PREFIX.length)] = value;
        }

        return hydrated;
    },

    /** Clears pending write guard state. Exported for test isolation only. */
    _resetForTesting(): void {
        _pendingLocalWrites.clear();
    },

    onChanged(callback: (key: string, newValue: unknown, oldValue: unknown) => void): () => void {
        const handler = (
            changes: Record<string, chrome.storage.StorageChange>,
            _areaName: string,
        ) => {
            _cleanStalePendingWrites();
            for (const [changedKey, change] of Object.entries(changes)) {
                if (!changedKey.startsWith(STORAGE_PREFIX)) continue;
                const shortKey = changedKey.slice(STORAGE_PREFIX.length);

                // Skip local writes — subscribers already notified by set().
                const localTs = _pendingLocalWrites.get(changedKey);
                if (localTs !== undefined && Date.now() - localTs < LOCAL_WRITE_GUARD_MS) {
                    _pendingLocalWrites.delete(changedKey);
                    continue;
                }

                // Mirror remote change to localStorage for sync reads.
                try {
                    if (change.newValue !== undefined) {
                        const raw = change.newValue as string | number | boolean;
                        localStorage.setItem(changedKey, serializeForLocal(raw));
                    } else {
                        localStorage.removeItem(changedKey);
                    }
                } catch {
                    // non-fatal
                }

                callback(shortKey, change.newValue, change.oldValue);
            }
        };
        chrome.storage.onChanged.addListener(handler);
        return () => chrome.storage.onChanged.removeListener(handler);
    },
};
