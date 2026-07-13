"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { ingestReplay, scoutUser, type ScoutStats } from "@/lib/scout/ingest";
import { baseReplayId, toID } from "@/lib/showdown/id";

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
    .filter(Boolean);
  const replayIds = [...urlsRaw.matchAll(REPLAY_URL)].map((m) => m[1].replace(/\.json$/, ""));

  if (names.length === 0 && replayIds.length === 0) redirect("/scout?error=empty");
  if (names.length > 1) redirect("/scout?error=multi"); // one username per scout
  const name = names[0];

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

  // Replays first: cheap (cached forever), and when a username is also given
  // they double as the membership check below.
  for (const id of replayIds) {
    const stats: ScoutStats = { replaysFound: 1, replaysFetched: 0, newTeams: 0, errors: [] };
    try {
      await ingestReplay(id, stats);
    } catch (err) {
      stats.errors.push({ replayId: id, message: err instanceof Error ? err.message : String(err) });
    }
    merge(stats);
  }

  // Which of the given replays actually exist (post-ingest)? A URL that
  // fetched nothing is a bad link, not a silent no-op. Stored ids are the
  // base form — pasted private URLs carry a `-<password>pw` suffix.
  const baseIds = replayIds.map(baseReplayId);
  let knownReplays: { p1_user_id: string; p2_user_id: string }[] = [];
  if (replayIds.length > 0) {
    const { data } = await db().from("replays").select("p1_user_id, p2_user_id").in("id", baseIds);
    knownReplays = data ?? [];
    if (knownReplays.length === 0) {
      await db().from("scout_runs").insert({
        ...run,
        finished_at: new Date().toISOString(),
        players_checked: 0,
        replays_found: totals.replaysFound,
        new_teams: 0,
        errors: totals.errors,
      });
      redirect("/scout?error=badreplay");
    }
  }

  // Username + replays only make sense together when the username actually
  // plays in those replays — otherwise the combination has no result.
  let mismatch = false;
  if (name && replayIds.length > 0) {
    const userId = toID(name);
    mismatch = !knownReplays.some((r) => r.p1_user_id === userId || r.p2_user_id === userId);
  }

  if (name && !mismatch) {
    merge(await scoutUser(name, { formatId, since }));
  }

  await db().from("scout_runs").insert({
    ...run,
    finished_at: new Date().toISOString(),
    players_checked: name && !mismatch ? 1 : 0,
    replays_found: totals.replaysFound,
    new_teams: totals.newTeams,
    errors: totals.errors,
  });

  if (mismatch) redirect("/scout?error=mismatch");
  // A replay's format is embedded in its id and may differ from the dropdown.
  const resultFormat = !name && replayIds.length > 0 ? baseIds[0].replace(/-\d+$/, "") : formatId;
  if (name) {
    redirect(`/scout?scouted=${toID(name)}&format=${resultFormat}`);
  }
  // Replay-only scout: show both players of the given replay(s).
  const subjects: string[] = [];
  for (const r of knownReplays) {
    for (const u of [r.p1_user_id, r.p2_user_id]) if (u && !subjects.includes(u)) subjects.push(u);
  }
  redirect(`/scout?scouted=${subjects.slice(0, 8).join(",")}&format=${resultFormat}`);
}
