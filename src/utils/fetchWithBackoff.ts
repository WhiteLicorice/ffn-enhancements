/**
 * Shared utility for HTTP fetch with retry on transient errors.
 * Supports configurable backoff strategy via getDelay callback.
 */

export interface FetchWithBackoffOptions<T> {
    url: string;
    maxRetries: number;
    getDelay: (attempt: number) => number;
    onSuccess: (response: Response) => Promise<T>;
    onError?: (response: Response) => T | null;
    onRetry?: (attempt: number, delayMs: number, status: number) => void;
}

function _isRetryableStatus(status: number): boolean {
    return status === 403 || status === 429 || status >= 500;
}

/**
 * Generic retry loop: fetch `url`, retry on transient errors up to
 * `maxRetries` times.  Transient = network errors, 403 (anti-bot),
 * 429 (rate limit), and 5xx (server faults).
 * Calls `onSuccess` for 2xx, `onError` for non-retryable statuses or
 * exhausted retries.  Returns `T | null` — caller decides to throw if needed.
 */
export async function fetchWithBackoff<T>(options: FetchWithBackoffOptions<T>): Promise<T | null> {
    const { url, maxRetries, getDelay, onSuccess, onError, onRetry } = options;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        let response: Response;
        try {
            response = await fetch(url);
        } catch (err) {
            if (attempt <= maxRetries) {
                const delay = getDelay(attempt);
                onRetry?.(attempt, delay, 0);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }
            throw err;
        }

        if (response.ok) {
            return onSuccess(response);
        }

        if (_isRetryableStatus(response.status) && attempt <= maxRetries) {
            const delay = getDelay(attempt);
            onRetry?.(attempt, delay, response.status);
            await new Promise(r => setTimeout(r, delay));
            continue;
        }

        // Non-retryable status or all retries exhausted
        if (onError) {
            return onError(response);
        }
        return null;
    }

    return null;
}
