import Link from "next/link";

const PAGES = [
  {
    href: "/scout",
    title: "Scout",
    body: "Search a player's public replays, parse every game, and file their teams with merged sets.",
  },
  {
    href: "/teams",
    title: "Teams",
    body: "Browse every team on file. Filter by species to find who runs what.",
  },
  {
    href: "/match",
    title: "Match",
    body: "Paste an opponent's team preview and find it — exact rosters and 4+ overlaps, tournament teams first.",
  },
  {
    href: "/watch",
    title: "Watch",
    body: "The ladder watcher's daily digest: top-50 snapshots, new finds, and alt suggestions.",
  },
] as const;

const SOURCES = [
  {
    title: "Ladder replays",
    dot: "bg-accent",
    body: "The watcher snapshots the top 50 every 12 hours and parses every public replay they leave behind; ad-hoc scouts use the same pipeline. Only what was actually revealed in battle — unrated challenge games are labeled separately.",
  },
  {
    title: "VGCPastes",
    dot: "bg-emerald-500",
    body: "The community-curated paste repository, synced on schedule: full published sets with EV spreads, replica codes, events and creator credits.",
  },
  {
    title: "Official tournament sheets",
    dot: "bg-violet-500",
    body: "Open team sheets from sanctioned events (regionals, internationals, Worlds) with placings and records, via pokedata.ovh — official sheets never include EVs.",
  },
  {
    title: "Community majors",
    dot: "bg-violet-500",
    body: "Featured community events like Victory Road's Champions Arena, via MetaVGC: full sets including EV spreads, with placements.",
  },
] as const;

export default function Home() {
  return (
    <div className="mx-auto max-w-3xl py-8">
      <h1 className="font-display text-5xl font-bold uppercase tracking-wide">
        Champ<span className="text-accent">scope</span>
      </h1>
      <p className="mt-2 max-w-prose text-steel">
        VGC-first replay scouting for the Pokémon Champions ladder: lead pairs, bring-4 patterns, Mega usage, and
        merged sets rebuilt from every public replay a player leaves behind.
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PAGES.map((p) => (
          <Link key={p.href} href={p.href} className="rounded border border-line bg-card p-4 hover:border-steel">
            <h2 className="font-display text-xl font-semibold uppercase tracking-wide">{p.title}</h2>
            <p className="mt-1 text-sm text-steel">{p.body}</p>
          </Link>
        ))}
      </div>

      <section className="mt-10">
        <h2 className="font-display text-xl font-semibold uppercase tracking-wide">Where the teams come from</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {SOURCES.map((s) => (
            <div key={s.title} className="rounded border border-line bg-card p-4">
              <h3 className="flex items-center gap-2 font-display font-semibold uppercase tracking-wide">
                <span className={`h-2 w-2 rounded-full ${s.dot}`} />
                {s.title}
              </h3>
              <p className="mt-1 text-sm text-steel">{s.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-steel">
          Every team is labeled with its origin, and sets show only what the source actually revealed or published —
          EVs and natures are never inferred.
        </p>
      </section>
    </div>
  );
}
