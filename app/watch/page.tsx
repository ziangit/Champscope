import Link from "next/link";
import { SetupNotice } from "@/components/SetupNotice";
import { db } from "@/lib/db";
import { browseTeams, dbConfigured, listFormats } from "@/lib/queries";
import { correlateAlts } from "@/lib/scout/merge";

export const dynamic = "force-dynamic";

interface Standing {
  rank: number;
  user_id: string;
  name: string;
  elo: number;
  gxe: number;
}

export default async function WatchPage({ searchParams }: { searchParams: Promise<{ format?: string }> }) {
  if (!dbConfigured()) return <SetupNotice />;
  const { format } = await searchParams;
  const formats = await listFormats();
  const formatId = format ?? formats.find((f) => f.active)?.id;
  if (!formatId) return <p className="text-steel">No active format configured — seed the formats table.</p>;

  const [{ data: runs }, { data: snapshots }, newTeams, { data: allProfiles }] = await Promise.all([
    db().from("scout_runs").select("*").eq("format_id", formatId).like("trigger", "watch%").order("started_at", { ascending: false }).limit(5),
    db().from("ladder_snapshots").select("*").eq("format_id", formatId).order("taken_at", { ascending: false }).limit(2),
    browseTeams({ formatId, limit: 15 }),
    db().from("team_profiles").select("user_id, format_id, fingerprint").eq("format_id", formatId),
  ]);

  const lastRun = runs?.[0];
  const current: Standing[] = snapshots?.[0]?.standings ?? [];
  const previous: Standing[] = snapshots?.[1]?.standings ?? [];
  const prevByUser = new Map(previous.map((s) => [s.user_id, s]));

  // Coverage: how many of the current top 50 have at least one team on file.
  const profiles = (allProfiles ?? []) as { user_id: string; format_id: string; fingerprint: string }[];
  const trackedUsers = new Set(profiles.map((p) => p.user_id));
  const covered = current.filter((s) => trackedUsers.has(s.user_id));
  const alts = correlateAlts(profiles.map((p) => ({ userId: p.user_id, formatId: p.format_id, fingerprint: p.fingerprint })));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-baseline gap-4">
        <h1 className="font-display text-3xl font-bold uppercase tracking-wide">Ladder watch</h1>
        <nav className="flex gap-3 text-sm">
          {formats.map((f) => (
            <Link key={f.id} href={`/watch?format=${f.id}`} className={f.id === formatId ? "font-semibold text-accent" : "text-steel hover:text-ink"}>
              {f.display_name}
            </Link>
          ))}
        </nav>
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded border border-line bg-card p-4">
          <h2 className="font-display font-semibold uppercase tracking-wide text-steel">Last pass</h2>
          {lastRun ? (
            <div className="mt-1 text-sm">
              <p className="font-mono text-xs text-steel">{new Date(lastRun.started_at).toISOString().replace("T", " ").slice(0, 16)} · {lastRun.trigger}</p>
              <p className="mt-1">
                {lastRun.finished_at ? "Finished" : `In progress — ${lastRun.players_checked}/50 players`} ·{" "}
                {lastRun.replays_found} replays found · {lastRun.new_teams} new teams
              </p>
              {Array.isArray(lastRun.errors) && lastRun.errors.length > 0 && (
                <p className="mt-1 text-xs text-loss">{lastRun.errors.length} error(s) recorded</p>
              )}
            </div>
          ) : (
            <p className="mt-1 text-sm text-steel">No watch pass has run yet. The scheduler will start one, or hit /api/watch/run with the bearer token.</p>
          )}
        </div>

        <div className="rounded border border-line bg-card p-4">
          <h2 className="font-display font-semibold uppercase tracking-wide text-steel">Coverage</h2>
          <p className="mt-1 text-3xl font-semibold">
            {covered.length}
            <span className="text-base font-normal text-steel"> / {current.length || TOP_N_LABEL} with a team on file</span>
          </p>
          <p className="mt-1 text-xs text-steel">Most top players never upload replays — sparse coverage is expected; the watcher harvests the rare public exposure.</p>
        </div>

        <div className="rounded border border-line bg-card p-4">
          <h2 className="font-display font-semibold uppercase tracking-wide text-steel">Alt suggestions</h2>
          {alts.length === 0 ? (
            <p className="mt-1 text-sm text-steel">No identical team fingerprints under different names yet.</p>
          ) : (
            <ul className="mt-1 space-y-1 text-sm">
              {alts.slice(0, 6).map((a) => (
                <li key={a.fingerprint}>
                  {a.userIds.map((u, i) => (
                    <span key={u}>
                      {i > 0 && " ≈ "}
                      <Link href={`/player/${u}?format=${formatId}`} className="underline hover:text-accent">{u}</Link>
                    </span>
                  ))}
                  <span className="ml-1 font-mono text-xs text-steel" title="Same team fingerprint — possibly the same player; never asserted as fact">?</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="font-display text-xl font-semibold uppercase tracking-wide">Top 50</h2>
          <p className="text-xs text-steel">Latest snapshot{snapshots?.[0] ? ` · ${new Date(snapshots[0].taken_at).toISOString().slice(0, 10)}` : ""}; Δ vs previous snapshot.</p>
          <table className="mt-2 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left font-display uppercase tracking-wide text-steel">
                <th className="py-1 pr-2">#</th><th className="py-1 pr-2">Player</th><th className="py-1 pr-2 text-right">Elo</th><th className="py-1 pr-2 text-right">Δ</th><th className="py-1 text-right">GXE</th><th className="py-1 text-right">Scouted</th>
              </tr>
            </thead>
            <tbody>
              {current.map((s) => {
                const prev = prevByUser.get(s.user_id);
                const delta = prev ? s.elo - prev.elo : null;
                return (
                  <tr key={s.user_id} className="border-b border-line">
                    <td className="py-1 pr-2 font-mono text-xs text-steel">{s.rank}</td>
                    <td className="py-1 pr-2">{prev ? s.name : <><span title="New in top 50 since the previous snapshot" className="text-accent">•</span> {s.name}</>}</td>
                    <td className="py-1 pr-2 text-right font-mono">{s.elo}</td>
                    <td className={`py-1 pr-2 text-right font-mono text-xs ${delta && delta > 0 ? "text-win" : delta && delta < 0 ? "text-loss" : "text-steel"}`}>
                      {delta === null ? "new" : delta === 0 ? "±0" : delta > 0 ? `+${delta}` : delta}
                    </td>
                    <td className="py-1 text-right font-mono text-xs">{s.gxe}</td>
                    <td className="py-1 text-right">
                      {trackedUsers.has(s.user_id) ? (
                        <Link href={`/player/${s.user_id}?format=${formatId}`} className="text-accent underline">yes</Link>
                      ) : (
                        <span className="text-steel" title="No public replays found yet">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {current.length === 0 && (
                <tr><td colSpan={6} className="py-3 text-steel">No ladder snapshot yet — the first watch pass will take one.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div>
          <h2 className="font-display text-xl font-semibold uppercase tracking-wide">New finds</h2>
          <p className="text-xs text-steel">Most recently seen teams in this format.</p>
          <ul className="mt-2 space-y-2">
            {newTeams.map((t) => (
              <li key={t.id} className="rounded border border-line bg-card px-3 py-2 text-sm">
                <Link href={`/player/${t.user_id}?format=${formatId}`} className="font-semibold hover:text-accent">
                  {t.merged_reveals.displayName || t.user_id}
                </Link>
                <span className="ml-2 font-mono text-xs text-steel">sheet {t.fingerprint.slice(0, 8)}</span>
                <div className="mt-0.5 text-xs text-steel">{t.roster.join(" · ")}</div>
              </li>
            ))}
            {newTeams.length === 0 && <li className="text-sm text-steel">Nothing filed yet.</li>}
          </ul>
        </div>
      </section>
    </div>
  );
}

const TOP_N_LABEL = 50;
