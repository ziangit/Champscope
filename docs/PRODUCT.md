# champscope — product

## What it is
A VGC-first Pokémon Showdown scouting suite for the Pokémon Champions era. It rebuilds the Replay Scouter concept doubles-first (lead pairs, bring-4-of-6, open team sheets, Mega reveals) and adds a scheduled watcher that snapshots the `[Champions] VGC 2026 Reg M-B` ladder top 50 and automatically scouts every player with public replays, accumulating a persistent team database. Unaffiliated, non-commercial fan project; single-user personal tool.

## Features
- **Phase 1 — Scouter web app**
  - `/scout`: scout by username(s) and/or pasted replay URLs, per format, optional date range.
  - `/player/[userId]`: team cards grouped by roster fingerprint — sprites, merged sets as copyable Showdown export (Pokepaste-compatible), lead-pair and bring-4 frequency tables, W/L, Mega-slot usage, replay links, first/last seen, field-level provenance (sheet vs revealed) on hover.
  - `/teams`: browse/filter all known teams by species, sort by last seen / owner rating.
- **Phase 2 — Ladder Watcher**
  - Chunked cron worker: ladder snapshot → top-50 diff → replay search → parse → merge, cursor-resumable within Vercel's 10 s limit; driven by GitHub Actions schedule with Vercel Cron as once-daily fallback.
  - `/watch` dashboard: last run status, coverage stats, new-teams feed, rating trajectories, alt-correlation suggestions (identical team fingerprints under different names — always a suggestion, never asserted).
- **Core library**: pure replay parser (`lib/scout/`) + cross-replay merge layer with fingerprints, provenance, and usage counts; `parser_version` + `reparse` script to re-parse cached raw logs without refetching.

## Non-goals (explicitly out of scope for now)
- Phase 3 Showdex fork / in-battle damage calc.
- EV/nature/spread inference from damage numbers.
- Scraping non-JSON endpoints; headless browsers.
- Whole-ladder usage-stats aggregation (Pikalytics exists).
- Accounts/auth of any kind.
