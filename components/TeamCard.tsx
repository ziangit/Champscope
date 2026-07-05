/* eslint-disable @next/next/no-img-element -- sprites are hotlinked from Showdown by design */
import Link from "next/link";
import { exportTeam } from "@/lib/scout/export";
import { modal, type MergedMon } from "@/lib/scout/merge";
import type { TeamProfileRow } from "@/lib/queries";
import { replayUrl, spriteUrl } from "@/lib/sprites";
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
    <div className="flex gap-3 border-t border-line py-3 first:border-t-0">
      <img src={spriteUrl(mon.species)} alt={mon.species} width={48} height={48} className="h-12 w-12 shrink-0 [image-rendering:pixelated]" />
      <div className="min-w-0 font-mono text-sm leading-6">
        <div className="font-semibold">
          {mon.species}
          {mon.nicknames.length > 0 && <span className="font-normal text-steel"> “{mon.nicknames.join("”, “")}”</span>}
          {item && (
            <span className="font-normal" title={`Item — ${item.source === "sheet" ? "from team sheet" : "revealed in battle"} (seen ${item.count}×)`}>
              {" "}@ {item.name}
              {Object.keys(mon.items).length > 1 && <span className="text-steel"> (+{Object.keys(mon.items).length - 1})</span>}
            </span>
          )}
          {alsoSeen.length > 0 && (
            <span className="ml-2 rounded bg-accent/10 px-1 font-mono text-[10px] uppercase text-accent" title="More than 4 distinct moves seen — this player runs set variations">
              variants
            </span>
          )}
        </div>
        {ability && (
          <div title={`Ability — ${ability.source === "sheet" ? "from team sheet" : "revealed in battle"} (seen ${ability.count}×)`}>
            Ability: {ability.name} <span className="text-steel">{sourceMark(ability.source)}</span>
          </div>
        )}
        {set.map((m) => (
          <div key={m.name} title={`${m.source === "sheet" ? "From team sheet" : "Revealed in battle"} — seen ${m.count}×`}>
            - {m.name} <span className="text-steel">{sourceMark(m.source)} {m.count}×</span>
          </div>
        ))}
        {alsoSeen.length > 0 && (
          <div className="text-xs text-steel">
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

export function TeamCard({ row, showOwner = false }: { row: TeamProfileRow; showOwner?: boolean }) {
  const m = row.merged_reveals;
  const mons = Object.values(m.mons);
  const games = row.wins + row.losses + m.ties;
  const leadPairs = Object.entries(row.lead_pairs).sort((a, b) => b[1] - a[1]);
  const brings = Object.entries(row.brings).sort((a, b) => b[1] - a[1]);
  const megas = Object.entries(m.megaSlot ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <section className="rounded border border-line bg-card">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line px-4 py-2">
        {showOwner && (
          <Link href={`/player/${row.user_id}?format=${row.format_id}`} className="font-display text-lg font-semibold uppercase tracking-wide hover:text-accent">
            {m.displayName || row.user_id}
          </Link>
        )}
        <span className="font-mono text-xs text-steel" title="Team fingerprint: SHA-1 of the sorted base-forme species ids">
          sheet {row.fingerprint.slice(0, 8)}
        </span>
        <span className="text-sm">
          <span className="text-win">{row.wins}W</span>–<span className="text-loss">{row.losses}L</span>
          {m.ties > 0 && <span className="text-steel">–{m.ties}T</span>}
          <span className="ml-1 text-steel">({games} games)</span>
        </span>
        <span className="text-xs text-steel">
          {new Date(row.first_seen).toISOString().slice(0, 10)} → {new Date(row.last_seen).toISOString().slice(0, 10)}
        </span>
        <span className="ml-auto">
          <CopyButton text={exportTeam(mons)} />
        </span>
      </header>

      <div className="grid gap-x-6 md:grid-cols-2">
        <div className="px-4 py-2">
          {mons.map((mon) => (
            <MonSummary key={mon.speciesId} mon={mon} />
          ))}
        </div>

        <div className="space-y-4 px-4 py-3 text-sm md:border-l md:border-line">
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
        </div>
      </div>
    </section>
  );
}
