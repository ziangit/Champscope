/**
 * Global serial queue for ALL Showdown requests (hard politeness requirement):
 * one request at a time, >= 600 ms apart, honest User-Agent, exponential
 * backoff on 429/5xx with 3 attempts max.
 */

const MIN_GAP_MS = 600;
const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 1500;

const USER_AGENT = `Champscope/0.1 (VGC replay scouter, personal non-commercial project; contact: ${
  process.env.SHOWDOWN_CONTACT ?? "megazchomp@gmail.com"
})`;

export class ShowdownFetchError extends Error {
  constructor(
    public readonly url: string,
    public readonly status: number | null,
    public readonly attempts: number,
    cause?: unknown,
  ) {
    super(`Showdown fetch failed after ${attempts} attempt(s): ${url} (status ${status ?? "network error"})`);
    this.name = "ShowdownFetchError";
    this.cause = cause;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let chain: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

async function politeFetch(url: string): Promise<unknown> {
  let lastStatus: number | null = null;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const wait = lastRequestAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      lastStatus = res.status;
      if (res.ok) return await res.json();
      // 4xx other than 429 will not improve with retries.
      if (res.status !== 429 && res.status < 500) break;
    } catch (err) {
      lastError = err;
      lastStatus = null;
    }
    if (attempt < MAX_ATTEMPTS) await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
  }
  throw new ShowdownFetchError(url, lastStatus, MAX_ATTEMPTS, lastError);
}

/**
 * Fetch JSON from a Showdown endpoint through the global serial queue.
 * Rejections don't break the chain; callers own error handling
 * (record in scout_runs, never crash a run on one failure).
 */
export function queuedJSON<T>(url: string): Promise<T> {
  const next = chain.catch(() => {}).then(() => politeFetch(url));
  chain = next;
  return next as Promise<T>;
}
