import type { PokedataDecklistMon } from "../scout/import";
import { queuedJSON } from "../showdown/queue";
import { POKEDATA_API, pokedataFormatFor } from "./config";

/**
 * pokedata.ovh: machine-readable mirror of RK9's officially published open
 * team sheets, with placings and records. Response shapes verified live
 * 2026-07-06 (tournaments list + NAIC 2026 decklists). Quirk: unknown API
 * paths return `{}` with HTTP 200, so shapes are checked before use.
 */

interface PokedataTournament {
  id: string;
  name: string;
  date: { start: string; end: string };
  decklists: number;
  tournamentStatus: string;
  rk9link: string;
}

export interface PendingTournament {
  rk9link: string;
  name: string;
  endDate: string;
  formatId: string;
}

/** Finished VG tournaments with published sheets that fall in a configured regulation window. */
export async function listPokedataTournaments(): Promise<PendingTournament[]> {
  const res = await queuedJSON<{ vg?: { data?: PokedataTournament[] } }>(`${POKEDATA_API}/vgc/tournaments`);
  const all = res.vg?.data;
  if (!Array.isArray(all)) throw new Error("pokedata tournaments: unexpected shape (vg.data missing)");
  const pending: PendingTournament[] = [];
  for (const t of all) {
    if (t.tournamentStatus !== "finished" || !t.decklists || !t.rk9link) continue;
    const formatId = pokedataFormatFor(t.date.start);
    if (!formatId) continue; // outside every configured regulation window
    pending.push({ rk9link: t.rk9link, name: t.name, endDate: t.date.end, formatId });
  }
  return pending;
}

interface PokedataPlayer {
  name: string;
  placing: number;
  record?: { wins: number; losses: number; ties: number };
  decklist?: PokedataDecklistMon[];
}

interface PokedataDecklists {
  tournament_data?: { division: string; data: PokedataPlayer[] }[];
}

/** Masters-division players of one tournament that have a published sheet. */
export async function fetchMastersSheets(rk9link: string): Promise<PokedataPlayer[]> {
  const res = await queuedJSON<PokedataDecklists[]>(`${POKEDATA_API}/id/${rk9link}/decklists`);
  const masters = Array.isArray(res) ? res[0]?.tournament_data?.find((d) => d.division === "masters") : undefined;
  if (!masters) throw new Error(`pokedata decklists ${rk9link}: masters division missing`);
  return masters.data.filter((p) => Array.isArray(p.decklist) && p.decklist.length > 0);
}

/** "Wolfe Glick [US]" -> name + country tag (tags vary per event; strip for cross-source identity). */
export function splitCountryTag(raw: string): { name: string; country?: string } {
  const m = raw.trim().match(/^(.*\S)\s*\[([A-Z]{2})\]$/);
  return m ? { name: m[1], country: m[2] } : { name: raw.trim() };
}
