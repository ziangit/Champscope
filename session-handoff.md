# Session handoff

**Current phase:** DEPLOYED and verified. Production: https://champscope.vercel.app (Vercel project `champscope` ← auto-deploys from GitHub `ziangit/Champscope`, Supabase project `amyilzbouobunoegefld`). First production watch pass ran clean: 50/50 players, 208 replays, 261 team profiles, 22/50 coverage, 0 errors.
**Next concrete step:** Implement docs/TEAM-SOURCES.md — the set importer first, then pokedata.ovh / VGCPastes / teamsheet.gg / Smogon-chaos ingest jobs, then the `/match` in-battle lookup (exact fingerprint + 4-of-6 overlap query).

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
- Deployment: schema applied via Supabase management API (`POST /v1/projects/<ref>/database/query`); env vars in Vercel; `CRON_SECRET` secret + `WATCH_URL` variable in GitHub; `ladder-watch` enabled. See docs/ARCHITECTURE.md "Production ops".

## Planned next
- docs/TEAM-SOURCES.md (verified endpoints + integration design): pokedata.ovh official tournament sheets, VGCPastes CSV→pokepaste JSON, teamsheet.gg, Smogon chaos priors; X explicitly excluded. Then `/match`.

## Open questions
- All §10 spec questions answered — see docs/ARCHITECTURE.md. Notable corrections: `|showteam|` appears in ~4% of Champions replays (8/207); Champions ability data diverges from the gen-9 dex (never validate reveals against it).
- Undecided: backfill Reg M-A history (format exists, seeded `active=false`).
- Nice-to-haves not built: rating-trajectory chart on /watch (currently a Δ column), Bo3 format variants in `formats`.
