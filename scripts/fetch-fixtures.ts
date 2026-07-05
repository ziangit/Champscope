/**
 * Download real Champions replays into test/fixtures/ for parser snapshot
 * tests, exercising the shared client (queue + wrappers) end-to-end.
 * Aims for the spec's fixture mix: high-rated game, Mega game, forfeit, tie,
 * nicknamed Pokémon. Usage: npx tsx scripts/fetch-fixtures.ts
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getLadder, getReplay, searchReplays } from "../lib/showdown/api";

const FORMAT_ID = "gen9championsvgc2026regmb";
const OUT = join(__dirname, "..", "test", "fixtures");

interface Tagged {
  id: string;
  rating: number | null;
  tags: string[];
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  const started = Date.now();
  const ladder = await getLadder(FORMAT_ID);
  console.log(`ladder ok: ${ladder.toplist.length} entries, top = ${ladder.toplist[0]?.username}`);

  const recent = await searchReplays({ format: FORMAT_ID });
  console.log(`search ok: ${recent.length} recent replays (queue gap check: 2 reqs in ${Date.now() - started} ms)`);

  // Fetch a batch of recent replays and keep a diverse mix.
  const picked: Tagged[] = [];
  const want = 10;
  const have = new Set<string>();
  const need = { tie: true, forfeit: true, mega: true, nickname: true, highrated: true };

  for (const row of recent) {
    if (picked.length >= want) break;
    const out = join(OUT, `${row.id}.json`);
    if (existsSync(out) || have.has(row.id)) continue;
    const replay = await getReplay(row.id);
    const log = replay.log;
    const tags: string[] = [];
    if (/^\|tie(\|.*)?$/m.test(log)) tags.push("tie");
    if (log.includes("forfeited")) tags.push("forfeit");
    if (log.includes("|-mega|") || log.includes("|detailschange|")) tags.push("mega");
    if (log.includes("|showteam|")) tags.push("showteam");
    // nickname: a switch line whose visible name differs from the species in details
    const nick = log.split("\n").some((l) => {
      const m = l.match(/^\|(?:switch|drag)\|p\d[ab]: ([^|]+)\|([^,|]+)/);
      return m && m[1] !== m[2];
    });
    if (nick) tags.push("nickname");
    if ((replay.rating ?? 0) >= 1200) tags.push("highrated");

    const fillsGap = tags.some((t) => need[t as keyof typeof need]);
    // Take the first few unconditionally, then only ones that fill a gap.
    if (picked.length < 5 || fillsGap) {
      writeFileSync(out, JSON.stringify(replay, null, 1));
      picked.push({ id: replay.id, rating: replay.rating, tags });
      have.add(row.id);
      for (const t of tags) if (t in need) need[t as keyof typeof need] = false;
      console.log(`saved ${replay.id} rating=${replay.rating} tags=[${tags.join(",")}]`);
    }
  }

  console.log("\nstill missing:", Object.entries(need).filter(([, v]) => v).map(([k]) => k));
  writeFileSync(
    join(OUT, "MANIFEST.json"),
    JSON.stringify({ formatId: FORMAT_ID, fetched: picked }, null, 2),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
