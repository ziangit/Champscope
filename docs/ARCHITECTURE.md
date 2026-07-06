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

## Production ops (deployed 2026-07-05)

- **URLs/IDs:** app https://champscope.vercel.app · Vercel project `champscope` (auto-deploys `main` from GitHub `ziangit/Champscope`) · Supabase project ref `amyilzbouobunoegefld`.
- **Secrets:** `CRON_SECRET` lives in Vercel env (production) and as a GitHub Actions secret — recover via `npx vercel env pull`; it is NOT in `.env.local` (that file holds the local-stack values, `CRON_SECRET=local-test-secret`). Rotation = new value in both places + redeploy.
- **Schema changes:** apply to prod with the Supabase management API — `POST https://api.supabase.com/v1/projects/<ref>/database/query` with `{query: <sql>}`, bearer = the CLI access token (on macOS it's in the keychain: `security find-generic-password -s "Supabase CLI" -w`; requires `supabase login` once). `schema.sql` is idempotent, so re-running the whole file is the normal path. The service_role grants block in schema.sql is required whenever tables are created outside Supabase's own editor.
- **Scheduler:** GH Actions `ladder-watch` fires at 00:00/12:00 UTC, loops the worker route until `finished`/`cooldown` (~3.5 min, ~35 ticks/pass). Manual pass: `gh workflow run ladder-watch`, or curl the route with the bearer token. Pass cooldown is 11 h (`lib/watch.ts`). Vercel Cron (once daily, `vercel.json`) is the fallback; it authenticates automatically with the `CRON_SECRET` env var.
- **Cursor resume is cross-trigger:** a pass started manually is picked up and finished by the workflow (verified on the first prod pass).
- **Team-source ingest:** `/api/ingest/run` (same bearer + chunked-cursor design), driven weekly by GH Actions `team-ingest` (needs variable `INGEST_URL`); sources run as separate passes (vgcpastes, then pokedata), 20 h cooldown each. The workflow loops until `cooldown` — `finished` only ends one source. Local CLI: `npx tsx scripts/dev-ingest.ts`. Idempotent per source key; a re-run mostly no-ops.
- **Local vs prod:** two independent DBs. Local = `supabase start` + `.env.local`; prod data only via the deployed app/workflow. `npm run reparse` runs against whatever `.env.local` points to — point it at prod only deliberately.

## Key decisions
- **Cache-first:** cron ingests into Postgres; UI reads Postgres; ad-hoc scouts write through the same queue + cache. Replay JSON immutable — never refetched.
- **Pure core parser** (`lib/scout/`): no I/O, snapshot-tested against real replay fixtures in `test/fixtures/`. Highest-value test surface in the project.
- **`parser_version` on `replays`:** improved parsers re-parse cached `raw_json` via the `reparse` script without refetching.
- **GitHub Actions as scheduler:** hits the worker route with the bearer token multiple times daily; Vercel Cron is the once-daily fallback.
- **Imported teams are separate rows, same table:** `origin` ('replay' | 'paste' | 'tournament') is part of the `team_profiles` identity `(user_id, format_id, fingerprint, origin)`. One table keeps `/match` a single query across all origins; separate rows keep replay stats pure and let `reparse` wipe/rebuild only `origin='replay'`. Dedupe is per `sources[].key` (jsonb GIN); the merge is idempotent per key, mirroring `mergeGame`'s per-replay idempotency.
- **Per-host polite lanes:** the queue serializes per host (600 ms gap, 3-try backoff) with ALL `*.pokemonshowdown.com` hosts sharing one lane (the original hard constraint). pokedata.ovh / docs.google.com / pokepast.es each get their own lane.
- **`match_teams` SQL function** (schema.sql) does partial matching in one indexed query; exact 6/6 goes through the fingerprint index. Supabase RPC via PostgREST — remember `NOTIFY pgrst, 'reload schema'` after adding functions/columns outside the dashboard.

## Open questions (from CHAMPSCOPE.md §10 — record answers here)
- **Format IDs — RESOLVED (verified live 2026-07-05):** primary format is `gen9championsvgc2026regmb`, display name `[Gen 9 Champions] VGC 2026 Reg M-B` (note: "[Gen 9 Champions]", not "[Champions]" as the spec guessed). Verified against both `pokemonshowdown.com/ladder/<id>.json` (200, populated toplist) and `replay.pokemonshowdown.com/search.json?format=<id>` (200, results). From `play.pokemonshowdown.com/data/formats.js` (NOT `/config/formats.js` — that 404s): `mod:"champions", gameType:"doubles", bestOfDefault:true, ruleset:["Flat Rules","VGC Timer","Open Team Sheets"]`. Sibling formats exist: Reg M-A and Bo3 variants of both (`... (Bo3)` names). Reg M-A backfill decision — TODO.
- **Open team sheets — CORRECTED: `|showteam|` exists but is RARE.** An early 3-replay sample suggested none; the real rate over the first full top-50 harvest is **8/207 replays (~4%)**. Provenance for Champions is still overwhelmingly reveal-driven, but sheet-sourced fields do occur and the sheet-beats-revealed merge rule matters. Mega messages (`|-mega|`/`|detailschange|`) confirmed present; no `|-terastallize|` seen.
- **Champions ability data diverges from the gen-9 dex — do NOT validate reveals against it.** Observed across the harvest: hidden-slot abilities are normal and sheet-confirmed (Intimidate Incineroar ×60, Rough Skin Garchomp from sheets), ability sets are changed (Gardevoir announced Intimidate), and new abilities exist ("Eelevate" on Eelektross, Lightning Rod on Mega Sceptile). The mod's dex overrides are not exposed at any public data URL we found. Consequence: the parser records exactly what the sim announces and never filters by gen-9 legality; a clean `|-ability|` announce in a rated game (e.g. Mold Breaker Basculegion, replay …2644490591) is validator-approved by the sim even when it looks illegal by gen-9 rules.
- **Parser gotcha (observed):** `|teamsize|p1|4` appears AFTER `|teampreview|4` and reflects the *brought* count (4), not the roster size — the roster of 6 comes from `|poke|` lines. `|poke|` details in Champions include level + gender (e.g. `Charizard, L50, F, shiny`) but no item marker.
- **Ladder JSON fields — RESOLVED (verified live):** `{formatid, format, toplist: [{userid, username, w, l, t, gxe, r, rd, sigma, rptime, rpr, rprd, rpsigma, elo, first_played, last_played}]}`. `elo` and `gxe` are directly available; `r`/`rd` are Glicko-1 rating/deviation. `first_played`/`last_played` are unix seconds.
- **Replay search result fields (verified live):** `[{uploadtime, id, format /* display name */, players: [p1, p2], rating, private, password}]`. `rating` can be null.
- **`search.json` combined `user+format` — RESOLVED: YES**, server-side filtering works in one query (`?user=bobcow40&format=gen9championsvgc2026regmb` returned only that format's replays). No client-side filtering needed.
- **Single replay JSON shape (verified live):** `{id, format /* display name */, formatid, players: [string, string], log, uploadtime, views, rating, private, password}`.
- **User profile JSON shape (verified live):** `{username, userid, registertime, group, ratings: {<formatid>: {...}}}`.
