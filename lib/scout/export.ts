import { modal, type MergedMon } from "./merge";

/**
 * Showdown teambuilder export text for a merged mon. Confirmed fields only —
 * unknown lines are omitted (the import format accepts partial sets), and
 * EVs/natures appear only when a team sheet provided them. Output must
 * round-trip through Showdown's teambuilder import.
 */

const STAT_NAMES = ["HP", "Atk", "Def", "SpA", "SpD", "Spe"] as const;

/** Packed EV/IV string ",,252,,4,252" -> "252 Def / 4 SpD / 252 Spe". */
function statsLine(packed: string, defaultVal: number): string | null {
  const vals = packed.split(",").map((s) => (s === "" ? defaultVal : Number(s)));
  const parts = vals
    .map((v, i) => (v !== defaultVal ? `${v} ${STAT_NAMES[i]}` : null))
    .filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : null;
}

export function exportMon(mon: MergedMon): string {
  const lines: string[] = [];
  const item = modal(mon.items);
  lines.push(item ? `${mon.species} @ ${item.name}` : mon.species);
  const ability = modal(mon.abilities);
  if (ability) lines.push(`Ability: ${ability.name}`);
  const tera = modal(mon.teraTypes);
  if (tera) lines.push(`Tera Type: ${tera.name}`);
  if (mon.evs) {
    const evs = statsLine(mon.evs, 0);
    if (evs) lines.push(`EVs: ${evs}`);
  }
  if (mon.nature) lines.push(`${mon.nature} Nature`);
  if (mon.ivs) {
    const ivs = statsLine(mon.ivs, 31);
    if (ivs) lines.push(`IVs: ${ivs}`);
  }
  // Most-used first, capped at 4 so the export round-trips the teambuilder
  // import. Set variations (5th+ distinct move) stay visible in the UI.
  const moves = Object.values(mon.moves).sort((a, b) => b.count - a.count);
  for (const move of moves.slice(0, 4)) lines.push(`- ${move.name}`);
  return lines.join("\n");
}

export function exportTeam(mons: MergedMon[]): string {
  return mons.map(exportMon).join("\n\n");
}
