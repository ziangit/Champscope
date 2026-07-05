# Champscope — Project Specification

VGC-first Pokémon Showdown scouting suite for the Pokémon Champions era.
This document is the build spec for **Phase 1 (VGC Replay Scouter)** and
**Phase 2 (Ladder Watcher cron)**. Phase 3 (a Champions-aware Showdex fork)
is explicitly out of scope for now.

Champscope is an unaffiliated, non-commercial fan project. Do not bundle
sprites, audio, or other Pokémon assets; hotlink the official Showdown
client resources where images are needed.

---

## 1. Problem statement

The existing Showdown Replay Scouter (FullLifeGames) is singles-oriented and
handles modern VGC / Pokémon Champions formats poorly. Champscope rebuilds the
concept VGC-first:

- Doubles-aware parsing: lead **pairs**, bring-4-of-6 selection, per-slot data.
- Champions mechanics: Mega Evolution reveals (Reg M allows Megas), open team
  sheets when present, regulation-agnostic format handling.
- A scheduled watcher that snapshots the top 50 of the
  `[Champions] VGC 2026 Reg M-B` ladder and automatically scouts any player
  whose replays are public, building a persistent team database over time.

Key reality: most top-ladder players do not upload replays and many play on
alts. The watcher's value is systematically harvesting the *rare* public
exposure and correlating teams across names. Design everything around sparse
data: never error on "no replays found", record it and move on.

## 2. Stack

Use the standard personal-project stack (see the
`nextjs-supabase-vercel-bootstrap` skill and follow its harness/scaffold
workflow):

- Next.js (App Router) + TypeScript on Vercel
- Supabase Postgres via `supabase-js` (server-side singleton)
- Vercel Cron for scheduling (see §7 for the Hobby-tier timeout workaround)
- No websockets, no live battle connection — everything is REST + JSON

Core principle: **cache-first**. The cron ingests into Postgres; the UI reads
from Postgres. The only user-triggered external fetches are ad-hoc scouts
(§6), and even those write through to the cache. Replay logs are immutable —
once fetched, never refetch.

## 3. Showdown Web APIs (the only external dependency)

All endpoints return JSON and send `Access-Control-Allow-Origin: *`.
Reference: `smogon/pokemon-showdown-client` → `WEB-API.md`. Inspect a live
response for each endpoint and model TypeScript types from what you actually
see before writing mappings — do not guess field names.

| Purpose | Endpoint |
|---|---|
| Replay search by user | `https://replay.pokemonshowdown.com/search.json?user=<userid>` |
| Replay search by format | `https://replay.pokemonshowdown.com/search.json?format=<formatid>` (combinable with `user`) |
| Single replay (log + metadata) | `https://replay.pokemonshowdown.com/<replayid>.json` |
| Ladder top 500 | `https://pokemonshowdown.com/ladder/<formatid>.json` |
| User profile / ratings | `https://pokemonshowdown.com/users/<userid>.json` |

Pagination: search returns up to **51 results per page** (a 51st result means
another page exists); pass `before=<uploadtime of last result>` to page back
by 50.

**Format ID must be verified at build time, not hardcoded from this doc.**
The display name is `[Champions] VGC 2026 Reg M-B`. Fetch
`https://play.pokemonshowdown.com/config/formats.js` (or open the ladder
index at `https://pokemonshowdown.com/ladder/` and follow the link) to find
the exact ID, then store it in a `formats` config table/file. Regulations
rotate (~Sept 2026 brings Reg M-C), so the format ID, allowed mechanics, and
display name must all live in config — one row per regulation — and every
table below keys on format ID. Nothing in the parser may assume a specific
regulation.

`userid` = lowercased name with all non-alphanumerics stripped (Showdown's
`toID()` convention). Implement this once in a shared util.

### Politeness rules (hard requirements)

- Global serial queue for all Showdown requests, ≥ 600 ms between requests.
- Identify honestly (descriptive `User-Agent` with a contact URL).
- Cache permanently: replay JSON is immutable; ladder snapshots and search
  results are cached with timestamps.
- Back off exponentially on 429/5xx; give up gracefully after 3 tries and
  record the failure in `scout_runs`.

## 4. Core library: replay parsing (`lib/scout/`)

This is the heart of the project — a pure, well-tested module that both the
UI and the cron call. Input: a replay's raw `log` string + metadata. Output:
a normalized `ParsedReplay`.

The log is the Showdown sim protocol: newline-separated, pipe-delimited
messages. Reference: `smogon/pokemon-showdown` → `sim/SIM-PROTOCOL.md`.
Messages that matter:

- `|player|p1|<name>|...` — map player slots to names.
- `|teamsize|p1|6`, `|gametype|doubles`, `|gen|`, `|tier|`, `|rated|`.
- `|clearpoke` / `|poke|p1|<details>|` — team preview: the full roster of 6
  (species, gender, sometimes item hints). This is the bring-6.
- `|showteam|p1|<packed team>` — **open team sheet**, present in many VGC
  formats: full sets (moves, items, abilities, sometimes EVs). When present
  this is authoritative; parse the packed-team format (see
  `sim/TEAMS.md` / `@pkmn/sets` packed format). Merge reveals on top anyway
  (reveals confirm; sheets may omit per-format fields).
- `|switch|p1a: ...` / `|drag|` — active Pokémon. The first switch messages
  for slots `a` and `b` on each side (before turn 1) are the **leads**; the
  set of distinct species that ever appear per side is the **bring-4**.
- `|move|p1a: <name>|<move>|...` — revealed moves.
- `|-item|`, `|-enditem|` — revealed items (attribute to the right Pokémon;
  beware `[from]` effects like Frisk/Trick revealing the *other* side's item).
- `|-ability|` — revealed abilities (same `[from]` caution).
- `|detailschange|` / `|-mega|` — Mega Evolution (record base + Mega forme,
  and which Pokémon held the Mega slot that game).
- `|-terastallize|` — parse and store if present; do not assume it exists in
  Champions formats (mechanics list comes from the format config).
- `|win|<name>` / `|tie` — result. Compute per-player W/L.
- Nicknames ≠ species: resolve via the `details` field on `switch`/`poke`.

### Normalized model

```ts
ParsedReplay {
  replayId, formatId, uploadTime, rating?, views?,
  players: [{
    name, userId,
    roster: PokemonReveal[6],        // from team preview / showteam
    brought: string[],               // species ids, order of first appearance
    leads: [string, string],         // first two on the field
    megaUser?: string, teraUser?: string,
    won: boolean
  }, { ...p2 }]
}

PokemonReveal {
  speciesId, nickname?, gender?, level?,
  ability?, item?, itemConsumed?, moves: string[],   // ≤4, revealed or from sheet
  megaForme?, teraType?,
  source: 'sheet' | 'revealed' | 'preview'           // per-field provenance
}
```

### Cross-replay merging

A player's "team" is identified by a **fingerprint**: SHA-1 of the sorted
6 species IDs (forme-normalized to base forme so Mega reveals don't split a
team). Reveals from all replays sharing (userId, fingerprint) merge into one
`TeamProfile` with per-field provenance and counts:

- moves: union with usage counts (a 5th+ distinct move ⇒ likely a set
  variation — keep counts, flag it, never silently drop).
- item/ability: keep frequency map, surface the modal value.
- lead pairs and bring-4 combos: frequency tables.
- W/L, first-seen, last-seen, replay list.

The fingerprint also powers **alt correlation**: identical fingerprints under
different userIds within a format are surfaced as "possibly the same player"
(a suggestion in the UI, never asserted as fact).

## 5. Database schema (`schema.sql`, idempotent)

```sql
formats(id text pk, display_name, mechanics jsonb, active bool)
players(user_id text pk, display_name, first_seen, last_seen)
replays(id text pk, format_id fk, upload_time, rating int null,
        p1_user_id, p2_user_id, raw_json jsonb, parsed jsonb,
        parser_version int, fetched_at)
team_profiles(id uuid pk, user_id fk, format_id fk, fingerprint text,
        roster jsonb, merged_reveals jsonb, lead_pairs jsonb,
        brings jsonb, wins int, losses int,
        first_seen, last_seen, unique(user_id, format_id, fingerprint))
ladder_snapshots(id uuid pk, format_id fk, taken_at,
        standings jsonb)  -- [{rank, user_id, name, elo, gxe, glicko}]
scout_runs(id uuid pk, format_id, started_at, finished_at, trigger text,
        cursor jsonb, players_checked int, replays_found int,
        new_teams int, errors jsonb)
```

Notes: store `parser_version` so improved parsers can re-parse cached
`raw_json` without refetching (a `reparse` script is a required deliverable).
All writes are idempotent upserts on primary key.

## 6. Phase 1 — Scouter web app

Pages (server components reading Postgres; ad-hoc fetches go through the
same queue + cache as the cron):

1. **`/scout`** — input: one or more usernames, and/or pasted replay URLs;
   format selector (from `formats`); optional date range. Runs a scout
   (search → fetch new replays → parse → merge) and redirects to results.
2. **`/player/[userId]?format=`** — the core view. Team cards grouped by
   fingerprint: 6 sprites, merged sets in Showdown export text (one-click
   copy, Pokepaste-compatible), lead-pair table, bring-4 combos, W/L,
   Mega-slot usage, replay links, first/last seen.
3. **`/teams?format=`** — browse all known teams in the DB; filter by
   species ("show me every scouted team with Basculegion"); sort by last
   seen / owner rating.
4. **`/watch`** — Phase 2 dashboard (see §7).

Output fidelity rule: exported sets must round-trip through Showdown's
teambuilder import. Distinguish *confirmed* fields from *unknown* — never
fabricate EVs/natures; omit lines you don't know (the export format allows
partial sets). Provenance (sheet vs revealed) should be visible on hover.

Keep the UI utilitarian (tables + team cards). Follow the frontend-design
skill for styling, but function over polish in this phase.

## 7. Phase 2 — Ladder Watcher (cron)

Pipeline per run, for each active format:

1. Fetch ladder top 500 JSON; store a snapshot; take the **top 50**.
2. Diff against the previous snapshot (new names, big rating moves).
3. For each of the 50, replay-search `user=<id>&format=<formatid>`; fetch
   only replay IDs not already in `replays`.
4. Parse, merge into `team_profiles`.
5. Write a `scout_runs` row; surface "new finds since last run" on `/watch`.

**Vercel Hobby constraints (verified):** cron is once-daily max, 10 s
function timeout, no retries, GET only, must check
`Authorization: Bearer ${CRON_SECRET}`. Fifty players × paginated searches ×
polite delays will not fit in 10 s. Required design:

- The cron route is a **chunked worker**: each invocation processes as many
  players as fit in ~8 s, persisting a cursor (`scout_runs.cursor`), and
  returns; the next invocation resumes.
- To get multiple invocations per day, drive the same route with an external
  scheduler — **GitHub Actions on a schedule hitting the route with the
  bearer token** is the default choice (document the workflow YAML in the
  repo). Vercel Cron keeps the once-daily fallback trigger.
- A full top-50 pass completing within ~2 hours of wall-clock time via
  chunks is acceptable; this is a daily digest, not realtime.

`/watch` dashboard: last run status, coverage stats (how many of the top 50
have ≥1 public replay — expect a small minority), new teams feed, rating
trajectory per tracked name, and alt-correlation suggestions.

## 8. Build order

1. Bootstrap repo per the `nextjs-supabase-vercel-bootstrap` skill (harness
   docs, scaffold, `schema.sql`, `vercel.json`, env wiring).
2. Shared Showdown client: `toID()`, rate-limited fetch queue, typed
   endpoint wrappers. Verify the Champions format ID and seed `formats`.
3. Parser (`lib/scout/`) with fixtures: download 5–10 real Reg M-B replays
   (mix of: open-team-sheet game, Mega game, forfeit, tie, nicknamed
   Pokémon) into `test/fixtures/` and snapshot-test `ParsedReplay` against
   hand-checked expectations. This is the highest-value test surface in the
   project — invest here.
4. Merge layer + fingerprints, with unit tests for forme normalization.
5. Phase 1 UI (`/scout`, `/player`, `/teams`).
6. Phase 2 worker route + GitHub Actions scheduler + `/watch`.
7. `reparse` script and parser_version bump flow.

## 9. Non-goals (do not build now)

- Showdex fork / in-battle damage calc (Phase 3, separate effort).
- EV/nature/spread inference from damage numbers.
- Scraping anything without a JSON endpoint; no headless browsers.
- Usage-stats aggregation across the whole ladder (Pikalytics exists).
- Accounts/auth — this is a single-user personal tool.

## 10. Open questions to resolve during build (record answers in docs/ARCHITECTURE.md)

- Exact Champions format ID(s) and whether Reg M-A history is worth
  backfilling alongside M-B.
- Whether `search.json` supports combined `user+format` filtering in one
  query or requires client-side filtering of a user's replays by format.
- Whether Champions replays include `|showteam|` (open team sheets) on the
  official ladder; adjust provenance expectations accordingly.
- Whether ladder JSON exposes Glicko/GXE fields needed for the trajectory
  chart, and the actual field names.
