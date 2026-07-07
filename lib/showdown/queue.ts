/**
 * Polite serial fetch queues, one lane per host: one request at a time,
 * >= 600 ms apart, honest User-Agent, exponential backoff on 429/5xx with
 * 3 attempts max.
 *
 * ALL Showdown hosts share a single lane (hard politeness requirement —
 * a global serial queue across replay./play./www.pokemonshowdown.com).
 * Other data sources (pokedata.ovh, docs.google.com, pokepast.es) each get
 * their own lane with the same pacing rules.
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
    super(`Polite fetch failed after ${attempts} attempt(s): ${url} (status ${status ?? "network error"})`);
    this.name = "ShowdownFetchError";
    this.cause = cause;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Lane {
  chain: Promise<unknown>;
  lastRequestAt: number;
}

const lanes = new Map<string, Lane>();

function laneFor(url: string): Lane {
  const host = new URL(url).host;
  const key = host.endsWith("pokemonshowdown.com") ? "showdown" : host;
  let lane = lanes.get(key);
  if (!lane) {
    lane = { chain: Promise.resolve(), lastRequestAt: 0 };
    lanes.set(key, lane);
  }
  return lane;
}

export interface PoliteFetchOptions {
  headers?: Record<string, string>;
}

async function politeFetch(lane: Lane, url: string, opts?: PoliteFetchOptions): Promise<Response> {
  let lastStatus: number | null = null;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const wait = lane.lastRequestAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lane.lastRequestAt = Date.now();
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, ...opts?.headers }, redirect: "follow" });
      lastStatus = res.status;
      if (res.ok) return res;
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

function enqueue<T>(url: string, run: (lane: Lane) => Promise<T>): Promise<T> {
  const lane = laneFor(url);
  const next = lane.chain.catch(() => {}).then(() => run(lane));
  lane.chain = next;
  return next;
}

/**
 * Fetch JSON through the polite queue for the URL's host lane.
 * Rejections don't break the chain; callers own error handling
 * (record in scout_runs, never crash a run on one failure).
 */
export function queuedJSON<T>(url: string, opts?: PoliteFetchOptions): Promise<T> {
  return enqueue(url, async (lane) => (await politeFetch(lane, url, opts)).json() as Promise<T>);
}

/** Fetch a text body (CSV, HTML) through the polite queue. */
export function queuedText(url: string, opts?: PoliteFetchOptions): Promise<string> {
  return enqueue(url, async (lane) => (await politeFetch(lane, url, opts)).text());
}

/** Fetch binary content (sprite images for CV templates) through the polite queue. */
export function queuedBytes(url: string, opts?: PoliteFetchOptions): Promise<Buffer> {
  return enqueue(url, async (lane) => Buffer.from(await (await politeFetch(lane, url, opts)).arrayBuffer()));
}
