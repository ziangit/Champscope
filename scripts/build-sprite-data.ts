/**
 * Regenerate the two small sprite-data files the UI uses:
 *  - data/cv/icon-indexes.json  species id -> box-icon sheet index
 *    (CSS background-position team-preview strips on team cards)
 *  - data/cv/sprite-ids.json    species ids that have a gen5 sprite
 *    (spriteUrl falls back to base-forme artwork for the rest)
 *
 * Fetches through the polite queue. Re-run when a new generation/regulation
 * adds species. gen5 probing caches to --cache <dir> so re-runs are local.
 *
 *   npx tsx scripts/build-sprite-data.ts [--cache <dir>] [--indexes-only]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spriteId } from "../lib/sprites";
import { queuedBytes, queuedJSON, queuedText } from "../lib/showdown/queue";

const OUT_DIR = join(__dirname, "..", "data", "cv");
const DEX_DATA_URL = "https://play.pokemonshowdown.com/js/battle-dex-data.js";
const POKEDEX_URL = "https://play.pokemonshowdown.com/data/pokedex.json";
const GEN5_URL = (sid: string) => `https://play.pokemonshowdown.com/sprites/gen5/${sid}.png`;
/** Box-icon sheet geometry (verified 2026-07-06). */
const SHEET_COLS = 12;
const SHEET_SLOTS = 12 * 137;

interface DexEntry {
  num: number;
  name: string;
}

function cacheDir(): string | null {
  const i = process.argv.indexOf("--cache");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

/** BattlePokemonIconIndexes entries look like `pikachubelle:1032+2`. */
function parseIconOverrides(src: string): Map<string, number> {
  const m = src.match(/BattlePokemonIconIndexes\s*=\s*\{([\s\S]*?)\}/);
  if (!m) throw new Error("BattlePokemonIconIndexes not found — client layout changed?");
  const overrides = new Map<string, number>();
  for (const entry of m[1].matchAll(/([a-z0-9]+)\s*:\s*(\d+)(?:\s*\+\s*(\d+))?/g)) {
    overrides.set(entry[1], Number(entry[2]) + Number(entry[3] ?? 0));
  }
  return overrides;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const cache = cacheDir();
  const cached = (name: string) => (cache && existsSync(join(cache, name)) ? join(cache, name) : null);
  const dexPath = cached("battle-dex-data.js");
  const pokedexPath = cached("ps-pokedex.json");
  const dexDataSrc = dexPath ? readFileSync(dexPath, "utf8") : await queuedText(DEX_DATA_URL);
  const pokedex = pokedexPath
    ? (JSON.parse(readFileSync(pokedexPath, "utf8")) as Record<string, DexEntry>)
    : await queuedJSON<Record<string, DexEntry>>(POKEDEX_URL);
  const overrides = parseIconOverrides(dexDataSrc);

  const indexMap: Record<string, number> = {};
  for (const [id, entry] of Object.entries(pokedex)) {
    if (!entry || entry.num <= 0) continue;
    const idx = overrides.get(id) ?? (entry.num <= 1025 ? entry.num : -1);
    if (idx >= 0 && idx < SHEET_SLOTS) indexMap[id] = idx;
  }
  writeFileSync(join(OUT_DIR, "icon-indexes.json"), JSON.stringify(indexMap));
  console.log(`icon-indexes.json: ${Object.keys(indexMap).length} entries`);
  if (process.argv.includes("--indexes-only")) return;

  // Probe which species have gen5 sprites (404s cached as empty files).
  const spriteCache = cache ? join(cache, "gen5") : null;
  if (spriteCache) mkdirSync(spriteCache, { recursive: true });
  const ids: string[] = [];
  let done = 0;
  for (const [id, entry] of Object.entries(pokedex)) {
    if (!entry || entry.num <= 0) continue;
    done++;
    const sid = spriteId(entry.name);
    const cachedFile = spriteCache ? join(spriteCache, `${sid}.png`) : null;
    if (cachedFile && existsSync(cachedFile)) {
      if (readFileSync(cachedFile).length > 0) ids.push(id);
      continue;
    }
    try {
      const bytes = await queuedBytes(GEN5_URL(sid));
      if (cachedFile) writeFileSync(cachedFile, bytes);
      ids.push(id);
    } catch {
      if (cachedFile) writeFileSync(cachedFile, Buffer.alloc(0));
    }
    if (done % 200 === 0) console.log(`gen5 probe: ${done} checked (${ids.length} exist)`);
  }
  writeFileSync(join(OUT_DIR, "sprite-ids.json"), JSON.stringify([...new Set(ids)].sort()));
  console.log(`sprite-ids.json: ${new Set(ids).size} ids`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
