/**
 * Ad-hoc scout from the CLI (same pipeline the UI uses):
 *   npx tsx scripts/dev-scout.ts <username> [formatId]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

try {
  for (const line of readFileSync(join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  /* env may be set another way */
}

import { scoutUser } from "../lib/scout/ingest";

async function main() {
  const [name, formatId = "gen9championsvgc2026regmb"] = process.argv.slice(2);
  if (!name) {
    console.error("usage: npx tsx scripts/dev-scout.ts <username> [formatId]");
    process.exit(1);
  }
  const started = Date.now();
  const stats = await scoutUser(name, { formatId });
  console.log(JSON.stringify(stats, null, 2));
  console.log(`took ${((Date.now() - started) / 1000).toFixed(1)}s (polite queue pacing)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
