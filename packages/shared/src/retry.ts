import { MAX_RETRIES, BASE_BACKOFF_MS, MAX_BACKOFF_MS } from './constants.js';
import type { Logger } from './logger.js';

/** Result type mirroring @civic-source/types to avoid circular dependency */
type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Statuses worth retrying: transient server errors and rate-limiting. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Exponential backoff for a 1-based attempt, capped at MAX_BACKOFF_MS. */
function backoffDelayMs(baseDelayMs: number, attempt: number): number {
  return Math.min(baseDelayMs * Math.pow(2, attempt - 1), MAX_BACKOFF_MS);
}

/**
 * Parse a `Retry-After` header (delta-seconds or HTTP-date) into milliseconds,
 * or null if absent/unparseable. The caller still caps the result.
 */
function retryAfterMs(response: Response): number | null {
  const header = response.headers.get('retry-after');
  if (header === null) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

export interface FetchWithRetryOptions extends RequestInit {
  maxRetries?: number;
  baseDelayMs?: number;
}

/**
 * Fetch with exponential backoff retry.
 *
 * Retries up to `maxRetries` attempts on network errors and on retryable HTTP
 * statuses (429 and 5xx), honoring a `Retry-After` header when present. Backoff
 * is capped at MAX_BACKOFF_MS. Aborts (`AbortError`) are NOT retried — a caller
 * that cancels (timeout/abort signal) gets the abort back immediately.
 */
export async function fetchWithRetry(
  url: string,
  options?: FetchWithRetryOptions & { logger?: Logger }
): Promise<Result<Response, Error>> {
  const maxRetries = options?.maxRetries ?? MAX_RETRIES;
  const baseDelayMs = options?.baseDelayMs ?? BASE_BACKOFF_MS;
  const logger = options?.logger;

  // Strip custom options before passing to fetch
  const fetchOptions: RequestInit = { ...options };
  delete (fetchOptions as Record<string, unknown>)['maxRetries'];
  delete (fetchOptions as Record<string, unknown>)['baseDelayMs'];
  delete (fetchOptions as Record<string, unknown>)['logger'];

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, fetchOptions);
      if (response.ok) return ok(response);

      if (isRetryableStatus(response.status) && attempt < maxRetries) {
        const delayMs = Math.min(
          Math.max(backoffDelayMs(baseDelayMs, attempt), retryAfterMs(response) ?? 0),
          MAX_BACKOFF_MS
        );
        logger?.warn('Retryable HTTP status, retrying', {
          url,
          status: response.status,
          attempt,
          delayMs,
        });
        await sleep(delayMs);
        continue;
      }
      return err(new Error(`HTTP ${response.status}: ${response.statusText}`));
    } catch (error: unknown) {
      // Do not retry deliberate cancellations.
      if (error instanceof Error && error.name === 'AbortError') {
        return err(error);
      }
      if (attempt < maxRetries) {
        const delayMs = backoffDelayMs(baseDelayMs, attempt);
        logger?.warn('Network error, retrying', { url, attempt, delayMs });
        await sleep(delayMs);
        continue;
      }
      const message = error instanceof Error ? error.message : String(error);
      return err(new Error(`Network error after ${maxRetries} attempts: ${message}`, { cause: error }));
    }
  }
  return err(new Error(`Failed after ${maxRetries} attempts`));
}
