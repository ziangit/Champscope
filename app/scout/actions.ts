"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { ingestReplay, scoutUser, type ScoutStats } from "@/lib/scout/ingest";
import { toID } from "@/lib/showdown/id";

const REPLAY_URL = /replay\.pokemonshowdown\.com\/([a-z0-9-]+)/g;

export async function runScout(formData: FormData): Promise<void> {
  const formatId = String(formData.get("format") ?? "");
  const namesRaw = String(formData.get("names") ?? "");
  const urlsRaw = String(formData.get("urls") ?? "");
  const sinceRaw = String(formData.get("since") ?? "");
  const since = sinceRaw ? Math.floor(new Date(sinceRaw).getTime() / 1000) : undefined;

  const names = namesRaw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 5); // politeness: cap ad-hoc fan-out
  const replayIds = [...urlsRaw.matchAll(REPLAY_URL)].map((m) => m[1].replace(/\.json$/, ""));

  if (names.length === 0 && replayIds.length === 0) redirect("/scout?error=empty");

  const run = {
    format_id: formatId,
    trigger: "adhoc",
    started_at: new Date().toISOString(),
  };

  const totals: ScoutStats = { replaysFound: 0, replaysFetched: 0, newTeams: 0, errors: [] };
  const merge = (s: ScoutStats) => {
    totals.replaysFound += s.replaysFound;
    totals.replaysFetched += s.replaysFetched;
    totals.newTeams += s.newTeams;
    totals.errors.push(...s.errors);
  };

  for (const name of names) {
    merge(await scoutUser(name, { formatId, since }));
  }
  for (const id of replayIds) {
    const stats: ScoutStats = { replaysFound: 1, replaysFetched: 0, newTeams: 0, errors: [] };
    try {
      await ingestReplay(id, stats);
    } catch (err) {
      stats.errors.push({ replayId: id, message: err instanceof Error ? err.message : String(err) });
    }
    merge(stats);
  }

  await db().from("scout_runs").insert({
    ...run,
    finished_at: new Date().toISOString(),
    players_checked: names.length,
    replays_found: totals.replaysFound,
    new_teams: totals.newTeams,
    errors: totals.errors,
  });

  if (names.length > 0) {
    redirect(`/player/${toID(names[0])}?format=${formatId}&scouted=1`);
  }
  redirect(`/teams?format=${formatId}&scouted=1`);
}
