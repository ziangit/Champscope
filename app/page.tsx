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
    href: "/watch",
    title: "Watch",
    body: "The ladder watcher's daily digest: top-50 snapshots, new finds, and alt suggestions.",
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
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {PAGES.map((p) => (
          <Link key={p.href} href={p.href} className="rounded border border-line bg-card p-4 hover:border-steel">
            <h2 className="font-display text-xl font-semibold uppercase tracking-wide">{p.title}</h2>
            <p className="mt-1 text-sm text-steel">{p.body}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
