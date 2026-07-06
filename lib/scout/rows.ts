import type { TeamProfile } from "./merge";

/**
 * team_profiles row <-> TeamProfile mapping, shared by the replay ingest,
 * the reparse script, and the team-source import store so the JSON shape
 * is defined exactly once.
 */

export function profileRow(p: TeamProfile, origin: "replay" | "paste" | "tournament") {
  return {
    user_id: p.userId,
    format_id: p.formatId,
    fingerprint: p.fingerprint,
    origin,
    sources: p.sources,
    roster: p.rosterIds,
    merged_reveals: {
      mons: p.mons,
      megaSlot: p.megaSlot,
      replays: p.replays,
      ties: p.ties,
      displayName: p.displayName,
    },
    lead_pairs: p.leadPairs,
    brings: p.brings,
    wins: p.wins,
    losses: p.losses,
    first_seen: new Date(p.firstSeen * 1000).toISOString(),
    last_seen: new Date(p.lastSeen * 1000).toISOString(),
  };
}

export const PROFILE_CONFLICT_KEY = "user_id,format_id,fingerprint,origin";

export function profileFromRow(row: Record<string, unknown>, base: TeamProfile): TeamProfile {
  const merged = (row.merged_reveals ?? {}) as Partial<TeamProfile> & Record<string, never>;
  return {
    ...base,
    mons: merged.mons ?? {},
    megaSlot: merged.megaSlot ?? {},
    replays: merged.replays ?? [],
    ties: merged.ties ?? 0,
    sources: (row.sources as TeamProfile["sources"]) ?? [],
    leadPairs: (row.lead_pairs as TeamProfile["leadPairs"]) ?? {},
    brings: (row.brings as TeamProfile["brings"]) ?? {},
    wins: (row.wins as number) ?? 0,
    losses: (row.losses as number) ?? 0,
    firstSeen: Math.floor(new Date(row.first_seen as string).getTime() / 1000),
    lastSeen: Math.floor(new Date(row.last_seen as string).getTime() / 1000),
  };
}
