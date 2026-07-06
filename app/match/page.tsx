import { SetupNotice } from "@/components/SetupNotice";
import { TeamCard } from "@/components/TeamCard";
import { matchTeams } from "@/lib/match";
import { dbConfigured, listFormats, type TeamProfileRow } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** Display names for the profile's roster ids, falling back to the raw id. */
function displayName(row: TeamProfileRow, id: string): string {
  return row.merged_reveals.mons[id]?.species ?? id;
}

function DiffLine({ row, queryIds }: { row: TeamProfileRow; queryIds: string[] }) {
  const roster = new Set(row.roster);
  const missing = queryIds.filter((id) => !roster.has(id));
  const extra = row.roster.filter((id) => !queryIds.includes(id));
  if (missing.length === 0 && extra.length === 0) return null;
  return (
    <p className="font-mono text-xs text-steel">
      {extra.length > 0 && (
        <>
          they run <span className="text-accent">{extra.map((id) => displayName(row, id)).join(", ")}</span>
        </>
      )}
      {extra.length > 0 && missing.length > 0 && " instead of "}
      {missing.length > 0 && <span>{missing.join(", ")}</span>}
    </p>
  );
}

export default async function MatchPage({
  searchParams,
}: {
  searchParams: Promise<{ format?: string; species?: string }>;
}) {
  const { format, species } = await searchParams;
  if (!dbConfigured()) return <SetupNotice />;

  const formats = await listFormats();
  const formatId = format ?? formats.find((f) => f.active)?.id;
  const names = (species ?? "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const result = formatId && names.length > 0 ? await matchTeams(formatId, names) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold uppercase tracking-wide">Match a preview</h1>
        <p className="mt-1 text-sm text-steel">
          Paste the opponent&apos;s team preview — exact rosters first, then anything sharing 4+ of the same Pokémon.
          An exact match under a different name is only ever a suggestion of an alt.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded border border-line bg-card p-4">
        <label className="block text-sm">
          <span className="font-display font-semibold uppercase tracking-wide text-steel">Format</span>
          <select
            name="format"
            defaultValue={formatId}
            className="mt-1 block rounded border border-line bg-card px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-accent"
          >
            {formats.map((f) => (
              <option key={f.id} value={f.id}>
                {f.display_name}
              </option>
            ))}
          </select>
        </label>
        <label className="block grow text-sm">
          <span className="font-display font-semibold uppercase tracking-wide text-steel">Previewed species (up to 6, comma-separated)</span>
          <input
            name="species"
            defaultValue={species ?? ""}
            placeholder="e.g. Charizard, Basculegion, Kingambit, Sylveon, Rillaboom, Farigiraf"
            className="mt-1 block w-full rounded border border-line bg-card px-3 py-1.5 font-mono text-sm focus-visible:outline-2 focus-visible:outline-accent"
          />
        </label>
        <button type="submit" className="rounded bg-accent px-4 py-1.5 font-display font-semibold uppercase tracking-wide text-white hover:opacity-90">
          Match
        </button>
      </form>

      {result && (
        <>
          <p className="font-mono text-xs text-steel">
            matching on: {result.queryIds.join(", ")}
            {result.queryIds.length < 4 && " — enter at least 4 species for useful partial matches"}
          </p>

          <section className="space-y-4">
            <h2 className="font-display text-xl font-bold uppercase tracking-wide">
              Exact roster <span className="text-steel">({result.exact.length})</span>
            </h2>
            {result.queryIds.length < 6 && <p className="text-sm text-steel">Enter all 6 previewed species to check for an exact roster match.</p>}
            {result.queryIds.length === 6 && result.exact.length === 0 && <p className="text-sm text-steel">No stored team has exactly this roster.</p>}
            {result.exact.length > 1 && (
              <p className="rounded border border-line bg-card px-3 py-2 text-sm text-steel">
                {result.exact.length} players have this exact roster on file — possibly alts or a shared/rental team (a suggestion, never asserted).
              </p>
            )}
            {result.exact.map((row) => (
              <TeamCard key={row.id} row={row} showOwner />
            ))}
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-xl font-bold uppercase tracking-wide">
              Partial (4+ shared) <span className="text-steel">({result.partial.length})</span>
            </h2>
            {result.partial.length === 0 && <p className="text-sm text-steel">Nothing on file shares {Math.min(4, result.queryIds.length)}+ of these species.</p>}
            {result.partial.map(({ overlap, profile }) => (
              <div key={profile.id} className="space-y-1">
                <div className="flex items-baseline gap-3">
                  <span className="rounded bg-accent/10 px-2 py-0.5 font-mono text-xs font-semibold text-accent">
                    {overlap}/{result.queryIds.length} shared
                  </span>
                  <DiffLine row={profile} queryIds={result.queryIds} />
                </div>
                <TeamCard row={profile} showOwner />
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
