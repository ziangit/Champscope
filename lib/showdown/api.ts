import { toID } from "./id";
import { queuedJSON } from "./queue";
import type { LadderJSON, ReplayJSON, ReplaySearchResult, UserJSON } from "./types";

const REPLAY_BASE = "https://replay.pokemonshowdown.com";
const MAIN_BASE = "https://pokemonshowdown.com";

/** search.json returns up to 51 rows; a 51st row means another page exists. */
export const SEARCH_PAGE_FULL = 51;

export interface ReplaySearchQuery {
  user?: string;
  format?: string;
  /** Page back: pass the `uploadtime` of the last result of the previous page. */
  before?: number;
}

/** One page of replay search. Server-side `user+format` filtering is supported (verified live). */
export function searchReplays(q: ReplaySearchQuery): Promise<ReplaySearchResult[]> {
  const params = new URLSearchParams();
  if (q.user) params.set("user", toID(q.user));
  if (q.format) params.set("format", q.format);
  if (q.before !== undefined) params.set("before", String(q.before));
  return queuedJSON<ReplaySearchResult[]>(`${REPLAY_BASE}/search.json?${params}`);
}

/**
 * All pages of a replay search, oldest bound optional. Stops when a page
 * comes back short of 51 rows or `stopBefore` (unix seconds) is passed.
 */
export async function searchReplaysAll(
  q: Omit<ReplaySearchQuery, "before">,
  opts: { stopBefore?: number; maxPages?: number } = {},
): Promise<ReplaySearchResult[]> {
  const { stopBefore, maxPages = 20 } = opts;
  const all: ReplaySearchResult[] = [];
  let before: number | undefined;
  for (let page = 0; page < maxPages; page++) {
    const rows = await searchReplays({ ...q, before });
    all.push(...rows.filter((r) => stopBefore === undefined || r.uploadtime >= stopBefore));
    const last = rows[rows.length - 1];
    const morePages = rows.length >= SEARCH_PAGE_FULL;
    if (!morePages || (stopBefore !== undefined && last.uploadtime < stopBefore)) break;
    before = last.uploadtime;
  }
  return all;
}

export function getReplay(replayId: string): Promise<ReplayJSON> {
  return queuedJSON<ReplayJSON>(`${REPLAY_BASE}/${replayId}.json`);
}

export function getLadder(formatId: string): Promise<LadderJSON> {
  return queuedJSON<LadderJSON>(`${MAIN_BASE}/ladder/${formatId}.json`);
}

export function getUser(name: string): Promise<UserJSON> {
  return queuedJSON<UserJSON>(`${MAIN_BASE}/users/${toID(name)}.json`);
}
