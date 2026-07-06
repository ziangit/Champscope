# Champscope

VGC-first Pokémon Showdown scouting suite for the Pokémon Champions era: a replay scouter web app plus a scheduled ladder watcher that builds a persistent team database. Unaffiliated, non-commercial fan project — no Pokémon assets are bundled; sprites are hotlinked from the official Showdown client.

**Live:** https://champscope.vercel.app

Spec: [CHAMPSCOPE.md](CHAMPSCOPE.md) · Architecture notes, gotchas & production ops: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · Team sources: [docs/TEAM-SOURCES.md](docs/TEAM-SOURCES.md)

Besides replay scouting, teams are imported from VGCPastes and pokedata.ovh (official tournament sheets), labeled by origin and deduped per source; `/match` looks up an opponent's team preview against everything on file (exact roster + 4-of-6 overlap).

## Setup

1. Create a Supabase project and run [`schema.sql`](schema.sql) in the SQL editor (idempotent; seeds the verified Champions formats).
2. `cp .env.example .env.local` and fill in the values.
3. `npm install && npm run dev`

## Deploy

- Vercel project with the same env vars (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `SHOWDOWN_CONTACT`). `vercel.json` registers the once-daily fallback cron.
- GitHub repo: add secret `CRON_SECRET` and variable `WATCH_URL` (`https://<app>.vercel.app/api/watch/run`) for [`.github/workflows/watch.yml`](.github/workflows/watch.yml), which fires every 12 hours and drives the chunked watcher until the pass completes (each hit does ~7 s of work and persists a cursor; passes cool down for 11 h).
- Variable `INGEST_URL` (`https://<app>.vercel.app/api/ingest/run`) for [`.github/workflows/ingest.yml`](.github/workflows/ingest.yml), the weekly team-source ingest (VGCPastes + pokedata.ovh).

## Commands

- `npm test` — parser/merge/export unit + snapshot tests (real replay fixtures in `test/fixtures/`)
- `npm run reparse` — after bumping `PARSER_VERSION`: re-parse all cached replays and rebuild replay-derived team profiles (never refetches; imported teams are untouched)
- `npx tsx scripts/dev-ingest.ts` — run the team-source ingest against whatever DB `.env.local` points to
- `npx tsx scripts/fetch-fixtures.ts` — refresh test fixtures from the live replay archive

## Politeness

All Showdown traffic goes through a single serial queue (≥600 ms between requests, honest User-Agent, exponential backoff, permanent replay cache). Keep it that way.
