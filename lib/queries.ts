import { db } from "./db";
import type { TeamProfile, TeamSourceRef } from "./scout/merge";

/** Env present? Pages degrade to a setup notice instead of crashing. */
export function dbConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export interface FormatRow {
  id: string;
  display_name: string;
  mechanics: Record<string, unknown>;
  active: boolean;
}

export async function listFormats(): Promise<FormatRow[]> {
  const { data, error } = await db().from("formats").select("*").order("active", { ascending: false });
  if (error) throw new Error(`formats query failed: ${error.message}`);
  return data ?? [];
}

export type TeamOrigin = "replay" | "paste" | "tournament";

export interface TeamProfileRow {
  id: string;
  user_id: string;
  format_id: string;
  fingerprint: string;
  origin: TeamOrigin;
  sources: TeamSourceRef[];
  roster: string[];
  merged_reveals: {
    mons: TeamProfile["mons"];
    megaSlot: Record<string, number>;
    replays: TeamProfile["replays"];
    ties: number;
    displayName: string;
  };
  lead_pairs: Record<string, number>;
  brings: Record<string, number>;
  wins: number;
  losses: number;
  first_seen: string;
  last_seen: string;
}

export async function teamsForPlayer(userId: string, formatId?: string): Promise<TeamProfileRow[]> {
  let q = db().from("team_profiles").select("*").eq("user_id", userId).order("last_seen", { ascending: false });
  if (formatId) q = q.eq("format_id", formatId);
  const { data, error } = await q;
  if (error) throw new Error(`team_profiles query failed: ${error.message}`);
  return data ?? [];
}

export async function browseTeams(opts: { formatId?: string; species?: string; origin?: TeamOrigin; limit?: number }): Promise<TeamProfileRow[]> {
  let q = db().from("team_profiles").select("*").order("last_seen", { ascending: false }).limit(opts.limit ?? 200);
  if (opts.formatId) q = q.eq("format_id", opts.formatId);
  if (opts.species) q = q.contains("roster", [opts.species]);
  if (opts.origin) q = q.eq("origin", opts.origin);
  const { data, error } = await q;
  if (error) throw new Error(`team_profiles browse failed: ${error.message}`);
  return data ?? [];
}
