import { TeamCard } from "@/components/TeamCard";
import { SetupNotice } from "@/components/SetupNotice";
import { ExpandAllTeams } from "@/components/ExpandAllTeams";
import { chipCounts, chipValue, filterByChip, OriginChips } from "@/components/OriginChips";
import { clampPage, Pager } from "@/components/Pager";
import { browseTeams, dbConfigured, listFormats } from "@/lib/queries";
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
  // Fetch unfiltered so every chip can show its count; the chip filter
  // applies in memory over the same window, and only PER_PAGE cards render
  // (the payload lives in the cards, not the query).
  const allTeams = await browseTeams({ formatId, species: species ? toID(species) : undefined });
  const filtered = filterByChip(allTeams, chip);
  const pages = Math.ceil(filtered.length / PER_PAGE);
  const page = clampPage(pageRaw, pages);
  const teams = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const pagerParams = { format: formatId, species, origin: chip || undefined };

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
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <OriginChips path="/teams" params={{ format: formatId, species }} current={chip} counts={chipCounts(allTeams)} />
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
