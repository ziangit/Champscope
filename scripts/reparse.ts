/**
 * Re-parse cached replays after a parser improvement — never refetches.
 *
 * Flow: bump PARSER_VERSION in lib/scout/types.ts, then `npm run reparse`.
 * Every replay whose parser_version is older is re-parsed from its cached
 * raw_json, and team_profiles (derived data) are rebuilt from scratch so
 * old parses can't linger in merged reveals.
 *
 * Requires SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (reads .env.local).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Minimal .env.local loader — no dotenv dependency needed.
try {
  for (const line of readFileSync(join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  /* .env.local optional when env is set another way */
}

import { db } from "../lib/db";
import { mergeGame, newTeamProfile, type TeamProfile } from "../lib/scout/merge";
import { parseReplay } from "../lib/scout/parse";
import { PARSER_VERSION, type ParsedReplay } from "../lib/scout/types";
import type { ReplayJSON } from "../lib/showdown/types";

const BATCH = 200;

async function reparseOutdated(): Promise<number> {
  let updated = 0;
  for (;;) {
    const { data, error } = await db()
      .from("replays")
      .select("id, raw_json")
      .lt("parser_version", PARSER_VERSION)
      .limit(BATCH);
    if (error) throw new Error(`replays query failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      const raw = row.raw_json as ReplayJSON;
      const parsed = parseReplay(raw.log, raw);
      const { error: upErr } = await db()
        .from("replays")
        .update({ parsed, parser_version: PARSER_VERSION })
        .eq("id", row.id);
      if (upErr) throw new Error(`replay ${row.id} update failed: ${upErr.message}`);
      updated += 1;
    }
    console.log(`re-parsed ${updated} replays...`);
  }
  return updated;
}

async function rebuildProfiles(): Promise<number> {
  const { error: delErr } = await db().from("team_profiles").delete().neq("fingerprint", "");
  if (delErr) throw new Error(`team_profiles wipe failed: ${delErr.message}`);

  const profiles = new Map<string, TeamProfile>();
  let offset = 0;
  for (;;) {
    const { data, error } = await db()
      .from("replays")
      .select("parsed")
      .order("upload_time", { ascending: true })
      .range(offset, offset + BATCH - 1);
    if (error) throw new Error(`replays page failed: ${error.message}`);
    if (!data || data.length === 0) break;
    offset += data.length;
    for (const row of data) {
      const parsed = row.parsed as ParsedReplay;
      for (const player of parsed.players) {
        if (player.roster.length === 0) continue;
        const fresh = newTeamProfile(player, parsed.formatId);
        const key = `${player.userId}|${parsed.formatId}|${fresh.fingerprint}`;
        const profile = profiles.get(key) ?? fresh;
        profiles.set(key, profile);
        mergeGame(profile, player, { replayId: parsed.replayId, uploadTime: parsed.uploadTime, tie: parsed.tie });
      }
    }
  }

  for (const p of profiles.values()) {
    const { error } = await db()
      .from("team_profiles")
      .upsert(
        {
          user_id: p.userId,
          format_id: p.formatId,
          fingerprint: p.fingerprint,
          roster: p.rosterIds,
          merged_reveals: { mons: p.mons, megaSlot: p.megaSlot, replayIds: p.replayIds, ties: p.ties, displayName: p.displayName },
          lead_pairs: p.leadPairs,
          brings: p.brings,
          wins: p.wins,
          losses: p.losses,
          first_seen: new Date(p.firstSeen * 1000).toISOString(),
          last_seen: new Date(p.lastSeen * 1000).toISOString(),
        },
        { onConflict: "user_id,format_id,fingerprint" },
      );
    if (error) throw new Error(`profile upsert failed: ${error.message}`);
  }
  return profiles.size;
}

async function main() {
  console.log(`reparse to parser_version ${PARSER_VERSION}`);
  const updated = await reparseOutdated();
  console.log(`re-parsed ${updated} replays; rebuilding team profiles from all cached replays...`);
  const count = await rebuildProfiles();
  console.log(`done: ${count} team profiles rebuilt.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
