import { dbConfigured, listFormats } from "@/lib/queries";
import { SetupNotice } from "@/components/SetupNotice";
import { runScout } from "./actions";

export const dynamic = "force-dynamic";

export default async function ScoutPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  if (!dbConfigured()) return <SetupNotice />;
  const formats = await listFormats();

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-3xl font-bold uppercase tracking-wide">Scout a player</h1>
      <p className="mt-1 text-sm text-steel">
        Searches public replays, parses every new game, and files the teams. Already-cached replays are never
        refetched. Most ladder players have no public replays — an empty result is an answer too.
      </p>

      {error === "empty" && (
        <p className="mt-4 rounded border border-accent/40 bg-accent/5 px-3 py-2 text-sm text-accent">
          Enter at least one username or replay URL to scout.
        </p>
      )}

      <form action={runScout} className="mt-6 space-y-4">
        <label className="block">
          <span className="font-display font-semibold uppercase tracking-wide text-steel">Usernames</span>
          <textarea
            name="names"
            rows={2}
            placeholder={"one per line or comma-separated, e.g.\nYOASOBI stan"}
            className="mt-1 w-full rounded border border-line bg-card px-3 py-2 font-mono text-sm focus-visible:outline-2 focus-visible:outline-accent"
          />
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
  );
}
