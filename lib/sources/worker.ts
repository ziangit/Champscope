import { db } from "../db";
import { pokedataToReveals } from "../scout/import";
import { toID } from "../showdown/id";
import { POKEDATA_WINDOWS, VGCPASTES_SHEETS } from "./config";
import { fetchMastersSheets, listPokedataTournaments, splitCountryTag, type PendingTournament } from "./pokedata";
import { knownSourceKeys, storeImportedTeams, type ImportedTeam } from "./store";
import { ingestVgcpastesEntry, listVgcpastesEntries, pasteKey, type VgcpastesEntry } from "./vgcpastes";

/**
 * Team-source ingest worker, same chunked design as lib/watch.ts: each
 * invocation does what fits in its time budget, persists a cursor in
 * scout_runs.cursor, and resumes on the next hit. Sources run as separate
 * passes (vgcpastes first); everything is idempotent per source key, so
 * re-running a pass is cheap and safe.
 */

const SOURCES = ["vgcpastes", "pokedata"] as const;
export type IngestSource = (typeof SOURCES)[number];

/** Weekly schedule; 20 h still allows a manual next-day re-run. */
const PASS_COOLDOWN_MS = 20 * 60 * 60 * 1000;

/** Tournament players stored per bulk write (3 DB round-trips per batch). */
const POKEDATA_BATCH = 100;

interface IngestCursor {
  source: IngestSource;
  /** vgcpastes: unseen entries left to fetch, each tagged with its sheet config index. */
  queue?: { cfg: number; entry: VgcpastesEntry }[];
  /** pokedata: tournaments in configured windows; player offset within the current one. */
  tournaments?: PendingTournament[];
  tIndex?: number;
  playerOffset?: number;
  imported: number;
  merged: number;
  seen: number;
  errors: { source: string; item?: string; message: string }[];
}

export interface IngestTickResult {
  status: "started" | "resumed" | "finished" | "cooldown";
  source?: IngestSource;
  runId?: string;
  imported?: number;
  remaining?: number;
}

async function initCursor(source: IngestSource): Promise<IngestCursor> {
  const cursor: IngestCursor = { source, imported: 0, merged: 0, seen: 0, errors: [] };
  if (source === "vgcpastes") {
    cursor.queue = [];
    for (let i = 0; i < VGCPASTES_SHEETS.length; i++) {
      const cfg = VGCPASTES_SHEETS[i];
      const entries = await listVgcpastesEntries(cfg);
      const known = await knownSourceKeys(cfg.formatId, "paste");
      for (const entry of entries) {
        if (known.has(pasteKey(entry.pasteUrl))) cursor.seen += 1;
        else cursor.queue.push({ cfg: i, entry });
      }
    }
  } else {
    cursor.tournaments = await listPokedataTournaments();
    cursor.tIndex = 0;
    cursor.playerOffset = 0;
  }
  return cursor;
}

/** Process one chunk of an ingest pass; call repeatedly until "finished". */
export async function ingestTick(deadline: number, trigger: string): Promise<IngestTickResult> {
  const { data: open, error: openErr } = await db()
    .from("scout_runs")
    .select("*")
    .like("trigger", "ingest:%")
    .is("finished_at", null)
    .order("started_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (openErr) throw new Error(`scout_runs query failed: ${openErr.message}`);
  if (open) return await processChunk(open.id, open.cursor as IngestCursor, deadline, false);

  for (const source of SOURCES) {
    const { data: last, error: lastErr } = await db()
      .from("scout_runs")
      .select("started_at")
      .like("trigger", `ingest:${source}%`)
      .not("finished_at", "is", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastErr) throw new Error(`scout_runs query failed: ${lastErr.message}`);
    if (last && Date.now() - new Date(last.started_at).getTime() < PASS_COOLDOWN_MS) continue;

    const cursor = await initCursor(source);
    const formatId = source === "vgcpastes" ? VGCPASTES_SHEETS[0].formatId : POKEDATA_WINDOWS[0].formatId;
    const { data: run, error } = await db()
      .from("scout_runs")
      .insert({ format_id: formatId, trigger: `ingest:${source}:${trigger}`, cursor })
      .select("id")
      .single();
    if (error) throw new Error(`scout_runs insert failed: ${error.message}`);
    return await processChunk(run.id, cursor, deadline, true);
  }
  return { status: "cooldown" };
}

async function processChunk(runId: string, cursor: IngestCursor, deadline: number, started: boolean): Promise<IngestTickResult> {
  if (cursor.source === "vgcpastes") await vgcpastesChunk(cursor, deadline);
  else await pokedataChunk(cursor, deadline);

  const remaining = cursor.source === "vgcpastes" ? (cursor.queue?.length ?? 0) : (cursor.tournaments?.length ?? 0) - (cursor.tIndex ?? 0);
  const done = remaining === 0;
  const { error } = await db()
    .from("scout_runs")
    .update({
      cursor: done ? null : cursor,
      finished_at: done ? new Date().toISOString() : null,
      replays_found: cursor.imported + cursor.merged, // teams fetched this pass
      new_teams: cursor.imported,
      errors: cursor.errors,
    })
    .eq("id", runId);
  if (error) throw new Error(`scout_runs update failed: ${error.message}`);

  return {
    status: done ? "finished" : started ? "started" : "resumed",
    source: cursor.source,
    runId,
    imported: cursor.imported,
    remaining,
  };
}

async function vgcpastesChunk(cursor: IngestCursor, deadline: number) {
  const queue = cursor.queue ?? [];
  while (queue.length > 0 && Date.now() < deadline) {
    const { cfg, entry } = queue[0];
    try {
      const result = await ingestVgcpastesEntry(entry, VGCPASTES_SHEETS[cfg]);
      cursor[result === "new" ? "imported" : result === "merged" ? "merged" : "seen"] += 1;
    } catch (err) {
      cursor.errors.push({ source: "vgcpastes", item: entry.pasteUrl, message: err instanceof Error ? err.message : String(err) });
    }
    queue.shift();
  }
}

async function pokedataChunk(cursor: IngestCursor, deadline: number) {
  const tournaments = cursor.tournaments ?? [];
  while ((cursor.tIndex ?? 0) < tournaments.length && Date.now() < deadline) {
    const t = tournaments[cursor.tIndex!];
    try {
      const players = await fetchMastersSheets(t.rk9link);
      while (cursor.playerOffset! < players.length && Date.now() < deadline) {
        const batch = players.slice(cursor.playerOffset!, cursor.playerOffset! + POKEDATA_BATCH);
        const teams: ImportedTeam[] = [];
        for (const p of batch) {
          const { name } = splitCountryTag(p.name);
          const userId = toID(name);
          if (!userId) {
            cursor.errors.push({ source: "pokedata", item: `${t.rk9link}:${p.placing}`, message: `unusable player name: ${p.name}` });
            continue;
          }
          const endMs = Date.parse(t.endDate);
          teams.push({
            formatId: t.formatId,
            origin: "tournament",
            userId,
            displayName: name,
            roster: pokedataToReveals(p.decklist ?? []),
            source: {
              key: `pokedata:${t.rk9link}:${userId}`,
              url: `https://www.pokedata.ovh/apiv2/id/${t.rk9link}/decklists`,
              provider: "pokedata.ovh",
              kind: "tournament",
              event: t.name,
              placing: p.placing,
              record: p.record,
              sharedAt: Number.isFinite(endMs) ? Math.floor(endMs / 1000) : undefined,
            },
          });
        }
        const stats = await storeImportedTeams(teams);
        cursor.imported += stats.imported;
        cursor.merged += stats.merged;
        cursor.seen += stats.seen;
        cursor.playerOffset! += batch.length;
      }
      if (cursor.playerOffset! >= players.length) {
        cursor.tIndex! += 1;
        cursor.playerOffset = 0;
      }
    } catch (err) {
      cursor.errors.push({ source: "pokedata", item: t.rk9link, message: err instanceof Error ? err.message : String(err) });
      cursor.tIndex! += 1;
      cursor.playerOffset = 0;
    }
  }
}
