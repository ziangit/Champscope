import { toID } from "./showdown/id";

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
  return `https://play.pokemonshowdown.com/sprites/gen5/${spriteId(species)}.png`;
}

export function replayUrl(replayId: string): string {
  return `https://replay.pokemonshowdown.com/${replayId}`;
}
