type StorageChange = { oldValue?: unknown; newValue?: unknown };
type StorageChangeCallback = (changes: Record<string, StorageChange>, areaName: string) => void;
type RuntimeSendResponse = (response?: unknown) => void;
type RuntimeMessageListener = (message: unknown, sender: unknown, sendResponse: RuntimeSendResponse) => unknown;

class MockStorageArea {
    private _store = new Map<string, unknown>();
    private _listeners: StorageChangeCallback[] = [];

    get(
        _keys?: string | string[] | Record<string, unknown> | null,
        callback?: (items: Record<string, unknown>) => void,
    ): Promise<Record<string, unknown>> | void {
        const items = Object.fromEntries(this._store.entries());
        if (callback) {
            callback(items);
            return;
        }
        return Promise.resolve(items);
    }

    set(items: Record<string, unknown>, callback?: () => void): Promise<void> | void {
        const changes: Record<string, StorageChange> = {};
        for (const [key, value] of Object.entries(items)) {
            const oldValue = this._store.get(key);
            this._store.set(key, value);
            changes[key] = { oldValue, newValue: value };
        }
        this._fireOnChanged(changes);
        callback?.();
        if (!callback) {
            return Promise.resolve();
        }
    }

    remove(keys: string | string[], callback?: () => void): Promise<void> | void {
        const keyList = Array.isArray(keys) ? keys : [keys];
        const changes: Record<string, StorageChange> = {};
        for (const key of keyList) {
            const oldValue = this._store.get(key);
            this._store.delete(key);
            changes[key] = { oldValue, newValue: undefined };
        }
        this._fireOnChanged(changes);
        callback?.();
        if (!callback) {
            return Promise.resolve();
        }
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
const runtimeState = {
    lastError: undefined as { message?: string } | undefined,
};

const permissionsState = {
    grantedOrigins: new Set<string>(),
    requestResult: true,
    requestCalls: [] as Array<{ origins?: string[] }>,
};

const tabsState = {
    createCalls: [] as Array<{ url?: string; active?: boolean }>,
};

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
    return typeof value === 'object'
        && value !== null
        && 'then' in value
        && typeof (value as PromiseLike<unknown>).then === 'function';
}

async function dispatchRuntimeMessage(message: unknown): Promise<unknown> {
    for (const listener of [...runtimeMessageListeners]) {
        let sendResponseCalled = false;
        let resolveResponse: (response: unknown) => void = () => undefined;
        const responsePromise = new Promise<unknown>((resolve) => {
            resolveResponse = resolve;
        });

        const sendResponse: RuntimeSendResponse = (response) => {
            sendResponseCalled = true;
            resolveResponse(response);
        };

        const result = listener(message, {}, sendResponse);
        if (result === true) {
            return responsePromise;
        }
        if (isPromiseLike(result)) {
            return result;
        }
        if (result !== undefined) {
            return result;
        }
        if (sendResponseCalled) {
            return responsePromise;
        }
    }

    return { ok: true, message };
}

function containsPermission(permissions: { origins?: string[] }): boolean {
    return (permissions.origins ?? []).every((origin) => permissionsState.grantedOrigins.has(origin));
}

function requestPermission(permissions: { origins?: string[] }): boolean {
    permissionsState.requestCalls.push(permissions);
    if (!permissionsState.requestResult) return false;
    for (const origin of permissions.origins ?? []) {
        permissionsState.grantedOrigins.add(origin);
    }
    return true;
}

function createTab(properties: { url?: string; active?: boolean }): { id: number; url?: string; active?: boolean } {
    tabsState.createCalls.push(properties);
    return { id: tabsState.createCalls.length, ...properties };
}

const browserMock = {
    storage: {
        local: {
            get: (keys?: string | string[] | Record<string, unknown> | null) => storageInstance.get(keys) as Promise<Record<string, unknown>>,
            set: (items: Record<string, unknown>) => storageInstance.set(items) as Promise<void>,
            remove: (keys: string | string[]) => storageInstance.remove(keys) as Promise<void>,
        },
        onChanged: storageInstance.onChanged,
    },
    permissions: {
        contains: async (permissions: { origins?: string[] }) => containsPermission(permissions),
        request: async (permissions: { origins?: string[] }) => requestPermission(permissions),
    },
    tabs: {
        create: async (properties: { url?: string; active?: boolean }) => createTab(properties),
    },
    runtime: {
        sendMessage(message: unknown) {
            return dispatchRuntimeMessage(message);
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

const chromeRuntime = {
    sendMessage(message: unknown, callback?: (response: unknown) => void): Promise<unknown> | void {
        const pending = dispatchRuntimeMessage(message);
        if (callback) {
            void pending.then((response) => {
                callback(response);
            });
            return;
        }
        return pending;
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
};

Object.defineProperty(chromeRuntime, 'lastError', {
    configurable: true,
    get: () => runtimeState.lastError,
    set: (value: { message?: string } | undefined) => {
        runtimeState.lastError = value;
    },
});

const chromeMock = {
    storage: {
        local: storageInstance,
        onChanged: storageInstance.onChanged,
    },
    permissions: {
        contains: (
            permissions: { origins?: string[] },
            callback?: (granted: boolean) => void,
        ) => {
            const granted = containsPermission(permissions);
            if (callback) {
                callback(granted);
                return;
            }
            return Promise.resolve(granted);
        },
        request: (
            permissions: { origins?: string[] },
            callback?: (granted: boolean) => void,
        ) => {
            const granted = requestPermission(permissions);
            if (callback) {
                callback(granted);
                return;
            }
            return Promise.resolve(granted);
        },
    },
    tabs: {
        create: (
            properties: { url?: string; active?: boolean },
            callback?: (tab: { id: number; url?: string; active?: boolean }) => void,
        ) => {
            const tab = createTab(properties);
            if (callback) {
                callback(tab);
                return;
            }
            return Promise.resolve(tab);
        },
    },
    runtime: chromeRuntime,
};

function installBrowserMock(): void {
    Object.defineProperty(globalThis, 'browser', {
        configurable: true,
        value: browserMock,
    });
}

Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: chromeMock,
});

installBrowserMock();

export const mockBrowserApi = {
    install(): void {
        installBrowserMock();
    },
    uninstall(): void {
        Reflect.deleteProperty(globalThis, 'browser');
    },
};

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
    state: runtimeState,
    _reset(): void {
        runtimeMessageListeners.length = 0;
        runtimeState.lastError = undefined;
        installBrowserMock();
    },
};
