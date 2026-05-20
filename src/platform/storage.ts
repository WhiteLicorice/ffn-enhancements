// Platform storage abstraction over chrome.storage.local + localStorage mirror.
//
// Design:
// - get() reads synchronously from localStorage (needed for document-start reads).
// - set() writes to both localStorage (sync, for immediate reads) and
//   chrome.storage.local (async, for persistence + cross-tab sync).
// - onChanged() wraps chrome.storage.onChanged for cross-tab sync.
//   Returns unsubscribe function matching the SettingsManager.subscribe() pattern.

const STORAGE_PREFIX = 'ffne_';

export interface PlatformStorage {
    get(key: string): string | number | boolean | null;
    set(key: string, value: string | number | boolean): Promise<void>;
    remove(key: string): Promise<void>;
    onChanged(callback: (key: string, newValue: unknown, oldValue: unknown) => void): () => void;
}

function fullKey(key: string): string {
    return `${STORAGE_PREFIX}${key}`;
}

function parseStored(raw: string | null): string | number | boolean | null {
    if (raw === null) return null;
    // Try JSON parse for numbers and booleans stored as strings.
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'number' || typeof parsed === 'boolean') return parsed;
    } catch {
        // Not JSON, return as string.
    }
    return raw;
}

function serializeStored(value: string | number | boolean): string {
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
        const serialized = serializeStored(value);

        // Sync write for immediate reads.
        try {
            localStorage.setItem(fk, serialized);
        } catch {
            // localStorage unavailable — non-fatal.
        }

        // Async write for persistence.
        await chrome.storage.local.set({ [fk]: value });
    },

    async remove(key: string): Promise<void> {
        const fk = fullKey(key);
        try {
            localStorage.removeItem(fk);
        } catch {
            // non-fatal
        }
        await chrome.storage.local.remove(fk);
    },

    onChanged(callback: (key: string, newValue: unknown, oldValue: unknown) => void): () => void {
        const handler = (
            changes: Record<string, chrome.storage.StorageChange>,
            _areaName: string,
        ) => {
            for (const [changedKey, change] of Object.entries(changes)) {
                if (!changedKey.startsWith(STORAGE_PREFIX)) continue;
                const shortKey = changedKey.slice(STORAGE_PREFIX.length);
                callback(shortKey, change.newValue, change.oldValue);
            }
        };
        chrome.storage.onChanged.addListener(handler);
        return () => chrome.storage.onChanged.removeListener(handler);
    },
};
