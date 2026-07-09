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

export interface HomeStats {
  teams: number;
  replays: number;
  tournamentTeams: number;
  /** finished_at of the most recent completed watch/ingest run, or null before any run. */
  lastUpdated: string | null;
}

/** Headline counts + freshness for the landing page (four cheap queries). */
export async function homeStats(): Promise<HomeStats> {
  const count = async (apply: (q: ReturnType<ReturnType<typeof db>["from"]>) => unknown) => {
    const q = db().from("team_profiles");
    const { count: n } = (await apply(q)) as { count: number | null };
    return n ?? 0;
  };
  const [teams, tournamentTeams, replaysRes, lastRunRes] = await Promise.all([
    count((q) => q.select("id", { count: "exact", head: true })),
    count((q) => q.select("id", { count: "exact", head: true }).eq("origin", "tournament")),
    db().from("replays").select("id", { count: "exact", head: true }),
    db()
      .from("scout_runs")
      .select("finished_at")
      .not("finished_at", "is", null)
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  return {
    teams,
    replays: replaysRes.count ?? 0,
    tournamentTeams,
    lastUpdated: (lastRunRes.data as { finished_at: string } | null)?.finished_at ?? null,
  };
}

/** Chip filter values as used by the /teams UI ("" = all). */
export type BrowseChip = "" | "ladder" | "unrated" | "paste" | "tournament";

export async function browseTeams(opts: {
  formatId?: string;
  species?: string;
  chip?: BrowseChip;
  page?: number;
  perPage?: number;
}): Promise<{ rows: TeamProfileRow[]; total: number }> {
  const perPage = opts.perPage ?? 10;
  const page = Math.max(1, opts.page ?? 1);
  let q = db()
    .from("team_profiles")
    .select("*", { count: "exact" })
    .order("last_seen", { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1);
  if (opts.formatId) q = q.eq("format_id", opts.formatId);
  // roster is jsonb — containment needs a JSON string, not a JS array
  // (supabase-js would serialize the array as a Postgres array literal).
  if (opts.species) q = q.contains("roster", JSON.stringify([opts.species]));
  if (opts.chip === "ladder") q = q.eq("origin", "replay").eq("has_rated", true);
  else if (opts.chip === "unrated") q = q.eq("origin", "replay").eq("has_rated", false);
  else if (opts.chip) q = q.eq("origin", opts.chip);
  const { data, error, count } = await q;
  if (error) throw new Error(`team_profiles browse failed: ${error.message}`);
  return { rows: data ?? [], total: count ?? 0 };
}

export interface ChipCountsRow {
  total: number;
  ladder: number;
  unrated: number;
  paste: number;
  tournament: number;
}

/** Whole-format chip counts (SQL fn team_chip_counts — one scan). */
export async function teamChipCounts(formatId: string, species?: string): Promise<ChipCountsRow> {
  const { data, error } = await db().rpc("team_chip_counts", { p_format_id: formatId, p_species: species ?? null });
  if (error) throw new Error(`team_chip_counts failed: ${error.message}`);
  return (data?.[0] as ChipCountsRow | undefined) ?? { total: 0, ladder: 0, unrated: 0, paste: 0, tournament: 0 };
}
