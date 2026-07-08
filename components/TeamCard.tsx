/* eslint-disable @next/next/no-img-element -- sprites are hotlinked from Showdown by design */
import Link from "next/link";
import { exportTeam, statsLine } from "@/lib/scout/export";
import { modal, type MergedMon, type TeamSourceRef } from "@/lib/scout/merge";
import type { TeamProfileRow } from "@/lib/queries";
import { iconStyle, replayUrl, spriteUrl } from "@/lib/sprites";
import { CopyButton } from "./CopyButton";

function pct(n: number, total: number) {
  return total === 0 ? "—" : `${Math.round((n / total) * 100)}%`;
}

function sourceMark(source: string) {
  return source === "sheet" ? "●" : "○";
}

/** One mon rendered Pokepaste-style: header line, Ability line, move lines. */
function MonSummary({ mon }: { mon: MergedMon }) {
  const item = modal(mon.items);
  const ability = modal(mon.abilities);
  const moves = Object.values(mon.moves).sort((a, b) => b.count - a.count);
  const set = moves.slice(0, 4);
  // A player who changes sets leaves >4 distinct moves — the 4 most-used form
  // the likely current set, the rest are kept visible below.
  const alsoSeen = moves.slice(4);
  return (
    // Annotations (sprites, provenance marks, counts, nicknames, extras) are
    // select-none so drag-selecting a card copies clean, importable set text.
    <div className="flex gap-3 border-t border-line py-3 first:border-t-0">
      <img src={spriteUrl(mon.species)} alt="" width={48} height={48} className="h-12 w-12 shrink-0 select-none [image-rendering:pixelated]" />
      <div className="min-w-0 font-mono text-sm leading-6">
        <div className="font-semibold">
          {mon.species}
          {mon.nicknames.length > 0 && <span className="select-none font-normal text-steel"> “{mon.nicknames.join("”, “")}”</span>}
          {item && (
            <span className="font-normal" title={`Item — ${item.source === "sheet" ? "from team sheet" : "revealed in battle"} (seen ${item.count}×)`}>
              {" "}@ {item.name}
              {Object.keys(mon.items).length > 1 && <span className="select-none text-steel"> (+{Object.keys(mon.items).length - 1})</span>}
            </span>
          )}
          {alsoSeen.length > 0 && (
            <span className="ml-2 select-none rounded bg-accent/10 px-1 font-mono text-[10px] uppercase text-accent" title="More than 4 distinct moves seen — this player runs set variations">
              variants
            </span>
          )}
        </div>
        {ability && (
          <div title={`Ability — ${ability.source === "sheet" ? "from team sheet" : "revealed in battle"} (seen ${ability.count}×)`}>
            Ability: {ability.name} <span className="select-none text-steel">{sourceMark(ability.source)}</span>
          </div>
        )}
        {mon.evs && statsLine(mon.evs, 0) && (
          <div title="EVs — from the published team sheet, never inferred">
            EVs: {statsLine(mon.evs, 0)} <span className="select-none text-steel">●</span>
          </div>
        )}
        {mon.nature && (
          <div title="Nature — from the published team sheet, never inferred">
            {mon.nature} Nature <span className="select-none text-steel">●</span>
          </div>
        )}
        {mon.ivs && statsLine(mon.ivs, 31) && (
          <div title="IVs — from the published team sheet, never inferred">
            IVs: {statsLine(mon.ivs, 31)} <span className="select-none text-steel">●</span>
          </div>
        )}
        {set.map((m) => (
          <div key={m.name} title={`${m.source === "sheet" ? "From team sheet" : "Revealed in battle"} — seen ${m.count}×`}>
            - {m.name} <span className="select-none text-steel">{sourceMark(m.source)} {m.count}×</span>
          </div>
        ))}
        {alsoSeen.length > 0 && (
          <div className="select-none text-xs text-steel">
            also seen:{" "}
            {alsoSeen.map((m, i) => (
              <span key={m.name} title={`${m.source === "sheet" ? "From team sheet" : "Revealed in battle"} — seen ${m.count}×`}>
                {i > 0 && ", "}
                {m.name} {m.count}×
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const ORIGIN_TITLE = {
  replay: "Observed in rated public ladder replays",
  unrated: "Observed only in unrated public replays (challenge/tour games, not ladder)",
  paste: "Imported from a shared paste — sets are as published, not battle-observed",
  tournament: "Imported from an officially published open team sheet",
} as const;

/** Badge text + color (matching the filter chips): the named provider when
 * there is one, otherwise the origin. Replay teams whose games were all
 * unrated are not ladder evidence. */
function originBadge(origin: "replay" | "paste" | "tournament", sources: TeamSourceRef[], hasRated: boolean): { label: string; title: string; className: string } {
  if (origin === "replay") {
    return hasRated
      ? { label: "ladder", title: ORIGIN_TITLE.replay, className: "bg-accent/10 text-accent" }
      : { label: "unrated", title: ORIGIN_TITLE.unrated, className: "bg-amber-600/10 text-amber-700" };
  }
  if (origin === "tournament") return { label: "official tournament", title: ORIGIN_TITLE.tournament, className: "bg-violet-600/10 text-violet-700" };
  return { label: sources[0]?.provider ?? "community paste", title: ORIGIN_TITLE.paste, className: "bg-emerald-600/10 text-emerald-700" };
}

function SourceRow({ source }: { source: TeamSourceRef }) {
  const record = source.record ? `${source.record.wins}-${source.record.losses}${source.record.ties ? `-${source.record.ties}` : ""}` : null;
  return (
    <tr className="border-t border-line first:border-t-0">
      <td className="py-0.5">
        <a href={source.url} target="_blank" rel="noreferrer" className="underline hover:text-accent">
          {source.provider ?? (source.kind === "paste" ? "paste" : "tournament sheet")}
        </a>
        {(source.event || source.creator) && <span className="text-steel"> — {source.event ?? `by ${source.creator}`}</span>}
        {source.link && (
          <a href={source.link} target="_blank" rel="noreferrer" className="ml-1 text-steel underline hover:text-ink" title="Where the team was originally shared">
            ↗
          </a>
        )}
      </td>
      <td className="py-0.5 text-right text-steel">
        {source.placing != null && `#${source.placing}`}
        {record && ` (${record})`}
        {source.rentalCode && (
          <span className="ml-1 rounded bg-accent/10 px-1 text-accent" title="Enter this replica (rental) code in Pokémon Champions to copy the team in-game">
            replica {source.rentalCode}
          </span>
        )}
      </td>
      <td className="w-24 py-0.5 text-right text-steel">{source.sharedAt ? new Date(source.sharedAt * 1000).toISOString().slice(0, 10) : ""}</td>
    </tr>
  );
}

export function TeamCard({ row, showOwner = false, defaultOpen = false }: { row: TeamProfileRow; showOwner?: boolean; defaultOpen?: boolean }) {
  const m = row.merged_reveals;
  const mons = Object.values(m.mons);
  const games = row.wins + row.losses + m.ties;
  const origin = row.origin ?? "replay";
  const sources = row.sources ?? [];
  const hasRated = (m.replays ?? []).some((r) => r.rating !== null);
  const leadPairs = Object.entries(row.lead_pairs).sort((a, b) => b[1] - a[1]);
  const brings = Object.entries(row.brings).sort((a, b) => b[1] - a[1]);
  const megas = Object.entries(m.megaSlot ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <details data-team-card open={defaultOpen} className="group rounded border border-line bg-card">
      <summary className="flex cursor-pointer select-none list-none flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-transparent px-4 py-2 group-open:border-line [&::-webkit-details-marker]:hidden">
        <span className="self-center font-mono text-xs text-steel transition-transform group-open:rotate-90">▶</span>
        <span className="flex shrink-0 items-center self-center" title={row.roster.join(", ")}>
          {row.roster.map((id) => (
            <span key={id} style={iconStyle(id)} className="-mx-1 inline-block h-[30px] w-[40px]" />
          ))}
        </span>
        {showOwner && (
          <Link href={`/player/${row.user_id}?format=${row.format_id}`} className="font-display text-lg font-semibold uppercase tracking-wide hover:text-accent">
            {m.displayName || row.user_id}
          </Link>
        )}
        <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${originBadge(origin, sources, hasRated).className}`} title={originBadge(origin, sources, hasRated).title}>
          {originBadge(origin, sources, hasRated).label}
        </span>
        {origin !== "replay" && (
          <span className="max-w-56 truncate font-display text-sm font-semibold uppercase tracking-wide" title={sources.find((s) => s.event)?.event ?? sources[0]?.creator}>
            {sources.find((s) => s.event)?.event ?? sources[0]?.creator ?? ""}
          </span>
        )}
        <span className="font-mono text-xs text-steel" title="Team fingerprint: SHA-1 of the sorted base-forme species ids">
          sheet {row.fingerprint.slice(0, 8)}
        </span>
        {(origin === "replay" || games > 0) && (
          <span className="text-sm">
            <span className="text-win">{row.wins}W</span>–<span className="text-loss">{row.losses}L</span>
            {m.ties > 0 && <span className="text-steel">–{m.ties}T</span>}
            <span className="ml-1 text-steel">({games} games)</span>
          </span>
        )}
        <span className="text-xs text-steel">
          {new Date(row.first_seen).toISOString().slice(0, 10)} → {new Date(row.last_seen).toISOString().slice(0, 10)}
        </span>
      </summary>

      <div className="grid gap-x-6 md:grid-cols-2">
        <div className="px-4 py-2">
          <div className="flex select-none items-center justify-between border-b border-line pb-2 pt-1">
            <span className="font-display text-xs font-semibold uppercase tracking-wide text-steel">Sets</span>
            <CopyButton text={exportTeam(mons)} />
          </div>
          {mons.map((mon) => (
            <MonSummary key={mon.speciesId} mon={mon} />
          ))}
        </div>

        <div className="space-y-4 px-4 py-3 text-sm md:border-l md:border-line">
          {sources.length > 0 && (
            <div>
              <h3 className="font-display font-semibold uppercase tracking-wide text-steel">Sources</h3>
              <table className="mt-1 w-full font-mono text-xs">
                <tbody>
                  {[...sources]
                    .sort((a, b) => (b.sharedAt ?? 0) - (a.sharedAt ?? 0))
                    .map((s) => (
                      <SourceRow key={s.key} source={s} />
                    ))}
                </tbody>
              </table>
            </div>
          )}
          {origin !== "replay" ? (
            <p className="text-xs text-steel">● published set — EVs/natures appear only when the source includes them.</p>
          ) : (
            <>
          <div>
            <h3 className="font-display font-semibold uppercase tracking-wide text-steel">Lead pairs</h3>
            <table className="mt-1 w-full">
              <tbody>
                {leadPairs.slice(0, 5).map(([pair, count]) => (
                  <tr key={pair} className="border-t border-line first:border-t-0">
                    <td className="py-0.5">{pair.split("+").join(" + ")}</td>
                    <td className="w-16 text-right font-mono text-xs text-steel">
                      {count}× ({pct(count, games)})
                    </td>
                  </tr>
                ))}
                {leadPairs.length === 0 && <tr><td className="py-0.5 text-steel">No lead data yet.</td></tr>}
              </tbody>
            </table>
          </div>

          <div>
            <h3 className="font-display font-semibold uppercase tracking-wide text-steel">Brings (4 of 6)</h3>
            <table className="mt-1 w-full">
              <tbody>
                {brings.slice(0, 5).map(([combo, count]) => (
                  <tr key={combo} className="border-t border-line first:border-t-0">
                    <td className="py-0.5 text-xs">{combo.split("+").join(", ")}</td>
                    <td className="w-16 text-right font-mono text-xs text-steel">{count}×</td>
                  </tr>
                ))}
                {brings.length === 0 && <tr><td className="py-0.5 text-steel">No bring data yet.</td></tr>}
              </tbody>
            </table>
          </div>

          {megas.length > 0 && (
            <div>
              <h3 className="font-display font-semibold uppercase tracking-wide text-steel">Mega slot</h3>
              <p className="mt-1">
                {megas.map(([id, count]) => `${id} ${count}× (${pct(count, games)})`).join(" · ")}
              </p>
            </div>
          )}

          <div>
            <h3 className="font-display font-semibold uppercase tracking-wide text-steel">Replays</h3>
            <table className="mt-1 w-full font-mono text-xs">
              <tbody>
                {[...m.replays]
                  .sort((a, b) => b.uploadTime - a.uploadTime)
                  .map((r) => (
                    <tr key={r.id} className="border-t border-line first:border-t-0">
                      <td className="py-0.5">
                        <a href={replayUrl(r.id)} target="_blank" rel="noreferrer" className="text-steel underline hover:text-ink">
                          {r.id.split("-").pop()}
                        </a>
                      </td>
                      <td className="py-0.5 text-right text-steel">{new Date(r.uploadTime * 1000).toISOString().slice(0, 10)}</td>
                      <td className="w-24 py-0.5 text-right" title={r.rating === null ? "Unrated game" : "Ladder rating when the replay was saved"}>
                        {r.rating === null ? <span className="text-steel">unrated</span> : `Rating: ${r.rating}`}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-steel">● from open team sheet &nbsp; ○ revealed in battle</p>
            </>
          )}
        </div>
      </div>
    </details>
  );
}
