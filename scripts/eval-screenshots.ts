/**
 * Screenshot-recognition eval against test/fixtures/screenshots/MANIFEST.json.
 * Prints per-fixture extraction vs expectation; exits non-zero if a fixture
 * with authoritative ground truth misses the bar or the negative is accepted.
 *
 *   npx tsx scripts/eval-screenshots.ts [fixture-substring]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { recognizeTeam, type TemplateSets } from "../lib/cv/recognize";
import { baseFormeId } from "../lib/scout/formes";

const DIR = join(__dirname, "..", "test", "fixtures", "screenshots");
const DATA = join(__dirname, "..", "data", "cv");

interface Fixture {
  file: string;
  kind: string;
  scope?: string;
  expectedSpecies: string[] | null;
  candidates?: string[];
  expectRecognized: boolean;
}

async function main() {
  const filter = process.argv[2];
  const manifest = JSON.parse(readFileSync(join(DIR, "MANIFEST.json"), "utf8")) as { fixtures: Fixture[] };
  const loadSet = (name: string) => {
    try {
      return JSON.parse(readFileSync(join(DATA, `${name}.json`), "utf8"));
    } catch {
      console.warn(`${name}.json missing — that path is disabled for this run`);
      return { tw: 96, th: 96, gw: 10, gh: 10, templates: [] };
    }
  };
  const sets: TemplateSets = { icons: loadSet("icons"), gen5: loadSet("gen5"), ani: loadSet("ani"), dex: loadSet("dex") };
  console.log(`templates: ${sets.icons.templates.length} icons, ${sets.gen5.templates.length} gen5, ${sets.ani.templates.length} ani, ${sets.dex.templates.length} dex\n`);

  let failures = 0;
  for (const f of manifest.fixtures) {
    if (filter && !f.file.includes(filter)) continue;
    if (!filter && f.scope === "future") {
      console.log(`── ${f.file} — SKIPPED (scope: future — Champions surfaces are out of scope for now)\n`);
      continue;
    }
    const started = Date.now();
    const { data, info } = await sharp(join(DIR, f.file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const result = recognizeTeam({ width: info.width, height: info.height, data }, sets);
    const ms = Date.now() - started;

    const got = result.species.map((s) => `${s.name}(${s.score},${s.source})`).join(", ");
    console.log(`── ${f.file} [${info.width}x${info.height}, ${ms}ms]`);
    console.log(`   tier=${result.tier} → ${got || "(nothing)"}`);

    if (!f.expectRecognized) {
      const ok = result.tier === "none";
      console.log(`   negative: ${ok ? "correctly rejected ✓" : "WRONGLY ACCEPTED ✗"}`);
      if (!ok) failures++;
    } else if (f.expectedSpecies) {
      const want = new Set(f.expectedSpecies.map(baseFormeId));
      const gotIds = new Set(result.species.map((s) => baseFormeId(s.name)));
      const correct = [...gotIds].filter((id) => want.has(id)).length;
      const ok = correct >= 4;
      console.log(`   ground truth: ${correct}/${want.size} correct ${ok ? "✓" : "✗ (need >=4)"}`);
      if (!ok) failures++;
    } else if (f.candidates) {
      const confident = new Set(f.candidates.filter((c) => !c.includes("?")).map(baseFormeId));
      const gotIds = new Set(result.species.map((s) => baseFormeId(s.name)));
      const agree = [...gotIds].filter((id) => confident.has(id)).length;
      console.log(`   candidates (unverified): agrees with ${agree}/${confident.size} confident guesses — inspect manually`);
    }
    console.log();
  }
  if (failures > 0) {
    console.error(`${failures} fixture(s) failed`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
