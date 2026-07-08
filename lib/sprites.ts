import type { CSSProperties } from "react";
import gen5 from "@/data/cv/gen5.json";
import iconIndexes from "@/data/cv/icon-indexes.json";
import { BATTLE_FORME_SUFFIX } from "./scout/formes";
import { toID } from "./showdown/id";

/** Species ids that actually have a gen5 sprite on Showdown (derived from the
 * CV template inventory — same fetch source). Champions-exclusive formes
 * (Raichu-Mega-Y, Floette-Mega, …) are absent and fall back to base artwork. */
const KNOWN_SPRITES = new Set((gen5 as { templates: { id: string }[] }).templates.map((t) => t.id));

/**
 * Hotlinked Showdown sprite URLs (we bundle no Pokémon assets).
 * Sprite IDs keep one dash between base species and forme
 * ("rotom-wash", "charizard-megay") — except species whose real name
 * contains the dash.
 */
const DASH_IN_NAME = new Set([
  "hooh",
  "porygonz",
  "jangmoo",
  "hakamoo",
  "kommoo",
  "wochien",
  "chienpao",
  "tinglu",
  "chiyu",
]);

export function spriteId(species: string): string {
  const id = toID(species);
  if (DASH_IN_NAME.has(id)) return id;
  const dash = species.indexOf("-");
  if (dash === -1) return id;
  const base = toID(species.slice(0, dash));
  const forme = toID(species.slice(dash + 1));
  return forme ? `${base}-${forme}` : base;
}

export function spriteUrl(species: string): string {
  let name = species;
  if (!KNOWN_SPRITES.has(toID(name))) {
    const base = name.replace(BATTLE_FORME_SUFFIX, "");
    if (KNOWN_SPRITES.has(toID(base))) name = base;
  }
  return `https://play.pokemonshowdown.com/sprites/gen5/${spriteId(name)}.png`;
}

export function replayUrl(replayId: string): string {
  return `https://replay.pokemonshowdown.com/${replayId}`;
}

/**
 * Box-icon via the official sprite sheet (how Showdown renders team
 * previews): one browser-cached image for every icon on the page, selected
 * by background-position. Index map is emitted by scripts/build-cv-templates.
 */
const ICON_SHEET = "https://play.pokemonshowdown.com/sprites/pokemonicons-sheet.png";
const ICON_MAP = iconIndexes as Record<string, number>;

export function iconStyle(species: string): CSSProperties {
  let id = toID(species);
  if (!(id in ICON_MAP)) {
    const base = toID(species.replace(BATTLE_FORME_SUFFIX, ""));
    if (base in ICON_MAP) id = base;
  }
  const index = ICON_MAP[id] ?? 0;
  return {
    background: `transparent url(${ICON_SHEET}) no-repeat scroll -${(index % 12) * 40}px -${Math.floor(index / 12) * 30}px`,
  };
}
