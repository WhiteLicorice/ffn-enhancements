// Mock for chrome.* extension APIs used by platform layer in tests.

type StorageChangeCallback = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void;

class MockStorageArea {
    private _store = new Map<string, unknown>();
    private _listeners: StorageChangeCallback[] = [];

    get(
        _keys?: string | string[] | Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        const result: Record<string, unknown> = {};
        for (const [key, value] of this._store) {
            result[key] = value;
        }
        return Promise.resolve(result);
    }

    set(items: Record<string, unknown>): Promise<void> {
        const changes: Record<string, chrome.storage.StorageChange> = {};
        for (const [key, value] of Object.entries(items)) {
            const oldValue = this._store.get(key);
            this._store.set(key, value);
            changes[key] = { oldValue, newValue: value };
        }
        this._fireOnChanged(changes);
        return Promise.resolve();
    }

    remove(keys: string | string[]): Promise<void> {
        const keyList = Array.isArray(keys) ? keys : [keys];
        const changes: Record<string, chrome.storage.StorageChange> = {};
        for (const key of keyList) {
            const oldValue = this._store.get(key);
            this._store.delete(key);
            changes[key] = { oldValue, newValue: undefined as unknown };
        }
        this._fireOnChanged(changes);
        return Promise.resolve();
    }

    // Shared onChanged event object (created once, reused).
    // Real chrome.storage.onChanged is a singleton event shared across all areas.
    readonly onChanged = {
        addListener: (cb: StorageChangeCallback) => {
            this._listeners.push(cb);
        },
        removeListener: (cb: StorageChangeCallback) => {
            const idx = this._listeners.indexOf(cb);
            if (idx !== -1) this._listeners.splice(idx, 1);
        },
        hasListener: (cb: StorageChangeCallback) => {
            return this._listeners.includes(cb);
        },
    };

    private _fireOnChanged(changes: Record<string, chrome.storage.StorageChange>): void {
        if (this._listeners.length === 0) return;
        for (const listener of [...this._listeners]) {
            try {
                listener(changes, 'local');
            } catch {
                // Swallow — real chrome.storage.onChanged does not propagate listener errors.
            }
        }
    }

    _reset(): void {
        this._store.clear();
        this._listeners.length = 0;
    }
}

const storageInstance = new MockStorageArea();

// In Chrome extensions:
//   chrome.storage.local   → StorageArea (get/set/remove)
//   chrome.storage.onChanged → Event (shared across all areas)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).chrome = {
    storage: {
        local: storageInstance,
        onChanged: storageInstance.onChanged,
    },
};

export const mockChromeStorage = storageInstance;
