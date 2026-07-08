import { db } from "./db";
import type { TeamProfileRow } from "./queries";
import { baseFormeId, teamFingerprint } from "./scout/formes";
import { parseExportText } from "./scout/import";

/**
 * Free-form preview input: either a comma/newline species list or full
 * Showdown export / pokepaste text (nobody types 6 names — they paste).
 */
export function parsePreviewSpecies(text: string): string[] {
  const looksLikeExport = /^\s*-\s.+|^\s*Ability:|\S\s@\s\S/m.test(text);
  if (looksLikeExport) return parseExportText(text).map((m) => m.species);
  return text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Team-preview matching: look up an opponent's previewed species in the team
 * database. Exact 6/6 is a fingerprint index hit; partial >= 4/6 is one
 * GIN-prefiltered overlap query (the match_teams SQL function).
 */

export interface PartialMatch {
  overlap: number;
  profile: TeamProfileRow;
}

export interface MatchResult {
  /** Normalized base-forme ids actually queried. */
  queryIds: string[];
  /** Display names for the query ids (for sprites/labels), same order. */
  queryNames: string[];
  exact: TeamProfileRow[];
  partial: PartialMatch[];
}

/** Official tournament teams rank above ladder/paste teams at equal footing. */
const originRank = (origin: string | undefined) => (origin === "tournament" ? 0 : 1);

export async function matchTeams(formatId: string, speciesNames: string[], limit = 40): Promise<MatchResult> {
  const byId = new Map<string, string>();
  for (const name of speciesNames) {
    const id = baseFormeId(name);
    if (id && !byId.has(id)) byId.set(id, name.trim());
  }
  const queryIds = [...byId.keys()].sort();
  const queryNames = queryIds.map((id) => byId.get(id)!);
  if (queryIds.length < 2) return { queryIds, queryNames, exact: [], partial: [] };

  let exact: TeamProfileRow[] = [];
  if (queryIds.length === 6) {
    const { data, error } = await db()
      .from("team_profiles")
      .select("*")
      .eq("format_id", formatId)
      .eq("fingerprint", teamFingerprint(queryIds))
      .order("last_seen", { ascending: false });
    if (error) throw new Error(`exact match query failed: ${error.message}`);
    exact = (data ?? []).sort(
      (a: TeamProfileRow, b: TeamProfileRow) => originRank(a.origin) - originRank(b.origin) || new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime(),
    );
  }

  // With fewer than 6 previewed species, still require >= 4 shared (or all of
  // them when fewer than 4 were given — matching 2/2 is noise, hence the floor).
  const minOverlap = Math.min(4, queryIds.length);
  const { data, error } = await db().rpc("match_teams", {
    p_format_id: formatId,
    p_species: queryIds,
    p_min_overlap: minOverlap,
    p_limit: limit + exact.length,
  });
  if (error) throw new Error(`match_teams rpc failed: ${error.message}`);
  const exactIds = new Set(exact.map((r) => r.id));
  const partial = ((data ?? []) as { overlap: number; profile: TeamProfileRow }[])
    .filter((r) => !exactIds.has(r.profile.id))
    .sort(
      (a, b) =>
        b.overlap - a.overlap ||
        originRank(a.profile.origin) - originRank(b.profile.origin) ||
        new Date(b.profile.last_seen).getTime() - new Date(a.profile.last_seen).getTime(),
    )
    .slice(0, limit);

  return { queryIds, queryNames, exact, partial };
}
