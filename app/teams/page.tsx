import { TeamCard } from "@/components/TeamCard";
import { SetupNotice } from "@/components/SetupNotice";
import Link from "next/link";
import { ExpandAllTeams } from "@/components/ExpandAllTeams";
import { chipValue, OriginChips } from "@/components/OriginChips";
import { clampPage, Pager } from "@/components/Pager";
import { browseTeams, dbConfigured, listFormats, teamChipCounts } from "@/lib/queries";
import { toID } from "@/lib/showdown/id";

export const dynamic = "force-dynamic";

const PER_PAGE = 10;

export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ format?: string; species?: string; origin?: string; page?: string }>;
}) {
  const { format, species, origin, page: pageRaw } = await searchParams;
  if (!dbConfigured()) return <SetupNotice />;

  const formats = await listFormats();
  const formatId = format ?? formats.find((f) => f.active)?.id;
  const chip = chipValue(origin);
  const speciesId = species ? toID(species) : undefined;
  // Counts and pagination are DB-side over the whole format — the chips show
  // honest totals and every page is one PER_PAGE fetch.
  const counts = formatId ? await teamChipCounts(formatId, speciesId) : { total: 0, ladder: 0, unrated: 0, paste: 0, tournament: 0 };
  const chipTotal = chip === "" ? counts.total : counts[chip];
  const pages = Math.ceil(chipTotal / PER_PAGE);
  const page = clampPage(pageRaw, pages);
  const { rows: teams } = await browseTeams({ formatId, species: speciesId, chip, page, perPage: PER_PAGE });
  const chipCounts = { "": counts.total, ladder: counts.ladder, unrated: counts.unrated, paste: counts.paste, tournament: counts.tournament };
  const pagerParams = { format: formatId, species, origin: chip || undefined };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        {/* Row 1: title on the left, species filter bottom-aligned on the right. */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold uppercase tracking-wide">Known teams</h1>
            <p className="mt-1 text-sm text-steel">
              Every team the scouter and watcher have filed{formatId ? ` in ${formats.find((f) => f.id === formatId)?.display_name ?? formatId}` : ""}.
            </p>
          </div>
          <form method="get" className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="format-filter">
              Format
            </label>
            <select
              id="format-filter"
              name="format"
              defaultValue={formatId}
              className="block rounded border border-line bg-card px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-accent"
            >
              {formats.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.display_name}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor="species-filter">
              Has species
            </label>
            <input
              id="species-filter"
              name="species"
              defaultValue={species ?? ""}
              placeholder="Has species, e.g. Basculegion"
              className="block w-56 rounded border border-line bg-card px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-accent"
            />
            <button type="submit" className="rounded border border-line bg-card px-3 py-1.5 text-sm text-steel hover:text-ink">
              Filter
            </button>
            <Link
              href={formatId ? `/teams?format=${formatId}` : "/teams"}
              className="rounded border border-line bg-card px-3 py-1.5 text-sm text-steel hover:border-accent hover:text-accent"
              title="Clear species, origin and page filters"
            >
              Reset
            </Link>
          </form>
        </div>
        {/* Row 2: chips and expand controls share one vertically-centered line. */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <OriginChips path="/teams" params={{ format: formatId, species }} current={chip} counts={chipCounts} />
          <ExpandAllTeams />
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

      <Pager page={page} pages={pages} param="page" path="/teams" params={pagerParams} />
    </div>
  );
}
