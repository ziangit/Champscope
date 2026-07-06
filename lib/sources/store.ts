import { db } from "../db";
import { mergeImportedTeam, newImportedProfile, type TeamSourceRef } from "../scout/merge";
import { PROFILE_CONFLICT_KEY, profileFromRow, profileRow } from "../scout/rows";
import type { PokemonReveal } from "../scout/types";

/**
 * Store layer for imported teams (pastes / tournament sheets). Every team is
 * labeled with its source and deduped on the source key: re-running an ingest
 * is a no-op for anything already stored.
 */

export interface ImportedTeam {
  formatId: string;
  origin: "paste" | "tournament";
  userId: string;
  displayName: string;
  roster: PokemonReveal[];
  source: TeamSourceRef;
}

/**
 * All source keys already stored for a format+origin — fetched once per
 * ingest pass so pending work can be skipped without refetching anything.
 */
export async function knownSourceKeys(formatId: string, origin: "paste" | "tournament"): Promise<Set<string>> {
  const keys = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db()
      .from("team_profiles")
      .select("sources")
      .eq("format_id", formatId)
      .eq("origin", origin)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`sources lookup failed: ${error.message}`);
    for (const row of data ?? []) {
      for (const s of (row.sources ?? []) as TeamSourceRef[]) keys.add(s.key);
    }
    if (!data || data.length < PAGE) break;
  }
  return keys;
}

export type StoreResult = "new" | "merged" | "seen";

/** Upsert one imported team; idempotent per source key. */
export async function storeImportedTeam(team: ImportedTeam): Promise<StoreResult> {
  // first/last_seen must be real timestamps; fall back to ingestion time.
  team.source.sharedAt ??= Math.floor(Date.now() / 1000);
  const fresh = newImportedProfile(team.userId, team.displayName, team.formatId, team.roster);
  const { data, error } = await db()
    .from("team_profiles")
    .select("*")
    .eq("user_id", team.userId)
    .eq("format_id", team.formatId)
    .eq("fingerprint", fresh.fingerprint)
    .eq("origin", team.origin)
    .maybeSingle();
  if (error) throw new Error(`team_profiles lookup failed: ${error.message}`);

  const profile = data ? profileFromRow(data, fresh) : fresh;
  if (profile.sources.some((s) => s.key === team.source.key)) return "seen";
  mergeImportedTeam(profile, team.roster, team.source);

  const seen = new Date((team.source.sharedAt ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();
  const { error: playerErr } = await db()
    .from("players")
    .upsert({ user_id: team.userId, display_name: team.displayName, last_seen: seen }, { onConflict: "user_id" });
  if (playerErr) throw new Error(`players upsert failed: ${playerErr.message}`);

  const { error: upErr } = await db()
    .from("team_profiles")
    .upsert(profileRow(profile, team.origin), { onConflict: PROFILE_CONFLICT_KEY });
  if (upErr) throw new Error(`team_profiles upsert failed: ${upErr.message}`);
  return data ? "merged" : "new";
}

export interface BulkStoreStats {
  imported: number;
  merged: number;
  seen: number;
}

/**
 * Bulk variant for tournament ingests (a single decklists fetch yields ~1000
 * teams): 3 DB round-trips per batch instead of 3 per team, so a whole batch
 * fits in one worker tick. Same dedupe-per-source-key semantics.
 */
export async function storeImportedTeams(teams: ImportedTeam[]): Promise<BulkStoreStats> {
  const stats: BulkStoreStats = { imported: 0, merged: 0, seen: 0 };
  if (teams.length === 0) return stats;
  const now = Math.floor(Date.now() / 1000);
  for (const t of teams) t.source.sharedAt ??= now;

  // Coalesce duplicates within the batch (same player + same roster twice).
  const byIdentity = new Map<string, ImportedTeam[]>();
  for (const t of teams) {
    const fresh = newImportedProfile(t.userId, t.displayName, t.formatId, t.roster);
    const key = `${t.userId}|${t.formatId}|${fresh.fingerprint}|${t.origin}`;
    (byIdentity.get(key) ?? byIdentity.set(key, []).get(key)!).push(t);
  }

  const userIds = [...new Set(teams.map((t) => t.userId))];
  const formatId = teams[0].formatId;
  const origin = teams[0].origin;
  const { data: existing, error } = await db()
    .from("team_profiles")
    .select("*")
    .eq("format_id", formatId)
    .eq("origin", origin)
    .in("user_id", userIds);
  if (error) throw new Error(`team_profiles bulk lookup failed: ${error.message}`);
  const existingByIdentity = new Map<string, Record<string, unknown>>();
  for (const row of existing ?? []) {
    existingByIdentity.set(`${row.user_id}|${row.format_id}|${row.fingerprint}|${row.origin}`, row);
  }

  const profileRows: ReturnType<typeof profileRow>[] = [];
  const playerRows = new Map<string, { user_id: string; display_name: string; last_seen: string }>();
  for (const [identity, group] of byIdentity) {
    const first = group[0];
    const fresh = newImportedProfile(first.userId, first.displayName, first.formatId, first.roster);
    const row = existingByIdentity.get(identity);
    const profile = row ? profileFromRow(row, fresh) : fresh;
    let changed = false;
    for (const t of group) {
      if (profile.sources.some((s) => s.key === t.source.key)) {
        stats.seen += 1;
        continue;
      }
      mergeImportedTeam(profile, t.roster, t.source);
      changed = true;
      if (row) stats.merged += 1;
      else stats.imported += 1;
    }
    if (!changed) continue;
    profileRows.push(profileRow(profile, first.origin));
    playerRows.set(first.userId, {
      user_id: first.userId,
      display_name: first.displayName,
      last_seen: new Date(profile.lastSeen * 1000).toISOString(),
    });
  }
  if (profileRows.length === 0) return stats;

  const { error: playerErr } = await db().from("players").upsert([...playerRows.values()], { onConflict: "user_id" });
  if (playerErr) throw new Error(`players bulk upsert failed: ${playerErr.message}`);
  const { error: upErr } = await db().from("team_profiles").upsert(profileRows, { onConflict: PROFILE_CONFLICT_KEY });
  if (upErr) throw new Error(`team_profiles bulk upsert failed: ${upErr.message}`);
  return stats;
}
