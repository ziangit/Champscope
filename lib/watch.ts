import { db } from "./db";
import { getLadder, searchReplaysAll } from "./showdown/api";
import { ingestReplay, type ScoutStats } from "./scout/ingest";

/**
 * Ladder watcher, built for Vercel Hobby's 10 s timeout: each invocation
 * processes as much of a top-50 pass as fits in its time budget, persists a
 * cursor in scout_runs.cursor, and returns. GitHub Actions (or Vercel Cron)
 * keeps hitting the route until the pass finishes; a full pass over ~2 h of
 * chunks is fine — this is a daily digest, not realtime.
 */

const TOP_N = 50;
/** Don't start a fresh pass if the last one started less than this ago.
 * The scheduler fires every 12 h; 11 h lets each firing start a new pass. */
const PASS_COOLDOWN_MS = 11 * 60 * 60 * 1000;

interface WatchCursor {
  players: string[]; // top-50 userIds for this pass
  index: number; // next player to process
  /** Unseen replay ids of players[index], not yet ingested. */
  pendingReplays: string[] | null;
  replaysFound: number;
  newTeams: number;
  errors: { userId?: string; replayId?: string; message: string }[];
}

export interface WatchTickResult {
  status: "resumed" | "started" | "finished" | "cooldown" | "noop";
  formatId?: string;
  runId?: string;
  playersDone?: number;
  playersTotal?: number;
}

async function activeFormats(): Promise<string[]> {
  const { data, error } = await db().from("formats").select("id").eq("active", true);
  if (error) throw new Error(`formats query failed: ${error.message}`);
  return (data ?? []).map((f: { id: string }) => f.id);
}

async function takeSnapshot(formatId: string): Promise<string[]> {
  const ladder = await getLadder(formatId);
  const top = ladder.toplist.slice(0, TOP_N);
  const standings = top.map((e, i) => ({
    rank: i + 1,
    user_id: e.userid,
    name: e.username,
    elo: Math.round(e.elo),
    gxe: e.gxe,
    glicko: { r: Math.round(e.r), rd: Math.round(e.rd) },
  }));
  const { error } = await db().from("ladder_snapshots").insert({ format_id: formatId, standings });
  if (error) throw new Error(`ladder snapshot insert failed: ${error.message}`);
  return top.map((e) => e.userid);
}

/** Process one chunk of the watch pipeline; call repeatedly until "finished". */
export async function watchTick(deadline: number, trigger: string): Promise<WatchTickResult> {
  // Resume an unfinished pass first.
  const { data: open, error: openErr } = await db()
    .from("scout_runs")
    .select("*")
    .like("trigger", "watch%")
    .is("finished_at", null)
    .order("started_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (openErr) throw new Error(`scout_runs query failed: ${openErr.message}`);

  if (open) return await processChunk(open.id, open.format_id, open.cursor as WatchCursor, deadline);

  // Otherwise start a pass for the first active format past its cooldown.
  for (const formatId of await activeFormats()) {
    const { data: last, error: lastErr } = await db()
      .from("scout_runs")
      .select("started_at")
      .eq("format_id", formatId)
      .like("trigger", "watch%")
      .not("finished_at", "is", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastErr) throw new Error(`scout_runs query failed: ${lastErr.message}`);
    if (last && Date.now() - new Date(last.started_at).getTime() < PASS_COOLDOWN_MS) continue;

    const players = await takeSnapshot(formatId);
    const cursor: WatchCursor = { players, index: 0, pendingReplays: null, replaysFound: 0, newTeams: 0, errors: [] };
    const { data: run, error } = await db()
      .from("scout_runs")
      .insert({ format_id: formatId, trigger: `watch:${trigger}`, cursor })
      .select("id")
      .single();
    if (error) throw new Error(`scout_runs insert failed: ${error.message}`);
    return await processChunk(run.id, formatId, cursor, deadline);
  }

  return { status: "cooldown" };
}

async function processChunk(runId: string, formatId: string, cursor: WatchCursor, deadline: number): Promise<WatchTickResult> {
  const started = cursor.index === 0 && cursor.pendingReplays === null;
  const stats: ScoutStats = { replaysFound: 0, replaysFetched: 0, newTeams: 0, errors: [] };

  while (cursor.index < cursor.players.length && Date.now() < deadline) {
    const userId = cursor.players[cursor.index];
    try {
      if (cursor.pendingReplays === null) {
        const results = await searchReplaysAll({ user: userId, format: formatId }, { maxPages: 5 });
        cursor.replaysFound += results.length;
        stats.replaysFound += results.length;
        cursor.pendingReplays = results.map((r) => r.id);
        // Zero public replays is the expected common case: recorded, move on.
      }
      while (cursor.pendingReplays.length > 0 && Date.now() < deadline) {
        const id = cursor.pendingReplays[0];
        try {
          await ingestReplay(id, stats);
        } catch (err) {
          cursor.errors.push({ userId, replayId: id, message: err instanceof Error ? err.message : String(err) });
        }
        cursor.pendingReplays.shift();
      }
      if (cursor.pendingReplays.length === 0) {
        cursor.pendingReplays = null;
        cursor.index += 1;
      }
    } catch (err) {
      cursor.errors.push({ userId, message: err instanceof Error ? err.message : String(err) });
      cursor.pendingReplays = null;
      cursor.index += 1;
    }
  }
  cursor.newTeams += stats.newTeams;

  const done = cursor.index >= cursor.players.length;
  const { error } = await db()
    .from("scout_runs")
    .update({
      cursor: done ? null : cursor,
      finished_at: done ? new Date().toISOString() : null,
      players_checked: cursor.index,
      replays_found: cursor.replaysFound,
      new_teams: cursor.newTeams,
      errors: cursor.errors,
    })
    .eq("id", runId);
  if (error) throw new Error(`scout_runs update failed: ${error.message}`);

  return {
    status: done ? "finished" : started ? "started" : "resumed",
    formatId,
    runId,
    playersDone: cursor.index,
    playersTotal: cursor.players.length,
  };
}
