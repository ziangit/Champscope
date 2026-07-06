/**
 * CLI driver for the team-source ingest worker (same code path as
 * /api/ingest/run, without the HTTP layer): loops ticks until every source
 * reports cooldown. Requires SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 * (reads .env.local).
 *
 *   npx tsx scripts/dev-ingest.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

try {
  for (const line of readFileSync(join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  /* .env.local optional when env is set another way */
}

import { ingestTick } from "../lib/sources/worker";

async function main() {
  for (let tick = 1; ; tick++) {
    const result = await ingestTick(Date.now() + 7000, "dev");
    console.log(`tick ${tick}:`, JSON.stringify(result));
    if (result.status === "cooldown") break;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
