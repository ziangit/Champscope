import Link from "next/link";
import { dbConfigured, homeStats, type HomeStats } from "@/lib/queries";
import { iconStyle } from "@/lib/sprites";

export const dynamic = "force-dynamic";

const PAGES = [
  { href: "/scout", title: "Scout", body: "Pull a player's public replays and file their teams." },
  { href: "/teams", title: "Teams", body: "Browse everything on file, by species or origin." },
  { href: "/match", title: "Match", body: "Paste a team preview, find exact and 4+ matches." },
  { href: "/watch", title: "Watch", body: "The automated top-50 ladder watcher's digest." },
] as const;

const SOURCES = [
  { title: "Ladder replays", dot: "bg-accent", body: "top 50 watched every 12 h, battle-revealed data only" },
  { title: "VGCPastes", dot: "bg-emerald-500", body: "community pastes with full EVs and replica codes" },
  { title: "Official tournaments", dot: "bg-violet-500", body: "RK9 open team sheets with placings" },
  { title: "Community majors", dot: "bg-violet-500", body: "featured events like the Champions Arena" },
] as const;

/** The current meta's poster mons, drawn from the official icon sheet. */
const HERO_MONS = ["charizard", "garchomp", "sylveon", "kingambit", "incineroar", "whimsicott"];

export default async function Home() {
  const stats: HomeStats | null = dbConfigured() ? await homeStats().catch(() => null) : null;

  return (
    <div className="mx-auto max-w-3xl py-10">
      <div className="flex select-none" aria-hidden>
        {HERO_MONS.map((id) => (
          <span key={id} style={iconStyle(id)} className="-mx-1 inline-block h-[30px] w-[40px]" />
        ))}
      </div>
      <h1 className="mt-2 font-display text-5xl font-bold uppercase tracking-wide">
        Champ<span className="text-accent">scope</span>
      </h1>
      <p className="mt-2 max-w-prose text-steel">
        VGC-first team scouting for the Pokémon Champions ladder — lead pairs, bring-4 patterns, Mega usage, and
        merged sets from every public replay a player leaves behind.
      </p>

      {stats && (
        <div className="mt-6 flex flex-wrap gap-x-10 gap-y-2">
          {[
            [stats.teams, "teams on file"],
            [stats.replays, "replays parsed"],
            [stats.tournamentTeams, "tournament sheets"],
          ].map(([n, label]) => (
            <div key={label}>
              <div className="font-display text-3xl font-bold tabular-nums">{Number(n).toLocaleString()}</div>
              <div className="text-xs uppercase tracking-wide text-steel">{label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {PAGES.map((p) => (
          <Link
            key={p.href}
            href={p.href}
            className="group rounded border border-line bg-card px-4 py-3 transition-colors hover:border-steel"
          >
            <h2 className="flex items-baseline justify-between font-display text-lg font-semibold uppercase tracking-wide">
              {p.title}
              <span className="text-steel transition-transform group-hover:translate-x-0.5 group-hover:text-ink">→</span>
            </h2>
            <p className="mt-0.5 text-sm text-steel">{p.body}</p>
          </Link>
        ))}
      </div>

      <section className="mt-10 rounded border border-line bg-card px-4 py-3">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-steel">Team sources</h2>
        <ul className="mt-2 space-y-1.5">
          {SOURCES.map((s) => (
            <li key={s.title} className="flex items-baseline gap-2 text-sm">
              <span className={`h-2 w-2 shrink-0 self-center rounded-full ${s.dot}`} />
              <span className="font-semibold">{s.title}</span>
              <span className="text-steel">— {s.body}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2.5 border-t border-line pt-2 text-xs text-steel">
          Every team is origin-labeled; EVs and natures are never inferred.
        </p>
      </section>
    </div>
  );
}
