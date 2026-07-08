import Link from "next/link";

const PAGES = [
  { href: "/scout", title: "Scout", body: "Pull a player's public replays and file their teams." },
  { href: "/teams", title: "Teams", body: "Browse everything on file — filter by species or origin." },
  { href: "/match", title: "Match", body: "Paste a team preview, find exact and 4+ matches." },
  { href: "/watch", title: "Watch", body: "The automated top-50 ladder watcher's digest." },
] as const;

const SOURCES = [
  { title: "Ladder replays", dot: "bg-accent", body: "top 50 watched every 12 h, battle-revealed data only" },
  { title: "VGCPastes", dot: "bg-emerald-500", body: "community pastes with full EVs and replica codes" },
  { title: "Official tournaments", dot: "bg-violet-500", body: "RK9 open team sheets with placings" },
  { title: "Community majors", dot: "bg-violet-500", body: "featured events like the Champions Arena" },
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

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {PAGES.map((p) => (
          <Link key={p.href} href={p.href} className="rounded border border-line bg-card p-4 hover:border-steel">
            <h2 className="font-display text-xl font-semibold uppercase tracking-wide">{p.title}</h2>
            <p className="mt-1 text-sm text-steel">{p.body}</p>
          </Link>
        ))}
      </div>

      <section className="mt-10">
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
        <p className="mt-3 text-xs text-steel">Every team is origin-labeled; EVs and natures are never inferred.</p>
      </section>
    </div>
  );
}
