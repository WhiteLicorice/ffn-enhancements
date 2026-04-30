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
        let response: Response;
        try {
            response = await fetch(url);
        } catch (err) {
            // Network-level error (DNS failure, connection reset, etc.) — retry if budget left
            if (attempt <= maxRetries) {
                const delay = getDelay(attempt);
                onRetry?.(attempt, delay);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }
            // Retry budget exhausted for network errors — propagate
            throw err;
        }

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
