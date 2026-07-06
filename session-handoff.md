# Session handoff

**Current phase:** DEPLOYED. Production: https://champscope.vercel.app (Vercel project `champscope` ← auto-deploys from GitHub `ziangit/Champscope`, Supabase project `amyilzbouobunoegefld`). Watcher runs 12-hourly; team-source ingest (VGCPastes + pokedata.ovh) runs weekly; `/match` looks up previews against all origins.
**Next concrete step:** remaining TEAM-SOURCES items — teamsheet.gg ingest (static-HTML, browser-ish UA) and Smogon-chaos priors (`usage_stats` table + "likely 4th move" hints); optional Tampermonkey userscript feeding /match from the battle DOM.

## Done so far
- Harness docs (AGENTS.md holds the content; CLAUDE.md imports it per the Next.js scaffold convention).
- Bootstrap: Next.js 16 App Router + TS + Tailwind v4, idempotent `schema.sql` (seeds verified formats + service_role grants), `vercel.json` daily cron fallback, `.env.example`. Dev/start on port **4977**.
- Showdown client (`lib/showdown/`): `toID`, global polite serial queue (≥600 ms, 3-try backoff, honest UA), typed wrappers modeled from live responses. Format ID `gen9championsvgc2026regmb` verified live.
- Parser (`lib/scout/parse.ts`): log → `ParsedReplay`; 5 real Reg M-B fixtures snapshot-tested + hand-checked; synthetic tests for tie/showteam/Trick/Trace/Metronome edge cases.
- Merge layer (`lib/scout/merge.ts`, `formes.ts`): base-forme fingerprints, frequency-counted reveals with provenance, lead pairs / bring-4, replay refs with ratings, set-variation flag, alt correlation.
- Phase 1 UI: `/scout`, `/player/[userId]`, `/teams`; Pokepaste-style team cards (top-4 moves as the set, 5th+ under "also seen", per-replay `Rating: N`), copyable export capped at 4 moves for teambuilder round-trip.
- Phase 2: `lib/watch.ts` chunked worker (cursor in `scout_runs.cursor`, ~7 s budget, **11 h pass cooldown**), bearer-authed `/api/watch/run`, GH Actions scheduler fires **every 12 h** and drives a full pass per run (~3.5 min), `/watch` dashboard.
- `npm run reparse`: re-parses cached `raw_json` on `PARSER_VERSION` bump and rebuilds all team profiles from scratch (also migrates profile-shape changes).
- Local test rig: `supabase start` + `.env.local`; `npx tsx scripts/dev-scout.ts <user>` for CLI scouts. Local DB has its own harvest, independent of prod.
- Tests: 18 passing (`npm test`); `next build` clean.
- Deployment: schema applied via Supabase management API (`POST /v1/projects/<ref>/database/query`); env vars in Vercel; `CRON_SECRET` secret + `WATCH_URL`/`INGEST_URL` variables in GitHub; `ladder-watch` + `team-ingest` enabled. See docs/ARCHITECTURE.md "Production ops".
- Team fetching + matching (2026-07-06): set importer (`lib/scout/import.ts`, inverse of export, sheet-grade provenance, never fabricates EVs); `origin` in the team_profiles identity + `sources` jsonb (dedupe per source key, GIN-indexed); per-host polite queue lanes; chunked `/api/ingest/run` + weekly `team-ingest` workflow; VGCPastes (386 pastes, 376 profiles, 0 errors locally) + pokedata.ovh (NAIC 1,095 masters sheets bulk-ingested locally under regma, 0 species-normalization failures); `match_teams` SQL fn + `/match` page + `GET /api/match` (exact fingerprint + ≥4-overlap, GIN-prefiltered); TeamCard origin badges/sources panel; /teams origin filter; reparse rebuilds only `origin='replay'`. Tests 25 passing.
- **Regulation ground truth:** VGCPastes M-B tab starts 17 Jun 2026 ⇒ all finished official events incl. NAIC (Jun 12–14) are Reg M-A. `POKEDATA_WINDOWS` maps M-B from 2026-06-15 (empty today; Worlds lands automatically). M-A backfill = one config entry.

## Planned next
- teamsheet.gg ingest; Smogon chaos priors (`usage_stats`); Tampermonkey userscript for /match.

## Open questions
- All §10 spec questions answered — see docs/ARCHITECTURE.md. Notable corrections: `|showteam|` appears in ~4% of Champions replays (8/207); Champions ability data diverges from the gen-9 dex (never validate reveals against it).
- Undecided: backfill Reg M-A history — now trivial (add a `POKEDATA_WINDOWS` entry + flip the format active for the watcher, or ingest-only).
- Nice-to-haves not built: rating-trajectory chart on /watch (currently a Δ column), Bo3 format variants in `formats`.
