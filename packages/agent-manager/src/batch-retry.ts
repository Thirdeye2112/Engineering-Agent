import pLimit from 'p-limit';
import pRetry, { AbortError } from 'p-retry';

export interface BatchOptions {
  concurrency?: number;
  retries?: number;
  minTimeout?: number;
  maxTimeout?: number;
  onProgress?: (completed: number, total: number) => void;
}

export function isRateLimitError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes('429') ||
    msg.includes('RATELIMIT_EXCEEDED') ||
    msg.toLowerCase().includes('quota') ||
    msg.toLowerCase().includes('rate limit') ||
    msg.toLowerCase().includes('credit balance') ||
    msg.toLowerCase().includes('insufficient_quota')
  );
}

export async function batchProcess<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  options: BatchOptions = {},
): Promise<R[]> {
  const { concurrency = 2, retries = 7, minTimeout = 2000, maxTimeout = 128000, onProgress } = options;
  const limit = pLimit(concurrency);
  let completed = 0;

  return Promise.all(
    items.map((item, index) =>
      limit(() =>
        pRetry(
          async () => {
            try {
              const result = await processor(item, index);
              onProgress?.(++completed, items.length);
              return result;
            } catch (err) {
              if (isRateLimitError(err)) throw err; // retryable
              throw new AbortError(err instanceof Error ? err : new Error(String(err)));
            }
          },
          { retries, minTimeout, maxTimeout, factor: 2 },
        ),
      ),
    ),
  );
}

/** Wraps a single async call with retry + exponential backoff. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Pick<BatchOptions, 'retries' | 'minTimeout' | 'maxTimeout'> = {},
): Promise<T> {
  const { retries = 5, minTimeout = 1000, maxTimeout = 32000 } = options;
  return pRetry(
    async () => {
      try {
        return await fn();
      } catch (err) {
        if (isRateLimitError(err)) throw err; // retryable
        throw new AbortError(err instanceof Error ? err : new Error(String(err)));
      }
    },
    { retries, minTimeout, maxTimeout, factor: 2 },
  );
}
