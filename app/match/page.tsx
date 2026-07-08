/* eslint-disable @next/next/no-img-element -- sprites are hotlinked from Showdown by design */
import Link from "next/link";
import { ScreenshotInput } from "@/components/ScreenshotInput";
import { SetupNotice } from "@/components/SetupNotice";
import { TeamCard } from "@/components/TeamCard";
import { matchTeams, parsePreviewSpecies } from "@/lib/match";
import { dbConfigured, listFormats, type TeamProfileRow } from "@/lib/queries";
import { spriteUrl } from "@/lib/sprites";

export const dynamic = "force-dynamic";

const EXACT_PER_PAGE = 3;
const PARTIAL_PER_PAGE = 5;

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

/** Prev/next pager preserving the whole query string. */
function Pager({ page, pages, param, params }: { page: number; pages: number; param: string; params: Record<string, string | undefined> }) {
  if (pages <= 1) return null;
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    q.set(param, String(p));
    return `/match?${q.toString()}`;
  };
  return (
    <div className="flex items-center gap-3 text-sm">
      {page > 1 ? (
        <Link href={href(page - 1)} className="rounded border border-line bg-card px-3 py-1 text-steel hover:text-ink">
          ← Prev
        </Link>
      ) : (
        <span className="rounded border border-line px-3 py-1 text-steel/40">← Prev</span>
      )}
      <span className="font-mono text-xs text-steel">
        page {page} / {pages}
      </span>
      {page < pages ? (
        <Link href={href(page + 1)} className="rounded border border-line bg-card px-3 py-1 text-steel hover:text-ink">
          Next →
        </Link>
      ) : (
        <span className="rounded border border-line px-3 py-1 text-steel/40">Next →</span>
      )}
    </div>
  );
}

const clampPage = (raw: string | undefined, pages: number) => Math.min(Math.max(1, Number(raw) || 1), Math.max(1, pages));

export default async function MatchPage({
  searchParams,
}: {
  searchParams: Promise<{ format?: string; species?: string; epage?: string; ppage?: string }>;
}) {
  const { format, species, epage, ppage } = await searchParams;
  if (!dbConfigured()) return <SetupNotice />;

  const formats = await listFormats();
  const formatId = format ?? formats.find((f) => f.active)?.id;
  const names = parsePreviewSpecies(species ?? "");
  const result = formatId && names.length > 0 ? await matchTeams(formatId, names) : null;

  const exactPages = result ? Math.ceil(result.exact.length / EXACT_PER_PAGE) : 0;
  const partialPages = result ? Math.ceil(result.partial.length / PARTIAL_PER_PAGE) : 0;
  const exactPage = clampPage(epage, exactPages);
  const partialPage = clampPage(ppage, partialPages);
  const pagerParams = { format: formatId, species, epage, ppage };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold uppercase tracking-wide">Match a preview</h1>
        <p className="mt-1 text-sm text-steel">
          Paste a team — a pokepaste/teambuilder export or just species names. Exact rosters first, then anything
          sharing 4+ of the same Pokémon. An exact match under a different name is only ever a suggestion of an alt.
        </p>
      </div>

      {/* Results at first glance: what was matched and what was found. */}
      {result && (
        <section className="rounded border border-line bg-card px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex items-center gap-1">
              {result.queryNames.map((name) => (
                <img key={name} src={spriteUrl(name)} alt={name} title={name} width={48} height={48} className="h-12 w-12 [image-rendering:pixelated]" />
              ))}
            </div>
            <a href="#exact" className="font-display text-lg font-bold uppercase tracking-wide hover:text-accent">
              {result.exact.length} exact
            </a>
            <a href="#partial" className="font-display text-lg font-bold uppercase tracking-wide hover:text-accent">
              {result.partial.length} partial
            </a>
            {result.exact.some((r) => r.origin === "tournament") || result.partial.some((p) => p.profile.origin === "tournament") ? (
              <span className="rounded bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] uppercase text-accent">official tournament teams first</span>
            ) : null}
          </div>
          <p className="mt-1 font-mono text-xs text-steel">
            matching on: {result.queryIds.join(", ")}
            {result.queryIds.length < 4 && " — enter at least 4 species for useful partial matches"}
          </p>
        </section>
      )}

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
        <label className="block w-full text-sm">
          <span className="font-display font-semibold uppercase tracking-wide text-steel">Team — pokepaste export, species names, or a screenshot</span>
          <textarea
            id="match-species-input"
            name="species"
            defaultValue={species ?? ""}
            rows={result ? 3 : 6}
            placeholder={"Charizard @ Charizardite Y\nAbility: Blaze\n- Heat Wave\n...\n\n— or —  Charizard, Basculegion, Kingambit, Sylveon, Rillaboom, Farigiraf"}
            className="mt-1 block w-full rounded border border-line bg-card px-3 py-1.5 font-mono text-sm focus-visible:outline-2 focus-visible:outline-accent"
          />
        </label>
        <ScreenshotInput textareaId="match-species-input" />
        <button type="submit" className="rounded bg-accent px-4 py-1.5 font-display font-semibold uppercase tracking-wide text-white hover:opacity-90">
          Match
        </button>
      </form>

      {result && (
        <>
          <section id="exact" className="space-y-4">
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
            {result.exact.slice((exactPage - 1) * EXACT_PER_PAGE, exactPage * EXACT_PER_PAGE).map((row) => (
              <TeamCard key={row.id} row={row} showOwner />
            ))}
            <Pager page={exactPage} pages={exactPages} param="epage" params={pagerParams} />
          </section>

          <section id="partial" className="space-y-4">
            <h2 className="font-display text-xl font-bold uppercase tracking-wide">
              Partial (4+ shared) <span className="text-steel">({result.partial.length})</span>
            </h2>
            {result.partial.length === 0 && <p className="text-sm text-steel">Nothing on file shares {Math.min(4, result.queryIds.length)}+ of these species.</p>}
            {result.partial.slice((partialPage - 1) * PARTIAL_PER_PAGE, partialPage * PARTIAL_PER_PAGE).map(({ overlap, profile }) => (
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
            <Pager page={partialPage} pages={partialPages} param="ppage" params={pagerParams} />
          </section>
        </>
      )}
    </div>
  );
}
