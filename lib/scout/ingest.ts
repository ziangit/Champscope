import { db } from "../db";
import { getReplay, searchReplaysAll } from "../showdown/api";
import { baseReplayId, toID } from "../showdown/id";
import type { ReplayJSON } from "../showdown/types";
import { mergeGame, newTeamProfile } from "./merge";
import { parseReplay } from "./parse";
import { PROFILE_CONFLICT_KEY, profileFromRow, profileRow } from "./rows";
import { PARSER_VERSION, type ParsedReplay } from "./types";

/**
 * The scout pipeline: search -> fetch only unseen replays -> parse -> merge
 * -> upsert. Called by the /scout action and the watch cron; all Showdown
 * traffic goes through the shared polite queue, all writes are idempotent.
 */

export interface ScoutStats {
  replaysFound: number;
  replaysFetched: number;
  newTeams: number;
  errors: { replayId?: string; message: string }[];
}

const emptyStats = (): ScoutStats => ({ replaysFound: 0, replaysFetched: 0, newTeams: 0, errors: [] });

async function unseenIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data, error } = await db().from("replays").select("id").in("id", ids);
  if (error) throw new Error(`replays lookup failed: ${error.message}`);
  const seen = new Set((data ?? []).map((r: { id: string }) => r.id));
  return ids.filter((id) => !seen.has(id));
}

async function upsertPlayers(parsed: ParsedReplay) {
  const rows = parsed.players.map((p) => ({
    user_id: p.userId,
    display_name: p.name,
    last_seen: new Date(parsed.uploadTime * 1000).toISOString(),
  }));
  const { error } = await db().from("players").upsert(rows, { onConflict: "user_id" });
  if (error) throw new Error(`players upsert failed: ${error.message}`);
}

async function insertReplay(raw: ReplayJSON, parsed: ParsedReplay) {
  const { error } = await db().from("replays").upsert(
    {
      id: raw.id,
      format_id: raw.formatid,
      upload_time: new Date(raw.uploadtime * 1000).toISOString(),
      rating: raw.rating,
      p1_user_id: parsed.players[0].userId,
      p2_user_id: parsed.players[1].userId,
      raw_json: raw,
      parsed,
      parser_version: PARSER_VERSION,
    },
    { onConflict: "id" },
  );
  if (error) throw new Error(`replay upsert failed: ${error.message}`);
}

/** Merge one parsed replay into both players' team profiles. */
async function mergeIntoProfiles(parsed: ParsedReplay, stats: ScoutStats) {
  for (const player of parsed.players) {
    if (player.roster.length === 0) continue; // no team data (e.g. truncated log)
    const fresh = newTeamProfile(player, parsed.formatId);
    const { data, error } = await db()
      .from("team_profiles")
      .select("*")
      .eq("user_id", player.userId)
      .eq("format_id", parsed.formatId)
      .eq("fingerprint", fresh.fingerprint)
      .eq("origin", "replay")
      .maybeSingle();
    if (error) throw new Error(`team_profiles lookup failed: ${error.message}`);

    const profile = data ? profileFromRow(data, fresh) : fresh;
    if (!data) stats.newTeams += 1;
    mergeGame(profile, player, {
      replayId: parsed.replayId,
      uploadTime: parsed.uploadTime,
      rating: parsed.rating,
      tie: parsed.tie,
    });

    const { error: upErr } = await db()
      .from("team_profiles")
      .upsert(profileRow(profile, "replay"), { onConflict: PROFILE_CONFLICT_KEY });
    if (upErr) throw new Error(`team_profiles upsert failed: ${upErr.message}`);
  }
}

/** Ingest a single replay by id (skips if already cached — replays are immutable). */
export async function ingestReplay(replayId: string, stats: ScoutStats): Promise<void> {
  // Rows are keyed by the base id (what the replay JSON reports), but the
  // fetch needs the full pasted id — for private replays it carries the password.
  const fresh = await unseenIds([baseReplayId(replayId)]);
  if (fresh.length === 0) return;
  const raw = await getReplay(replayId);
  const parsed = parseReplay(raw.log, raw);
  stats.replaysFetched += 1;
  await upsertPlayers(parsed);
  await insertReplay(raw, parsed);
  await mergeIntoProfiles(parsed, stats);
}

export interface ScoutUserOptions {
  formatId: string;
  /** unix seconds; skip replays older than this */
  since?: number;
  /** cap fetched replays per user per run (politeness) */
  maxReplays?: number;
}

/**
 * Scout one user: search their public replays in a format, ingest the unseen
 * ones. Zero results is a normal, recorded outcome — never an error.
 */
export async function scoutUser(name: string, opts: ScoutUserOptions): Promise<ScoutStats> {
  const stats = emptyStats();
  const userId = toID(name);
  try {
    const results = await searchReplaysAll(
      { user: userId, format: opts.formatId },
      { stopBefore: opts.since },
    );
    stats.replaysFound = results.length;
    const fresh = await unseenIds(results.map((r) => r.id));
    for (const id of fresh.slice(0, opts.maxReplays ?? 50)) {
      try {
        await ingestReplay(id, stats);
      } catch (err) {
        stats.errors.push({ replayId: id, message: err instanceof Error ? err.message : String(err) });
      }
    }
  } catch (err) {
    stats.errors.push({ message: err instanceof Error ? err.message : String(err) });
  }
  return stats;
}
