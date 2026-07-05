/**
 * Types modeled from live responses inspected 2026-07-05
 * (see docs/ARCHITECTURE.md "Open questions" for the raw shapes).
 * Do not add fields that haven't been observed in a real response.
 */

/** One row of `replay.pokemonshowdown.com/search.json`. */
export interface ReplaySearchResult {
  uploadtime: number; // unix seconds
  id: string; // e.g. "gen9championsvgc2026regmb-2644520954"
  format: string; // display name, e.g. "[Gen 9 Champions] VGC 2026 Reg M-B"
  players: [string, string];
  rating: number | null;
  private: number;
  password: string | null;
}

/** `replay.pokemonshowdown.com/<replayid>.json` */
export interface ReplayJSON {
  id: string;
  format: string; // display name
  formatid: string;
  players: [string, string];
  log: string; // full sim-protocol log
  uploadtime: number; // unix seconds
  views: number;
  rating: number | null;
  private: number;
  password: string | null;
}

/** One entry of `pokemonshowdown.com/ladder/<formatid>.json` `toplist`. */
export interface LadderEntry {
  userid: string;
  username: string;
  w: number;
  l: number;
  t: number;
  gxe: number;
  r: number; // Glicko-1 rating
  rd: number; // Glicko-1 deviation
  sigma: number;
  rptime: number;
  rpr: number;
  rprd: number;
  rpsigma: number;
  elo: number;
  first_played: number; // unix seconds
  last_played: number; // unix seconds
}

export interface LadderJSON {
  formatid: string;
  format: string;
  toplist: LadderEntry[];
}

/** `pokemonshowdown.com/users/<userid>.json` */
export interface UserJSON {
  username: string;
  userid: string;
  registertime: number;
  group: number;
  ratings: Record<string, Record<string, unknown>>;
}
