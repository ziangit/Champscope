# Team sources — verified; foundation + sources 1–2 + /match IMPLEMENTED 2026-07-06

> Research verified live on 2026-07-05. Every endpoint below was actually fetched
> and its response shape inspected. Decision: X/Twitter is NOT used (API paywalled;
> VGCPastes mirrors the teams that matter anyway).
>
> **Status:** the shared foundation, VGCPastes, pokedata.ovh, and /match shipped
> 2026-07-06 (`lib/scout/import.ts`, `lib/sources/`, `lib/match.ts`,
> `/api/ingest/run` + `.github/workflows/ingest.yml` weekly). teamsheet.gg (§3)
> and Smogon chaos (§4) remain future work.

## The shared foundation (IMPLEMENTED)

One **set importer** (`lib/scout/import.ts`) that parses Showdown export text
(the inverse of `lib/scout/export.ts`) and files teams into the existing
fingerprint space:

- `team_profiles.origin: 'replay' | 'paste' | 'tournament'`; origin is part of
  the row identity `(user_id, format_id, fingerprint, origin)` so imported
  teams never contaminate replay-derived stats and `reparse` (which rebuilds
  only `origin='replay'`) can't destroy them.
- `team_profiles.sources jsonb` — per-team source metadata (`TeamSourceRef`:
  key, url, link, event, placing, record, rental code, creator, sharedAt).
  **The `key` is the dedupe identity**: every ingest is idempotent per key
  (paste URL / `pokedata:{rk9link}:{userId}`), checked against a GIN index.
- provenance: imported sets are sheet-grade (`source: 'sheet'`); EVs/nature only
  when the source provides them — never fabricated
- species-name normalization on top of `toID` (`normalizePokedataSpecies`;
  bracket vocabulary collected from real responses, e.g. `"Basculegion [Male]"`,
  `"Tauros [Paldean Form - Aqua Breed]"`)

All sources funnel through it. Ingest jobs share the per-host polite queue
(Showdown keeps its own single global lane) and run as a chunked cursor-resumable
worker (`/api/ingest/run`, weekly GH Actions `team-ingest`, 20 h pass cooldown).

## Sources, in quality order

### 1. pokedata.ovh — official tournament team sheets (JSON API) — IMPLEMENTED

Machine-readable mirror of RK9's officially published open team sheets, with results.

- `GET https://www.pokedata.ovh/apiv2/vgc/tournaments`
  → 190 VG events: `{id, name, date, decklists, players, winners, tournamentStatus, roundNumbers, lastUpdated, rk9link}`
- `GET https://www.pokedata.ovh/apiv2/id/{rk9link}/decklists`
  → array with `tournament_data[division].data[]`:
  `{name, placing, record{wins,losses,ties}, decklist: [{id, name, ability, item, stat_alignment, badges[4 moves]}]}`
- NAIC 2026 verified: 1,096 masters sheets, champion first.
- No EVs (official OTS omit them). Nature = `stat_alignment`, moves = `badges`.
- Unknown endpoints return `{}` (not 404) — probe carefully.
- **Regulation mapping (implemented in `lib/sources/config.ts`):** tournaments
  map to a format by date window. Grounded finding: the VGCPastes M-B tab's
  earliest entry is 17 Jun 2026, so every finished official event through NAIC
  (Jun 12–14) is **Reg M-A**, not M-B. The configured M-B window
  (`since 2026-06-15`) is empty today — Worlds 2026 and later M-B events ingest
  automatically. Backfilling M-A = one more window entry (still undecided).
- Masters division only; players without a published decklist are skipped;
  ingest is bulk-batched (100 sheets per 3 DB round-trips) so a 1,000-sheet
  event takes a handful of worker ticks.

### 2. VGCPastes repository — curated community teams with full EVs — IMPLEMENTED

- Google Sheet, one tab per regulation. Champions M-B tab (gid `1458357160`) of
  sheet `1axlwmzPA49rYkqXh7zHvAtSP-TKbM0ijGYBPRflLSWw`.
- No-auth CSV export: `https://docs.google.com/spreadsheets/d/<id>/export?format=csv&gid=<gid>`
- Verified: 386 teams, 386/386 with `pokepast.es` links, 327 marked "Extracted"
  (full EVs). Columns include creator, date, tournament/rank, source link, rental code.
- Follow with `https://pokepast.es/<pasteId>/json` → `{author, notes, paste}`;
  `notes` carries `Format: gen9championsvgc2026regmb`. Paste text is standard
  Showdown export → importer parses it directly.
- New regulations = new gid; keep (sheetId, gid, formatId) in config.

### 3. teamsheet.gg — ladder team reports (HTML, no API)

- Filterable listing: `https://teamsheet.gg/?format=vgcregmb&tag=&pokemon=` —
  31 report links/page (`/t/<slug>`), paginated.
- Report pages: usually a `pokepast.es` link (prefer it → JSON); always the full
  export text inline in HTML (fallback: regex the export block out).
- Requires static-HTML fetching. **Spec §9 amendment agreed**: polite static HTML
  fetch allowed (same serial queue); still no headless browsers.
- Needs a browser-like User-Agent (default curl UA gets 403 via Cloudflare) —
  keep identifying contact info in a custom header instead.

### 4. Smogon usage stats — per-mon priors + teammate graph (monthly)

- `https://www.smogon.com/stats/<YYYY-MM>/chaos/<formatId>-<cutoff>.json`
  (cutoffs 0/1500/1630/1760; verified for `gen9championsvgc2026regmb`, 13 MB, 1.16M battles, 275 mons)
- Per mon: weighted `Moves`, `Items`, `Abilities`, `Spreads`, `Tera Types`,
  `Teammates`, `Checks and Counters`.
- NOT full teams. Use for: set priors next to confirmed reveals (clearly labeled
  as aggregate inference, never merged into a player's confirmed data), a
  teammate co-occurrence graph, and "likely 4th move" hints.
- One fetch per month per cutoff; cache in a `usage_stats` table.

### 5. play.limitlesstcg.com — grassroots/online tournaments (later)

- Documented public API (no key for most endpoints): https://docs.limitlesstcg.com/developer.html
- Different pool from official majors; add after 1–4.

## Live team matching (/match) — IMPLEMENTED

When facing an opponent on ladder, look up their previewed team in the DB
(`lib/match.ts`, `/match` page, `GET /api/match?format=&species=`):

- **Exact 6/6**: normalize via `baseFormeId` → `teamFingerprint` → unique-index
  lookup. An exact hit under a different username doubles as an alt suggestion.
- **Partial 4–5/6**: single overlap query — the `match_teams(format, species[])`
  SQL function (schema.sql): GIN index on `team_profiles.roster`, prefilter
  `roster ?| $species`, count intersection in SQL, `ORDER BY overlap DESC,
  last_seen DESC`, keep overlap ≥ 4. O(candidates) with a constant 6×6
  intersection per row.
- Still future: an optional Tampermonkey userscript that reads team preview from
  the battle DOM and opens `/match` prefilled; Showdex-fork overlay stays Phase 3.

## Screenshot matching (designed 2026-07-06, not yet implemented)

Third input adapter for /match: a screenshot (Showdown preview, Champions
mobile/Switch team screen or battle preview) → LLM vision → species[] → the
existing `matchTeams`. Agreed design:

- Client downscales to ~1024 px JPEG; `POST /api/match/screenshot`.
- One vision call (Haiku-class, `ANTHROPIC_API_KEY` env) with **structured
  output**: `{recognized, species: [{name, confidence}], layout}`. Prompt:
  read the Pokémon, not the UI (Champions UI is post-cutoff); if the image is
  not a Pokémon team screen return `recognized: false`.
- **Server-side validation is the real fallback**: every name goes through
  `toID` and is checked against known species; if < 4 valid species survive →
  "not recognized" regardless of what the model said (hallucination guard).
  Note this guard alone is insufficient: Pokémon *artwork* can carry 6 valid
  names (see `negative-starter-illustration.png`) — the model's layout
  classification ("is this a team/battle screen?") is what must reject those.
- Extraction pre-fills the editable species input — human corrects misread
  slots (sprite-ambiguous formes: Maushold count, Basculegion gender, Rotom
  appliances, Urshifu style) before/after matching. 4-of-6 tier absorbs 1–2
  misreads anyway.
- Screenshots feed the query side only — never stored into the team DB.
- Open endpoint spends API money: add a minimal guard (shared secret in
  localStorage or per-IP rate limit); still no real auth.
- **Eval fixtures live in `test/fixtures/screenshots/`** (7 real screenshots +
  MANIFEST.json with ground truth where text names the mons and unverified
  candidates for sprite-only ones). Manual eval script once the API key is
  available; add non-Pokémon negatives before evaluating.
