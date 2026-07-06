import { toID } from "../showdown/id";
import type { PokemonReveal } from "./types";

/**
 * Set importer: Showdown teambuilder export text -> PokemonReveal[] (the
 * inverse of export.ts). Every imported field is sheet-grade provenance.
 * Unknown lines are skipped; EVs/nature/IVs exist only when the text has
 * them — never fabricated.
 */

const STAT_INDEX: Record<string, number> = { hp: 0, atk: 1, def: 2, spa: 3, spd: 4, spe: 5 };

/** "16 HP / 5 Def / 27 Spe" -> packed "16,,5,,,27" ("" = default, matches export.ts). */
export function packStats(text: string): string | undefined {
  const vals: string[] = ["", "", "", "", "", ""];
  let any = false;
  for (const part of text.split("/")) {
    const m = part.trim().match(/^(\d+)\s+(HP|Atk|Def|SpA|SpD|Spe)$/i);
    if (!m) continue;
    vals[STAT_INDEX[m[2].toLowerCase()]] = m[1];
    any = true;
  }
  return any ? vals.join(",") : undefined;
}

/** First line of a set: "Nickname (Species) (M) @ Item", every piece optional. */
function parseHeader(line: string): Pick<PokemonReveal, "species" | "nickname" | "gender" | "item"> | null {
  let rest = line;
  let item: string | undefined;
  const at = rest.indexOf(" @ ");
  if (at >= 0) {
    item = rest.slice(at + 3).trim() || undefined;
    rest = rest.slice(0, at);
  }
  rest = rest.trim();
  let gender: "M" | "F" | undefined;
  const g = rest.match(/\s+\((M|F)\)$/);
  if (g) {
    gender = g[1] as "M" | "F";
    rest = rest.slice(0, g.index).trim();
  }
  let species = rest;
  let nickname: string | undefined;
  const nick = rest.match(/^(.*\S)\s+\((.+)\)$/);
  if (nick) {
    nickname = nick[1];
    species = nick[2];
  }
  if (!species || !toID(species)) return null;
  return { species, nickname, gender, item };
}

/** Parse one export-text block (one set) into a PokemonReveal, or null if malformed. */
export function parseExportSet(block: string): PokemonReveal | null {
  const lines = block
    .split("\n")
    .map((l) => l.replace(/\s+$/, "")) // pokepaste emits trailing double spaces
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;
  const header = parseHeader(lines[0]);
  if (!header) return null;

  const mon: PokemonReveal = {
    speciesId: toID(header.species),
    species: header.species,
    nickname: header.nickname && header.nickname !== header.species ? header.nickname : undefined,
    gender: header.gender,
    item: header.item,
    moves: [],
    source: "sheet",
    fieldSources: {},
  };
  if (mon.item) mon.fieldSources.item = "sheet";

  for (const raw of lines.slice(1)) {
    const line = raw.trim();
    if (line.startsWith("- ")) {
      const move = line.slice(2).trim();
      // Slash-separated options ("- Protect / Detect") appear in hand-written
      // pastes: keep the first option only, it is the authored pick.
      const name = move.split(" / ")[0].trim();
      if (name && !mon.moves.some((m) => toID(m) === toID(name))) {
        mon.moves.push(name);
        mon.fieldSources[`move:${toID(name)}`] = "sheet";
      }
      continue;
    }
    const kv = line.match(/^([A-Za-z ]+):\s*(.+)$/);
    if (kv) {
      const key = kv[1].trim().toLowerCase();
      const value = kv[2].trim();
      if (key === "ability") {
        mon.ability = value;
        mon.fieldSources.ability = "sheet";
      } else if (key === "tera type") {
        mon.teraType = value;
        mon.fieldSources.teraType = "sheet";
      } else if (key === "evs") mon.evs = packStats(value);
      else if (key === "ivs") mon.ivs = packStats(value);
      else if (key === "level") mon.level = Number(value) || undefined;
      else if (key === "shiny") mon.shiny = value.toLowerCase() === "yes";
      // Happiness / Dynamax Level / Gigantamax etc.: silently ignored.
      continue;
    }
    const nature = line.match(/^(\w+)\s+Nature$/i);
    if (nature) mon.nature = nature[1];
  }
  return mon;
}

/** Parse full export text (blank-line-separated sets) into a roster. */
export function parseExportText(text: string): PokemonReveal[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map(parseExportSet)
    .filter((m): m is PokemonReveal => m !== null);
}

/**
 * pokedata.ovh decklist entry (official RK9 open team sheets), shape verified
 * live 2026-07-06 against the NAIC 2026 decklists response.
 */
export interface PokedataDecklistMon {
  id: string; // national dex number as string
  name: string; // e.g. "Basculegion [Male]", "Tauros [Paldean Form - Aqua Breed]"
  ability: string;
  item: string;
  stat_alignment: string; // nature
  badges: string[]; // the 4 moves
}

/** Bracket contents that mean "this is already the base forme". */
const BASE_FORME_BRACKETS = new Set([
  "male",
  "midday form",
  "family of three",
  "unremarkable form",
  "incarnate forme",
  "amped form",
  "full belly mode",
  "single strike style",
  "teal mask",
  "curly form",
  "east sea",
  "red-striped form",
  "green plumage",
]);

/** Bracket contents whose Showdown suffix the generic rules can't derive. */
const BRACKET_OVERRIDES: Record<string, string> = {
  "family of four": "Four",
  "west sea": "West",
  "blue plumage": "Blue",
  "yellow plumage": "Yellow",
  "white plumage": "White",
};

const REGION_WORDS: Record<string, string> = { hisuian: "Hisui", alolan: "Alola", galarian: "Galar", paldean: "Paldea" };

/**
 * "Species [Forme words]" -> Showdown species name, so imported teams land in
 * the same forme/fingerprint space as replay-parsed ones ("Rotom [Wash Rotom]"
 * -> "Rotom-Wash"). Bracket vocabulary collected from real pokedata responses.
 */
export function normalizePokedataSpecies(name: string): string {
  const m = name.trim().match(/^(.*\S)\s*\[(.+)\]$/);
  if (!m) return name.trim();
  const base = m[1];
  const inner = m[2].trim();
  if (BASE_FORME_BRACKETS.has(inner.toLowerCase())) return base;
  const override = BRACKET_OVERRIDES[inner.toLowerCase()];
  if (override) return `${base}-${override}`;
  if (inner.toLowerCase() === "female") return `${base}-F`;

  // "Wash Rotom" style: bracket repeats the species after the forme word.
  const repeated = inner.match(new RegExp(`^(.+?)\\s+${base}$`, "i"));
  if (repeated) return `${base}-${repeated[1]}`;

  // "Paldean Form - Aqua Breed" -> "Paldea-Aqua"; "Hisuian Form" -> "Hisui";
  // "Rapid Strike Style" -> "Rapid-Strike"; "Eternal Flower" -> "Eternal".
  const suffix = inner
    .split(/\s*-\s*/)
    .map((seg) =>
      seg
        .replace(/\s+(Form|Forme|Style|Mode|Breed|Flower|Face|Mask)$/i, "")
        .trim()
        .split(/\s+/)
        .map((w) => REGION_WORDS[w.toLowerCase()] ?? w)
        .join("-"),
    )
    .filter(Boolean)
    .join("-");
  return suffix ? `${base}-${suffix}` : base;
}

/** Convert one pokedata decklist to a roster of sheet-grade reveals. */
export function pokedataToReveals(decklist: PokedataDecklistMon[]): PokemonReveal[] {
  return decklist.map((mon) => {
    const species = normalizePokedataSpecies(mon.name);
    const reveal: PokemonReveal = {
      speciesId: toID(species),
      species,
      item: mon.item || undefined,
      ability: mon.ability || undefined,
      nature: mon.stat_alignment || undefined,
      moves: [],
      source: "sheet",
      fieldSources: {},
    };
    if (reveal.item) reveal.fieldSources.item = "sheet";
    if (reveal.ability) reveal.fieldSources.ability = "sheet";
    for (const move of mon.badges ?? []) {
      if (move && !reveal.moves.some((mv) => toID(mv) === toID(move))) {
        reveal.moves.push(move);
        reveal.fieldSources[`move:${toID(move)}`] = "sheet";
      }
    }
    return reveal;
  });
}
