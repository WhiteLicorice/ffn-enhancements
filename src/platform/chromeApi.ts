type ChromeAsyncStarter<T> = (callback: (value: T) => void) => Promise<T> | void;

function _lastError(): Error | null {
    const err = chrome.runtime.lastError;
    return err ? new Error(err.message) : null;
}

function _isPromiseLike<T>(value: unknown): value is Promise<T> {
    return !!value && typeof (value as Promise<T>).then === 'function';
}

function _chromeAsync<T>(start: ChromeAsyncStarter<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        let settled = false;

        const settle = (err: unknown, value?: T) => {
            if (settled) return;
            settled = true;
            if (err) {
                reject(err);
            } else {
                resolve(value as T);
            }
        };

        try {
            const maybePromise = start((value: T) => {
                settle(_lastError(), value);
            });

            if (_isPromiseLike<T>(maybePromise)) {
                maybePromise.then(
                    value => settle(null, value),
                    err => settle(err),
                );
            }
        } catch (err) {
            settle(err);
        }
    });
}

export function runtimeSendMessage<T = unknown>(message: unknown): Promise<T> {
    return _chromeAsync<T>((callback) => (
        chrome.runtime.sendMessage(message, callback) as unknown as Promise<T> | void
    ));
}

export function tabsQuery(queryInfo: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]> {
    return _chromeAsync<chrome.tabs.Tab[]>((callback) => (
        chrome.tabs.query(queryInfo, callback) as unknown as Promise<chrome.tabs.Tab[]> | void
    ));
}

export function tabsCreate(createProperties: chrome.tabs.CreateProperties): Promise<chrome.tabs.Tab> {
    return _chromeAsync<chrome.tabs.Tab>((callback) => (
        chrome.tabs.create(createProperties, callback) as unknown as Promise<chrome.tabs.Tab> | void
    ));
}

export function tabsSendMessage<T = unknown>(tabId: number, message: unknown): Promise<T> {
    return _chromeAsync<T>((callback) => (
        chrome.tabs.sendMessage(tabId, message, callback) as unknown as Promise<T> | void
    ));
}

export function scriptingExecuteScript(
    injection: chrome.scripting.ScriptInjection<unknown[], unknown>,
): Promise<chrome.scripting.InjectionResult[]> {
    return _chromeAsync<chrome.scripting.InjectionResult[]>((callback) => (
        chrome.scripting.executeScript(injection, callback) as unknown as Promise<chrome.scripting.InjectionResult[]> | void
    ));
}

export function storageGet(keys: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>> {
    return _chromeAsync<Record<string, unknown>>((callback) => (
        chrome.storage.local.get(keys, callback) as unknown as Promise<Record<string, unknown>> | void
    ));
}

export function storageSet(items: Record<string, unknown>): Promise<void> {
    return _chromeAsync<void>((callback) => (
        chrome.storage.local.set(items, callback) as unknown as Promise<void> | void
    ));
}

export function storageRemove(keys: string | string[]): Promise<void> {
    return _chromeAsync<void>((callback) => (
        chrome.storage.local.remove(keys, callback) as unknown as Promise<void> | void
    ));
}
