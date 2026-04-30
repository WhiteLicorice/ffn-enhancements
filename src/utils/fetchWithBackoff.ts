/**
 * Shared utility for HTTP fetch with retry on 429 rate-limit responses.
 * Supports configurable backoff strategy via getDelay callback.
 */

export interface FetchWithBackoffOptions<T> {
    url: string;
    maxRetries: number;
    getDelay: (attempt: number) => number;
    onSuccess: (response: Response) => Promise<T>;
    onError?: (response: Response) => T | null;
    onRetry?: (attempt: number, delayMs: number) => void;
}

/**
 * Generic retry loop: fetch `url`, retry on 429 up to `maxRetries` times.
 * Calls `onSuccess` for 2xx, `onError` for other statuses or exhausted retries.
 * Returns `T | null` — caller decides to throw on null if needed.
 */
export async function fetchWithBackoff<T>(options: FetchWithBackoffOptions<T>): Promise<T | null> {
    const { url, maxRetries, getDelay, onSuccess, onError, onRetry } = options;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        const response = await fetch(url);

        if (response.ok) {
            return onSuccess(response);
        }

        if (response.status === 429 && attempt <= maxRetries) {
            const delay = getDelay(attempt);
            onRetry?.(attempt, delay);
            await new Promise(r => setTimeout(r, delay));
            continue;
        }

        // Non-429 error or all retries exhausted
        if (onError) {
            return onError(response);
        }
        return null;
    }

    return null;
}
