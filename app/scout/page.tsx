import Link from "next/link";
import { dbConfigured, listFormats, teamsForPlayer } from "@/lib/queries";
import { chipCounts, chipValue, filterByChip, OriginChips } from "@/components/OriginChips";
import { SetupNotice } from "@/components/SetupNotice";
import { TeamCard } from "@/components/TeamCard";
import { runScout } from "./actions";

export const dynamic = "force-dynamic";

export default async function ScoutPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; scouted?: string; format?: string; origin?: string }>;
}) {
  const { error, scouted, format, origin } = await searchParams;
  if (!dbConfigured()) return <SetupNotice />;
  const formats = await listFormats();
  // Results render below the form — the form always stays on top. Multiple
  // subjects (several usernames and/or a replay's two players) each get a
  // section; the chips filter across all of them.
  const chip = chipValue(origin);
  const subjects = (scouted ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 12);
  const bySubject = await Promise.all(subjects.map(async (u) => ({ userId: u, teams: await teamsForPlayer(u, format) })));
  const allTeams = bySubject.flatMap((s) => s.teams);

  return (
    <div>
      <div className="max-w-2xl">
      <h1 className="font-display text-3xl font-bold uppercase tracking-wide">Scout a player</h1>
      <p className="mt-1 text-sm text-steel">
        Searches public replays, parses every new game, and files the teams. Already-cached replays are never
        refetched. Most ladder players have no public replays — an empty result is an answer too.
      </p>

      {error === "empty" && (
        <p className="mt-4 rounded border border-accent/40 bg-accent/5 px-3 py-2 text-sm text-accent">
          Enter a username or replay URL to scout.
        </p>
      )}
      {error === "multi" && (
        <p className="mt-4 rounded border border-accent/40 bg-accent/5 px-3 py-2 text-sm text-accent">
          One username per scout, please.
        </p>
      )}
      {error === "mismatch" && (
        <p className="mt-4 rounded border border-accent/40 bg-accent/5 px-3 py-2 text-sm text-accent">
          No result — that username doesn&apos;t play in the given replay(s).
        </p>
      )}
      {error === "badreplay" && (
        <p className="mt-4 rounded border border-accent/40 bg-accent/5 px-3 py-2 text-sm text-accent">
          Couldn&apos;t fetch that replay — the URL doesn&apos;t point to an existing public replay.
        </p>
      )}

      <form action={runScout} className="mt-6 space-y-4">
        <label className="block">
          <span className="font-display font-semibold uppercase tracking-wide text-steel">Username</span>
          <input
            type="text"
            name="names"
            placeholder="a Showdown username"
            className="mt-1 w-full rounded border border-line bg-card px-3 py-2 font-mono text-sm focus-visible:outline-2 focus-visible:outline-accent"
          />
          <span className="mt-1 block text-xs text-steel">
            With replay URLs below: the username must play in those replays, or the scout returns no result.
          </span>
        </label>

        <label className="block">
          <span className="font-display font-semibold uppercase tracking-wide text-steel">Replay URLs</span>
          <textarea
            name="urls"
            rows={2}
            placeholder="https://replay.pokemonshowdown.com/gen9championsvgc2026regmb-…"
            className="mt-1 w-full rounded border border-line bg-card px-3 py-2 font-mono text-sm focus-visible:outline-2 focus-visible:outline-accent"
          />
        </label>

        <div className="flex flex-wrap gap-4">
          <label className="block">
            <span className="font-display font-semibold uppercase tracking-wide text-steel">Format</span>
            <select
              name="format"
              className="mt-1 block rounded border border-line bg-card px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent"
            >
              {formats.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.display_name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="font-display font-semibold uppercase tracking-wide text-steel">Only since</span>
            <input
              type="date"
              name="since"
              className="mt-1 block rounded border border-line bg-card px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent"
            />
          </label>
        </div>

        <button
          type="submit"
          className="rounded bg-ink px-4 py-2 font-display text-lg font-semibold uppercase tracking-wide text-paper hover:bg-accent focus-visible:outline-2 focus-visible:outline-accent"
        >
          Run scout
        </button>
        <p className="text-xs text-steel">
          Requests go through a polite serial queue (~0.6 s each) — scouting a busy player takes a moment.
        </p>
      </form>
      </div>

      {scouted && (
        <section className="mt-8 space-y-4">
          <p className="rounded border border-win/40 bg-win/5 px-3 py-2 text-sm text-win">
            Scout finished — {subjects.length} player{subjects.length === 1 ? "" : "s"}, {allTeams.length} team
            {allTeams.length === 1 ? "" : "s"} on file.
          </p>
          {allTeams.length > 0 && <OriginChips path="/scout" params={{ scouted, format }} current={chip} counts={chipCounts(allTeams)} />}
          {bySubject.map(({ userId, teams: subjectTeams }) => {
            const shown = filterByChip(subjectTeams, chip);
            return (
              <div key={userId} className="space-y-4">
                <h2 className="border-b border-line pb-1 font-display text-xl font-bold uppercase tracking-wide">
                  <Link href={`/player/${userId}${format ? `?format=${format}` : ""}`} className="hover:text-accent">
                    {subjectTeams[0]?.merged_reveals.displayName ?? userId}
                  </Link>{" "}
                  <span className="text-sm font-normal text-steel">
                    {subjectTeams.length === 0
                      ? "— no public replays found (recorded, not an error)"
                      : `${shown.length}${chip ? ` of ${subjectTeams.length}` : ""} team${subjectTeams.length === 1 ? "" : "s"}`}
                  </span>
                </h2>
                {shown.map((row) => (
                  <TeamCard key={row.id} row={row} />
                ))}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
