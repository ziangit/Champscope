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
  exact: TeamProfileRow[];
  partial: PartialMatch[];
}

export async function matchTeams(formatId: string, speciesNames: string[], limit = 40): Promise<MatchResult> {
  const queryIds = [...new Set(speciesNames.map(baseFormeId).filter(Boolean))].sort();
  if (queryIds.length < 2) return { queryIds, exact: [], partial: [] };

  let exact: TeamProfileRow[] = [];
  if (queryIds.length === 6) {
    const { data, error } = await db()
      .from("team_profiles")
      .select("*")
      .eq("format_id", formatId)
      .eq("fingerprint", teamFingerprint(queryIds))
      .order("last_seen", { ascending: false });
    if (error) throw new Error(`exact match query failed: ${error.message}`);
    exact = data ?? [];
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
    .slice(0, limit);

  return { queryIds, exact, partial };
}
