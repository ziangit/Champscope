import Link from "next/link";
import { TeamCard } from "@/components/TeamCard";
import { SetupNotice } from "@/components/SetupNotice";
import { dbConfigured, listFormats, teamsForPlayer } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function PlayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ format?: string; scouted?: string }>;
}) {
  const { userId } = await params;
  const { format, scouted } = await searchParams;
  if (!dbConfigured()) return <SetupNotice />;

  const [formats, teams] = await Promise.all([listFormats(), teamsForPlayer(userId, format)]);
  const displayName = teams[0]?.merged_reveals.displayName ?? userId;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline gap-4">
        <h1 className="font-display text-3xl font-bold uppercase tracking-wide">{displayName}</h1>
        <span className="font-mono text-sm text-steel">{userId}</span>
        <nav className="flex gap-3 text-sm">
          {formats.map((f) => (
            <Link
              key={f.id}
              href={`/player/${userId}?format=${f.id}`}
              className={f.id === format ? "font-semibold text-accent" : "text-steel hover:text-ink"}
            >
              {f.display_name}
            </Link>
          ))}
        </nav>
      </div>

      {scouted && (
        <p className="rounded border border-win/40 bg-win/5 px-3 py-2 text-sm text-win">
          Scout finished. {teams.length === 0 ? "No public replays found for this player — recorded, not an error." : `${teams.length} team${teams.length === 1 ? "" : "s"} on file.`}
        </p>
      )}

      {teams.length === 0 && !scouted && (
        <div className="rounded border border-line bg-card p-6 text-sm text-steel">
          <p>
            Nothing on file for <span className="font-mono">{userId}</span>
            {format ? " in this format" : ""}. Run a{" "}
            <Link href="/scout" className="underline hover:text-ink">
              scout
            </Link>{" "}
            to search their public replays.
          </p>
        </div>
      )}

      {teams.map((row) => (
        <TeamCard key={row.id} row={row} />
      ))}
    </div>
  );
}
