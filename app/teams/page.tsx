import { TeamCard } from "@/components/TeamCard";
import { SetupNotice } from "@/components/SetupNotice";
import Link from "next/link";
import { browseTeams, dbConfigured, listFormats, type TeamOrigin } from "@/lib/queries";
import { toID } from "@/lib/showdown/id";

export const dynamic = "force-dynamic";

/** Chip filters: ladder/unrated split replay-origin teams by whether any of
 * their games were rated (an unrated game is not ladder evidence). */
const CHIPS = [
  { value: "", label: "All" },
  { value: "ladder", label: "Ladder" },
  { value: "unrated", label: "Unrated" },
  { value: "paste", label: "Pastes" },
  { value: "tournament", label: "Tournament" },
] as const;
type Chip = (typeof CHIPS)[number]["value"];

export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ format?: string; species?: string; origin?: string }>;
}) {
  const { format, species, origin } = await searchParams;
  if (!dbConfigured()) return <SetupNotice />;

  const formats = await listFormats();
  const formatId = format ?? formats.find((f) => f.active)?.id;
  const chip: Chip = CHIPS.some((c) => c.value === origin) ? (origin as Chip) : "";
  const originFilter: TeamOrigin | undefined =
    chip === "ladder" || chip === "unrated" ? "replay" : chip === "paste" ? "paste" : chip === "tournament" ? "tournament" : undefined;
  let teams = await browseTeams({ formatId, species: species ? toID(species) : undefined, origin: originFilter });
  if (chip === "ladder") teams = teams.filter((t) => (t.merged_reveals.replays ?? []).some((r) => r.rating !== null));
  if (chip === "unrated") teams = teams.filter((t) => !(t.merged_reveals.replays ?? []).some((r) => r.rating !== null));

  const chipHref = (value: Chip) => {
    const q = new URLSearchParams();
    if (formatId) q.set("format", formatId);
    if (species) q.set("species", species);
    if (value) q.set("origin", value);
    return `/teams?${q.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase tracking-wide">Known teams</h1>
          <p className="mt-1 text-sm text-steel">
            Every team the scouter and watcher have filed{formatId ? ` in ${formats.find((f) => f.id === formatId)?.display_name ?? formatId}` : ""}.
          </p>
        </div>
        <form method="get" className="flex items-end gap-2">
          {formatId && <input type="hidden" name="format" value={formatId} />}
          <label className="block text-sm">
            <span className="font-display font-semibold uppercase tracking-wide text-steel">Has species</span>
            <input
              name="species"
              defaultValue={species ?? ""}
              placeholder="e.g. Basculegion"
              className="mt-1 block rounded border border-line bg-card px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-accent"
            />
          </label>
          <button type="submit" className="rounded border border-line bg-card px-3 py-1.5 text-sm text-steel hover:text-ink">
            Filter
          </button>
        </form>
        <div className="flex w-full flex-wrap gap-2">
          {CHIPS.map((c) => (
            <Link
              key={c.value}
              href={chipHref(c.value)}
              className={
                c.value === chip
                  ? "rounded-full bg-accent px-3 py-1 font-display text-xs font-semibold uppercase tracking-wide text-white"
                  : "rounded-full border border-line bg-card px-3 py-1 font-display text-xs font-semibold uppercase tracking-wide text-steel hover:border-steel hover:text-ink"
              }
            >
              {c.label}
            </Link>
          ))}
        </div>
      </div>

      {teams.length === 0 && (
        <div className="rounded border border-line bg-card p-6 text-sm text-steel">
          {species ? (
            <p>No scouted team includes “{species}”. Species match uses the base forme id (e.g. “rotomwash”).</p>
          ) : (
            <p>No teams on file yet — run a scout or wait for the ladder watcher.</p>
          )}
        </div>
      )}

      {teams.map((row) => (
        <TeamCard key={row.id} row={row} showOwner />
      ))}
    </div>
  );
}
