const STORAGE_PREFIX = 'ffne_';
const _pendingLocalWrites = new Map<string, number>();
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
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'number' || typeof parsed === 'boolean') return parsed;
    } catch {
        // Not JSON-encoded.
    }
    return raw;
}

function serializeForLocal(value: string | number | boolean): string {
    return typeof value === 'string' ? value : JSON.stringify(value);
}

export const platformStorage: PlatformStorage = {
    get(key: string): string | number | boolean | null {
        try {
            return parseStored(localStorage.getItem(fullKey(key)));
        } catch {
            return null;
        }
    },

    async set(key: string, value: string | number | boolean): Promise<void> {
        const fk = fullKey(key);
        _cleanStalePendingWrites();

        try {
            localStorage.setItem(fk, serializeForLocal(value));
        } catch {
            // localStorage unavailable.
        }

        _pendingLocalWrites.set(fk, Date.now());
        await chrome.storage.local.set({ [fk]: value });
    },

    async remove(key: string): Promise<void> {
        const fk = fullKey(key);
        try {
            localStorage.removeItem(fk);
        } catch {
            // localStorage unavailable.
        }
        _pendingLocalWrites.set(fk, Date.now());
        await chrome.storage.local.remove(fk);
    },

    async hydrateFromPersistentStorage(): Promise<Record<string, string | number | boolean>> {
        const stored = await chrome.storage.local.get(null);
        const hydrated: Record<string, string | number | boolean> = {};

        for (const [key, value] of Object.entries(stored)) {
            if (!key.startsWith(STORAGE_PREFIX)) continue;
            if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue;

            try {
                localStorage.setItem(key, serializeForLocal(value));
            } catch {
                // localStorage unavailable.
            }

            hydrated[key.slice(STORAGE_PREFIX.length)] = value;
        }

        return hydrated;
    },

    _resetForTesting(): void {
        _pendingLocalWrites.clear();
    },

    onChanged(callback: (key: string, newValue: unknown, oldValue: unknown) => void): () => void {
        const handler = (changes: Record<string, chrome.storage.StorageChange>) => {
            _cleanStalePendingWrites();
            for (const [changedKey, change] of Object.entries(changes)) {
                if (!changedKey.startsWith(STORAGE_PREFIX)) continue;

                const localTs = _pendingLocalWrites.get(changedKey);
                if (localTs !== undefined && Date.now() - localTs < LOCAL_WRITE_GUARD_MS) {
                    _pendingLocalWrites.delete(changedKey);
                    continue;
                }

                try {
                    if (change.newValue !== undefined) {
                        localStorage.setItem(changedKey, serializeForLocal(change.newValue as string | number | boolean));
                    } else {
                        localStorage.removeItem(changedKey);
                    }
                } catch {
                    // localStorage unavailable.
                }

                callback(
                    changedKey.slice(STORAGE_PREFIX.length),
                    change.newValue,
                    change.oldValue,
                );
            }
        };

        chrome.storage.onChanged.addListener(handler);
        return () => chrome.storage.onChanged.removeListener(handler);
    },
};
