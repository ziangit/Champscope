/**
 * Team-source configuration. Format IDs reference rows seeded in `formats`
 * (verified live, never guessed) — a new regulation means adding entries
 * here, nothing in the ingest code assumes a specific regulation.
 */

export interface VgcpastesSheetConfig {
  /** Google Sheet id + per-regulation tab gid (no-auth CSV export). */
  sheetId: string;
  gid: string;
  formatId: string;
}

/** VGCPastes repository — verified 2026-07-05: 386 M-B teams, all with pokepast.es links. */
export const VGCPASTES_SHEETS: VgcpastesSheetConfig[] = [
  {
    sheetId: "1axlwmzPA49rYkqXh7zHvAtSP-TKbM0ijGYBPRflLSWw",
    gid: "1458357160",
    formatId: "gen9championsvgc2026regmb",
  },
];

export interface PokedataWindow {
  formatId: string;
  /** Tournaments whose start date falls in [since, until) belong to this format. */
  since: string; // ISO date
  until?: string;
}

/**
 * Which official-tournament dates map to which regulation. Grounded on the
 * VGCPastes M-B tab whose earliest entry is 17 Jun 2026 — every finished
 * pokedata event before that (incl. NAIC 2026, Jun 12–14) is Reg M-A.
 * The M-B window is empty today; Worlds and later M-B events will be picked
 * up automatically. Backfilling M-A = adding one entry here (still undecided).
 */
export const POKEDATA_WINDOWS: PokedataWindow[] = [
  { formatId: "gen9championsvgc2026regmb", since: "2026-06-15" },
];

export const POKEDATA_API = "https://www.pokedata.ovh/apiv2";

export function vgcpastesCsvUrl(cfg: VgcpastesSheetConfig): string {
  return `https://docs.google.com/spreadsheets/d/${cfg.sheetId}/export?format=csv&gid=${cfg.gid}`;
}

export function pokedataFormatFor(startDate: string): string | null {
  for (const w of POKEDATA_WINDOWS) {
    if (startDate >= w.since && (!w.until || startDate < w.until)) return w.formatId;
  }
  return null;
}
