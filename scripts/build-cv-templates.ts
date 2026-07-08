/**
 * Build the sprite-recognition template data for screenshot matching.
 *
 * Fetches (through the polite queue, one-time):
 *  - play.pokemonshowdown.com/sprites/pokemonicons-sheet.png  (box icons, 12x137 grid of 40x30)
 *  - play.pokemonshowdown.com/js/battle-dex-data.js           (forme icon-index overrides)
 *  - play.pokemonshowdown.com/data/pokedex.json               (species id -> num/name)
 *  - play.pokemonshowdown.com/sprites/gen5/<id>.png           (battle sprites, 96x96; 404 = skip)
 *
 * Emits data/cv/icons.json and data/cv/gen5.json — numeric signatures only
 * (masked color grids), never sprite artwork: the "no bundled Pokémon assets"
 * rule stays intact. Re-run when a new generation/regulation adds species.
 *
 *   npx tsx scripts/build-cv-templates.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { computeSignature, cropToAlpha, opacityFraction, type Template, type TemplateSet } from "../lib/cv/signature";
import { spriteId } from "../lib/sprites";
import { queuedBytes, queuedJSON, queuedText } from "../lib/showdown/queue";

const OUT_DIR = join(__dirname, "..", "data", "cv");
const SHEET_URL = "https://play.pokemonshowdown.com/sprites/pokemonicons-sheet.png";
const DEX_DATA_URL = "https://play.pokemonshowdown.com/js/battle-dex-data.js";
const POKEDEX_URL = "https://play.pokemonshowdown.com/data/pokedex.json";
// Sprite filenames use hyphenated forme ids ("sneasel-hisui"), NOT toID —
// lib/sprites.ts spriteId() is the one existing implementation of that rule.
const SPRITE_SETS: Record<string, { url: (sid: string) => string; minSide: number; frames?: number }> = {
  // Pixel battle sprites (static poses).
  gen5: { url: (sid) => `https://play.pokemonshowdown.com/sprites/gen5/${sid}.png`, minSide: 16 },
  // XY-style animated battle sprites — what the modern client actually
  // renders in team preview headers, side panels and battles; a screenshot
  // captures an arbitrary frame, so several frames per species become
  // templates.
  ani: { url: (sid) => `https://play.pokemonshowdown.com/sprites/ani/${sid}.gif`, minSide: 16, frames: 3 },
  // HOME-style renders (Showdown dex/teambuilder; Pokémon Champions reuses
  // these official renders on its select screens — verified visually 2026-07-06).
  dex: { url: (sid) => `https://play.pokemonshowdown.com/sprites/dex/${sid}.png`, minSide: 24 },
};

const SHEET_COLS = 12;
const ICON_W = 40;
const ICON_H = 30;
/** All templates are bbox-cropped and gridded at GRID x GRID. */
const GRID = 14;
/** The icon sheet is flattened onto this matte color (verified 2026-07-06). */
const MATTE: [number, number, number] = [50, 49, 49];
const MATTE_TOLERANCE = 6;

interface DexEntry {
  num: number;
  name: string;
}

/** BattlePokemonIconIndexes entries look like `pikachubelle:1032+2` or `floetteeternal:1234`. */
function parseIconOverrides(src: string): Map<string, number> {
  const m = src.match(/BattlePokemonIconIndexes\s*=\s*\{([\s\S]*?)\}/);
  if (!m) throw new Error("BattlePokemonIconIndexes not found in battle-dex-data.js — client layout changed?");
  const overrides = new Map<string, number>();
  for (const entry of m[1].matchAll(/([a-z0-9]+)\s*:\s*(\d+)(?:\s*\+\s*(\d+))?/g)) {
    overrides.set(entry[1], Number(entry[2]) + Number(entry[3] ?? 0));
  }
  return overrides;
}

/** --cache <dir> reads icons-sheet.png / battle-dex-data.js / ps-pokedex.json from disk (no network). */
function cacheDir(): string | null {
  const i = process.argv.indexOf("--cache");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

async function buildIcons(): Promise<TemplateSet> {
  const cache = cacheDir();
  const cached = (name: string) => (cache && existsSync(join(cache, name)) ? join(cache, name) : null);
  const sheetPath = cached("icons-sheet.png");
  const dexPath = cached("battle-dex-data.js");
  const pokedexPath = cached("ps-pokedex.json");
  const sheetBytes = sheetPath ? readFileSync(sheetPath) : await queuedBytes(SHEET_URL);
  const dexDataSrc = dexPath ? readFileSync(dexPath, "utf8") : await queuedText(DEX_DATA_URL);
  const pokedex = pokedexPath
    ? (JSON.parse(readFileSync(pokedexPath, "utf8")) as Record<string, DexEntry>)
    : await queuedJSON<Record<string, DexEntry>>(POKEDEX_URL);
  const overrides = parseIconOverrides(dexDataSrc);
  const sheet = sharp(sheetBytes).ensureAlpha();
  const { data, info } = await sheet.raw().toBuffer({ resolveWithObject: true });
  const rows = Math.floor(info.height / ICON_H);

  // Matte pixels become transparent so signatures mask them out.
  for (let i = 0; i < data.length; i += 4) {
    if (
      Math.abs(data[i] - MATTE[0]) <= MATTE_TOLERANCE &&
      Math.abs(data[i + 1] - MATTE[1]) <= MATTE_TOLERANCE &&
      Math.abs(data[i + 2] - MATTE[2]) <= MATTE_TOLERANCE
    ) {
      data[i + 3] = 0;
    }
  }

  // Also emit the species -> sheet-index map (for CSS background-position
  // team-preview strips in the UI): every id, no dedupe.
  const indexMap: Record<string, number> = {};
  for (const id of Object.keys(pokedex)) {
    const entry = pokedex[id];
    if (!entry || entry.num <= 0) continue;
    const idx = overrides.get(id) ?? (entry.num <= 1025 ? entry.num : -1);
    if (idx >= 0 && idx < SHEET_COLS * rows) indexMap[id] = idx;
  }
  writeFileSync(join(OUT_DIR, "icon-indexes.json"), JSON.stringify(indexMap));
  console.log(`icon-indexes.json: ${Object.keys(indexMap).length} entries`);

  const seenIndex = new Set<number>();
  const templates: Template[] = [];
  const ids = Object.keys(pokedex).sort(); // base formes sort before their formes
  for (const id of ids) {
    const entry = pokedex[id];
    if (!entry || entry.num <= 0) continue;
    const index = overrides.get(id) ?? (entry.num <= 1025 ? entry.num : -1);
    if (index < 0 || index >= SHEET_COLS * rows || seenIndex.has(index)) continue;

    const sx = (index % SHEET_COLS) * ICON_W;
    const sy = Math.floor(index / SHEET_COLS) * ICON_H;
    const cell = new Uint8Array(ICON_W * ICON_H * 4);
    for (let y = 0; y < ICON_H; y++) {
      const src = ((sy + y) * info.width + sx) * 4;
      cell.set(data.subarray(src, src + ICON_W * 4), y * ICON_W * 4);
    }
    // Crop to the icon's alpha bbox so every grid cell carries artwork.
    const cropped = cropToAlpha({ width: ICON_W, height: ICON_H, data: cell });
    if (!cropped || cropped.width < 10 || cropped.height < 10) continue; // empty/degenerate slot
    const sig = computeSignature(cropped, GRID, GRID);
    if (opacityFraction(sig) < 0.3) continue;
    seenIndex.add(index);
    templates.push({ id, name: entry.name, ar: cropped.width / cropped.height, bw: cropped.width, bh: cropped.height, ...sig });
  }
  return { tw: ICON_W, th: ICON_H, gw: GRID, gh: GRID, templates };
}

async function buildSpriteSet(setName: keyof typeof SPRITE_SETS, pokedex: Record<string, DexEntry>): Promise<TemplateSet> {
  const cfg = SPRITE_SETS[setName];
  const templates: Template[] = [];
  const ids = Object.keys(pokedex)
    .sort()
    .filter((id) => pokedex[id].num > 0);
  // PNGs are cached to disk so signature-shape iterations don't refetch.
  const cache = cacheDir();
  const spriteCache = cache ? join(cache, setName) : null;
  if (spriteCache) mkdirSync(spriteCache, { recursive: true });
  let done = 0;
  for (const id of ids) {
    done++;
    let bytes: Buffer;
    const sid = spriteId(pokedex[id].name);
    const ext = cfg.url(sid).endsWith(".gif") ? "gif" : "png";
    const cachedFile = spriteCache ? join(spriteCache, `${sid}.${ext}`) : null;
    if (cachedFile && existsSync(cachedFile)) {
      bytes = readFileSync(cachedFile);
      if (bytes.length === 0) continue; // cached 404
    } else {
      try {
        bytes = await queuedBytes(cfg.url(sid));
        if (cachedFile) writeFileSync(cachedFile, bytes);
      } catch {
        if (cachedFile) writeFileSync(cachedFile, Buffer.alloc(0)); // remember the 404
        continue; // no sprite for this forme; the base forme covers it
      }
    }
    try {
      const pages = cfg.frames ? ((await sharp(bytes).metadata()).pages ?? 1) : 1;
      const wanted = cfg.frames ? [...new Set(Array.from({ length: Math.min(cfg.frames, pages) }, (_, k) => Math.floor((k * pages) / Math.min(cfg.frames!, pages)))) ] : [0];
      for (const page of wanted) {
        const { data, info } = await sharp(bytes, { page, animated: false }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const cropped = cropToAlpha({ width: info.width, height: info.height, data });
        if (!cropped || cropped.width < cfg.minSide || cropped.height < cfg.minSide) continue;
        const sig = computeSignature(cropped, GRID, GRID);
        if (opacityFraction(sig) < 0.3) continue;
        templates.push({ id, name: pokedex[id].name, ar: cropped.width / cropped.height, bw: cropped.width, bh: cropped.height, ...sig });
      }
    } catch (err) {
      console.warn(`decode failed for ${id}: ${err instanceof Error ? err.message : err}`);
    }
    if (done % 100 === 0) console.log(`${setName}: ${done}/${ids.length} (${templates.length} templates)`);
  }
  return { tw: 96, th: 96, gw: GRID, gh: GRID, templates };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log("building icon templates...");
  const icons = await buildIcons();
  writeFileSync(join(OUT_DIR, "icons.json"), JSON.stringify(icons));
  console.log(`icons.json: ${icons.templates.length} templates`);
  if (process.argv.includes("--icons-only")) return;

  const pokedex = await queuedJSON<Record<string, DexEntry>>(POKEDEX_URL);
  for (const setName of Object.keys(SPRITE_SETS) as (keyof typeof SPRITE_SETS)[]) {
    console.log(`building ${setName} sprite templates (polite queue — ~15 min uncached)...`);
    const set = await buildSpriteSet(setName, pokedex);
    writeFileSync(join(OUT_DIR, `${setName}.json`), JSON.stringify(set));
    console.log(`${setName}.json: ${set.templates.length} templates`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
