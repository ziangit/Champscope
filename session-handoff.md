# Session handoff

**Current phase:** DEPLOYED. Production: https://champscope.vercel.app (Vercel project `champscope`, GitHub `ziangit/Champscope`, Supabase project `amyilzbouobunoegefld`). Schema applied via management API; env vars set (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `SHOWDOWN_CONTACT`); GH secret `CRON_SECRET` + variable `WATCH_URL` set; `ladder-watch` enabled (fires every 12 h, drives a full pass per run). Local dev stack (`supabase start` + `.env.local`) still works independently of prod.
**Next concrete step:** Implement docs/TEAM-SOURCES.md — the set importer, then pokedata.ovh / VGCPastes / teamsheet.gg / Smogon-chaos ingest jobs, then `/match`.
**Previously:** Deploy checklist was: create the Supabase project and apply `schema.sql`; create the Vercel project with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `SHOWDOWN_CONTACT`; push to GitHub and set the `CRON_SECRET` secret + `WATCH_URL` variable for `.github/workflows/watch.yml`. Then run one ad-hoc scout end-to-end against production and watch the first ladder pass complete.

## Done so far
- Harness docs (AGENTS.md holds the content; CLAUDE.md imports it per the Next.js scaffold convention).
- Bootstrap: Next.js 16 App Router + TS + Tailwind v4, idempotent `schema.sql` (seeds verified formats), `vercel.json` daily cron fallback, `.env.example`.
- Showdown client (`lib/showdown/`): `toID`, global polite serial queue (≥600 ms, 3-try backoff, honest UA), typed wrappers modeled from live responses. Format ID `gen9championsvgc2026regmb` verified live.
- Parser (`lib/scout/parse.ts`): log → `ParsedReplay`; 5 real Reg M-B fixtures snapshot-tested + hand-checked; synthetic tests for tie/showteam/Trick/Trace/Metronome edge cases.
- Merge layer (`lib/scout/merge.ts`, `formes.ts`): base-forme fingerprints, frequency-counted reveals with provenance, lead pairs / bring-4, set-variation flag, alt correlation.
- Phase 1 UI: `/scout` (server action → shared ingest pipeline), `/player/[userId]`, `/teams`; team-sheet-styled cards, copyable Showdown export (confirmed fields only). Pages degrade to a setup notice without Supabase env.
- Phase 2: `lib/watch.ts` chunked worker (cursor in `scout_runs.cursor`, ~7 s budget, 20 h pass cooldown), bearer-authed `/api/watch/run`, GH Actions scheduler (`.github/workflows/watch.yml`), `/watch` dashboard (run status, coverage, top-50 Δ table, new finds, alt suggestions).
- `npm run reparse` (`scripts/reparse.ts`): re-parses cached `raw_json` on `PARSER_VERSION` bump and rebuilds all team profiles from scratch.
- Tests: 17 passing (`npm test`); `next build` clean.

## Planned next (after deploy)
- Team-source ingestion + /match feature — full verified research and design in docs/TEAM-SOURCES.md (pokedata.ovh official sheets, VGCPastes, teamsheet.gg, Smogon chaos; X explicitly excluded).

## Open questions
- All §10 spec questions answered — see docs/ARCHITECTURE.md (notably: **no `|showteam|` in Champions replays** despite the ruleset listing Open Team Sheets; reveal-driven provenance is the norm).
- Undecided: backfill Reg M-A history (format exists, currently seeded `active=false`).
- Nice-to-haves not built: rating-trajectory chart on /watch (currently a Δ column), Bo3 format variants in `formats`.
