type StorageChange = { oldValue?: unknown; newValue?: unknown };
type StorageChangeCallback = (changes: Record<string, StorageChange>, areaName: string) => void;
type RuntimeMessageListener = (message: unknown, sender?: unknown) => unknown;

class MockStorageArea {
    private _store = new Map<string, unknown>();
    private _listeners: StorageChangeCallback[] = [];

    async get(_keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>> {
        return Object.fromEntries(this._store.entries());
    }

    async set(items: Record<string, unknown>): Promise<void> {
        const changes: Record<string, StorageChange> = {};
        for (const [key, value] of Object.entries(items)) {
            const oldValue = this._store.get(key);
            this._store.set(key, value);
            changes[key] = { oldValue, newValue: value };
        }
        this._fireOnChanged(changes);
    }

    async remove(keys: string | string[]): Promise<void> {
        const keyList = Array.isArray(keys) ? keys : [keys];
        const changes: Record<string, StorageChange> = {};
        for (const key of keyList) {
            const oldValue = this._store.get(key);
            this._store.delete(key);
            changes[key] = { oldValue, newValue: undefined };
        }
        this._fireOnChanged(changes);
    }

    readonly onChanged = {
        addListener: (cb: StorageChangeCallback) => {
            this._listeners.push(cb);
        },
        removeListener: (cb: StorageChangeCallback) => {
            const index = this._listeners.indexOf(cb);
            if (index !== -1) this._listeners.splice(index, 1);
        },
    };

    _reset(): void {
        this._store.clear();
        this._listeners.length = 0;
    }

    private _fireOnChanged(changes: Record<string, StorageChange>): void {
        for (const listener of [...this._listeners]) {
            listener(changes, 'local');
        }
    }
}

const storageInstance = new MockStorageArea();
const runtimeMessageListeners: RuntimeMessageListener[] = [];

const permissionsState = {
    grantedOrigins: new Set<string>(),
    requestResult: true,
    requestCalls: [] as Array<{ origins?: string[] }>,
};

const tabsState = {
    createCalls: [] as Array<{ url?: string; active?: boolean }>,
};

const browserMock = {
    storage: {
        local: storageInstance,
        onChanged: storageInstance.onChanged,
    },
    permissions: {
        contains: async (permissions: { origins?: string[] }) => {
            return (permissions.origins ?? []).every((origin) => permissionsState.grantedOrigins.has(origin));
        },
        request: async (permissions: { origins?: string[] }) => {
            permissionsState.requestCalls.push(permissions);
            if (!permissionsState.requestResult) return false;
            for (const origin of permissions.origins ?? []) {
                permissionsState.grantedOrigins.add(origin);
            }
            return true;
        },
    },
    tabs: {
        create: async (properties: { url?: string; active?: boolean }) => {
            tabsState.createCalls.push(properties);
            return { id: tabsState.createCalls.length, ...properties };
        },
    },
    runtime: {
        async sendMessage(message: unknown) {
            for (const listener of [...runtimeMessageListeners]) {
                const response = await listener(message, {});
                if (response !== undefined) return response;
            }
            return { ok: true, message };
        },
        onMessage: {
            addListener: (cb: RuntimeMessageListener) => {
                runtimeMessageListeners.push(cb);
            },
            removeListener: (cb: RuntimeMessageListener) => {
                const index = runtimeMessageListeners.indexOf(cb);
                if (index !== -1) runtimeMessageListeners.splice(index, 1);
            },
        },
    },
};

Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: browserMock,
});

export const mockChromeStorage = storageInstance;
export const mockChromePermissions = {
    state: permissionsState,
    _reset(): void {
        permissionsState.grantedOrigins.clear();
        permissionsState.requestResult = true;
        permissionsState.requestCalls.length = 0;
    },
};
export const mockChromeTabs = {
    state: tabsState,
    _reset(): void {
        tabsState.createCalls.length = 0;
    },
};
export const mockChromeRuntime = {
    _reset(): void {
        runtimeMessageListeners.length = 0;
    },
};
