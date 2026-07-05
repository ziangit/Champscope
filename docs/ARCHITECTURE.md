# champscope — architecture (living doc)

> Update this whenever a non-obvious decision or constraint is discovered.
> The authoritative build spec is CHAMPSCOPE.md at the repo root; this file records what we learn while building it.

## Stack
- Next.js (App Router) + TypeScript, deployed on Vercel (Hobby tier)
- Supabase Postgres via `supabase-js` (server-side singleton)
- Vercel Cron (once-daily fallback) + GitHub Actions schedule driving the worker route
- External dependency: Showdown web APIs only (all JSON, CORS-open) — see CHAMPSCOPE.md §3

## Known constraints & gotchas
- **Vercel Hobby (verified in spec):** cron once-daily max, 10 s function timeout, no retries, GET only, must check `Authorization: Bearer ${CRON_SECRET}`. Hence the chunked-worker design: each invocation processes what fits in ~8 s, persists a cursor in `scout_runs.cursor`, resumes next hit. Full top-50 pass over ~2 h of chunks is acceptable.
- **Replay search pagination:** up to 51 results/page; a 51st result signals another page; page back with `before=<uploadtime of last result>`.
- **Sim protocol traps:** nicknames ≠ species (resolve via `details`); `|-item|`/`|-ability|` with `[from]` effects (Frisk, Trick) can reveal the *other* side's Pokémon's item — attribute carefully; `|showteam|` is authoritative when present but merge reveals on top anyway; don't assume Tera exists in Champions formats (mechanics come from format config).
- **Fingerprint:** SHA-1 of sorted 6 species IDs, forme-normalized to base forme so Mega reveals don't split a team.
- **Sparse data is the norm:** most top-ladder players have zero public replays and many play on alts. "No replays" is a recorded outcome, not an error.
- **Regulations rotate** (~Sept 2026 → Reg M-C): format ID/mechanics/display name live in the `formats` table, one row per regulation; every data table keys on format ID.

## Key decisions
- **Cache-first:** cron ingests into Postgres; UI reads Postgres; ad-hoc scouts write through the same queue + cache. Replay JSON immutable — never refetched.
- **Pure core parser** (`lib/scout/`): no I/O, snapshot-tested against real replay fixtures in `test/fixtures/`. Highest-value test surface in the project.
- **`parser_version` on `replays`:** improved parsers re-parse cached `raw_json` via the `reparse` script without refetching.
- **GitHub Actions as scheduler:** hits the worker route with the bearer token multiple times daily; Vercel Cron is the once-daily fallback.

## Open questions (from CHAMPSCOPE.md §10 — record answers here)
- **Format IDs — RESOLVED (verified live 2026-07-05):** primary format is `gen9championsvgc2026regmb`, display name `[Gen 9 Champions] VGC 2026 Reg M-B` (note: "[Gen 9 Champions]", not "[Champions]" as the spec guessed). Verified against both `pokemonshowdown.com/ladder/<id>.json` (200, populated toplist) and `replay.pokemonshowdown.com/search.json?format=<id>` (200, results). From `play.pokemonshowdown.com/data/formats.js` (NOT `/config/formats.js` — that 404s): `mod:"champions", gameType:"doubles", bestOfDefault:true, ruleset:["Flat Rules","VGC Timer","Open Team Sheets"]`. Sibling formats exist: Reg M-A and Bo3 variants of both (`... (Bo3)` names). Reg M-A backfill decision — TODO.
- **Open team sheets — RESOLVED (surprising): NO `|showteam|` in Champions ladder replays.** formats.js lists "Open Team Sheets" in the Reg M-B ruleset, but 3/3 sampled replays (including a rated-1251 human game) contain no `|showteam|` line and only 2 `|rule|` lines (Species/Item Clause). Sheets are apparently client-UI-only or not persisted to replay logs in this format. The parser still handles `|showteam|` (spec requirement; other VGC formats have it), but provenance expectations for Champions are reveal-driven: preview `|poke|` + in-battle reveals. Mega messages (`|-mega|`/`|detailschange|`) confirmed present; no `|-terastallize|` seen.
- **Parser gotcha (observed):** `|teamsize|p1|4` appears AFTER `|teampreview|4` and reflects the *brought* count (4), not the roster size — the roster of 6 comes from `|poke|` lines. `|poke|` details in Champions include level + gender (e.g. `Charizard, L50, F, shiny`) but no item marker.
- **Ladder JSON fields — RESOLVED (verified live):** `{formatid, format, toplist: [{userid, username, w, l, t, gxe, r, rd, sigma, rptime, rpr, rprd, rpsigma, elo, first_played, last_played}]}`. `elo` and `gxe` are directly available; `r`/`rd` are Glicko-1 rating/deviation. `first_played`/`last_played` are unix seconds.
- **Replay search result fields (verified live):** `[{uploadtime, id, format /* display name */, players: [p1, p2], rating, private, password}]`. `rating` can be null.
- **`search.json` combined `user+format` — RESOLVED: YES**, server-side filtering works in one query (`?user=bobcow40&format=gen9championsvgc2026regmb` returned only that format's replays). No client-side filtering needed.
- **Single replay JSON shape (verified live):** `{id, format /* display name */, formatid, players: [string, string], log, uploadtime, views, rating, private, password}`.
- **User profile JSON shape (verified live):** `{username, userid, registertime, group, ratings: {<formatid>: {...}}}`.
