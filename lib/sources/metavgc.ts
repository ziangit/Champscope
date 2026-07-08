import { toID } from "../showdown/id";
import { queuedText } from "../showdown/queue";
import type { PokemonReveal } from "../scout/types";
import { storeImportedTeams, type BulkStoreStats, type ImportedTeam } from "./store";

/**
 * MetaVGC featured-tournament pages (community majors like Victory Road's
 * Champions Arena) embed the full team list server-side in the Next.js
 * flight payload: player, placement, and complete sets incl. EV spreads.
 * Shape verified live 2026-07-07 against /teams/featured/champions-arena-ii.
 */

export interface MetavgcEvent {
  /** metavgc.com/teams/featured/<slug> */
  slug: string;
  formatId: string;
  event: string;
  /** ISO date the event ended (becomes first/last seen). */
  date: string;
}

/** Community M-B majors with published open team lists. New events = new rows. */
export const METAVGC_EVENTS: MetavgcEvent[] = [
  {
    slug: "champions-arena-ii",
    formatId: "gen9championsvgc2026regmb",
    event: "The Champions Arena II (Victory Road)",
    date: "2026-07-05",
  },
];

interface MetavgcMon {
  name: string;
  item: string;
  ability: string;
  teraType: string;
  moves: string[];
  nature: string;
  evs: Record<"hp" | "atk" | "def" | "spa" | "spd" | "spe", number>;
}

interface MetavgcTeam {
  placement: string;
  player: string;
  pokemon: MetavgcMon[];
}

/** "Charizard Mega Y" -> "Charizard-Mega-Y"; "Basculegion-M" -> "Basculegion" (male base). */
export function normalizeMetavgcSpecies(name: string): string {
  let s = name.trim();
  const mega = s.match(/^(.*\S)\s+Mega(?:\s+([XY]))?$/);
  if (mega) s = `${mega[1]}-Mega${mega[2] ? `-${mega[2]}` : ""}`;
  if (s.endsWith("-M")) s = s.slice(0, -2);
  return s;
}

const EV_ORDER = ["hp", "atk", "def", "spa", "spd", "spe"] as const;

function toReveal(mon: MetavgcMon): PokemonReveal {
  const species = normalizeMetavgcSpecies(mon.name);
  const reveal: PokemonReveal = {
    speciesId: toID(species),
    species,
    item: mon.item || undefined,
    ability: mon.ability || undefined,
    nature: mon.nature || undefined,
    teraType: mon.teraType || undefined,
    evs: mon.evs ? EV_ORDER.map((k) => mon.evs[k] || "").join(",") : undefined,
    moves: [],
    source: "sheet",
    fieldSources: {},
  };
  if (reveal.item) reveal.fieldSources.item = "sheet";
  if (reveal.ability) reveal.fieldSources.ability = "sheet";
  if (reveal.teraType) reveal.fieldSources.teraType = "sheet";
  for (const move of mon.moves ?? []) {
    if (move && !reveal.moves.some((m) => toID(m) === toID(move))) {
      reveal.moves.push(move);
      reveal.fieldSources[`move:${toID(move)}`] = "sheet";
    }
  }
  return reveal;
}

/** Extract the `initialTeams` array from a Next.js flight payload. */
export function parseFeaturedTeams(html: string): MetavgcTeam[] {
  const chunks = [...html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)].map((m) => m[1]);
  const blob = chunks.map((c) => JSON.parse(`"${c}"`) as string).join("");
  const start = blob.indexOf('"initialTeams":[');
  if (start < 0) throw new Error("metavgc: initialTeams not found — page layout changed?");
  let depth = 0;
  let end = -1;
  for (let i = start + '"initialTeams":'.length; i < blob.length; i++) {
    if (blob[i] === "[") depth++;
    else if (blob[i] === "]") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) throw new Error("metavgc: initialTeams not terminated");
  return JSON.parse(blob.slice(start + '"initialTeams":'.length, end)) as MetavgcTeam[];
}

/** Fetch one featured event and store its teams (idempotent per source key). */
export async function ingestMetavgcEvent(ev: MetavgcEvent): Promise<BulkStoreStats> {
  const html = await queuedText(`https://metavgc.com/teams/featured/${ev.slug}`, {
    headers: { Accept: "text/html" },
  });
  const parsed = parseFeaturedTeams(html);
  const sharedAt = Math.floor(Date.parse(ev.date) / 1000);
  const teams: ImportedTeam[] = [];
  for (const t of parsed) {
    const userId = toID(t.player);
    if (!userId || !Array.isArray(t.pokemon) || t.pokemon.length === 0) continue;
    teams.push({
      formatId: ev.formatId,
      origin: "tournament",
      userId,
      displayName: t.player,
      roster: t.pokemon.map(toReveal),
      source: {
        key: `metavgc:${ev.slug}:${userId}`,
        url: `https://metavgc.com/teams/featured/${ev.slug}`,
        provider: "MetaVGC",
        kind: "tournament",
        event: ev.event,
        placing: Number(t.placement) || undefined,
        sharedAt,
      },
    });
  }
  return await storeImportedTeams(teams);
}
