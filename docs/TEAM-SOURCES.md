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

### 4b. MetaVGC featured events — community majors, full sets incl. EVs — IMPLEMENTED

- `metavgc.com/teams/featured/<slug>` embeds the complete team list (player,
  placement, sets with EV spreads) server-side in the Next.js flight payload —
  `lib/sources/metavgc.ts` parses it; events are configured in
  `METAVGC_EVENTS` (slug, formatId, event name, date). First ingested event:
  The Champions Arena II (Victory Road, Reg M-B, 24 teams) — the first
  `tournament`-origin teams in the current regulation. Species quirks handled:
  "Charizard Mega Y" → hyphenated, "Basculegion-M" → male base.
- Victory Road's own raw pastes (vrpastes.com, ~99 per event covering the
  whole field) load client-side via an undiscovered API — MetaVGC's top cut
  suffices for now; revisit if full-field coverage matters.

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

## Screenshot matching (IMPLEMENTED 2026-07-06 — EXPERIMENTAL, Showdown only)

> Status: shipped as an experimental pre-fill on /match (`lib/cv/`,
> `POST /api/match/screenshot`, upload button). Precision-first calibration:
> what it finds is usually right; crowded battle previews extract partially
> and the user completes the rest in the editable input (the designed UX).
> Scorecard + config in `test/fixtures/screenshots/MANIFEST.json`. Template
> data (`data/cv/*.json`, ~7 MB numeric signatures) regenerates with
> `npx tsx scripts/build-cv-templates.ts --cache <dir>` (sprites cache to
> disk; only the first run fetches). Hard-won findings: Showdown battle
> surfaces render `sprites/ani/` XY-style ANIMATED sprites (arbitrary frame
> on screen; 3 frames/species as templates), forme filenames are hyphenated
> (`spriteId()`), the player's side renders MIRRORED, preview sprites
> overlap/occlude each other, and grid-signature affine matching — even
> trimmed, scale-anchored, and margin-gated — cannot fully separate
> overlap-degraded true matches from fragment/texture fits. The deferred
> trained-model path (embedding gallery) is the durable fix for full recall.

Third input adapter for /match: **digital screenshots only — photos are out of
scope, and so is any LLM/API dependency.** Classical CV, ideally running
client-side so images never reach the server (publicly shareable, zero cost,
zero content risk). Species land in the existing editable input → `matchTeams`.

Supported inputs and their recognizers:

1. **Pokepaste / export text / species list** — already live.
2. **Showdown screenshots** (preview strip, side panel, battle preview):
   template matching against the known Showdown sprite sheets. Screenshots are
   pixel-faithful, so this is deterministic — no training, no model.
   *Asset-rule note:* sprite sheets are fetched at runtime and cached as
   internal recognition templates, never bundled or served — a deliberate,
   intent-preserving reading of the "no bundled Pokémon assets" rule.
3. **Champions mobile/Switch team screens with text** (see the ja fixtures):
   OCR on species names + a JA→EN species table; can also lift items/abilities
   /moves. **Must be anchored to Champions UI layout** (team header, tab
   labels, slot structure) — `negative-starter-illustration.png` proves that
   "OCR found species words" alone is insufficient (artwork carries valid
   names). The layout anchor is the reject gate.

Explicitly unsupported (fall back to manual entry in the editable input):

- **Photos of screens** — no special detection needed: the classical pipeline
  fails naturally on photo distortion → "not recognized — upload a screenshot,
  not a photo". (Solving photos would require an LLM vision call — cost/abuse
  /account-risk on an open endpoint — or a self-trained model whose real cost
  is a per-species Champions render gallery + photo-degradation synthetic
  data. Both evaluated 2026-07-06 and deliberately deferred; revisit only if
  screenshot-only proves too limiting.)
- **Champions render-only previews** (doubles select strip, vertical battle
  preview fixtures): no text, and template matching would need that same
  render gallery.

Shared rules regardless of recognizer:

- Validated-species tiers: >=4 → match (partial tier handles 4–5-mon
  screenshots natively); 1–3 → no auto-match, pre-fill and ask; 0 → "not
  recognized". Every extracted name is validated via `toID` against known
  species (lookalikes/fakemon fail here naturally).
- All failures collapse to one user-facing message; the image is never
  characterized, echoed, or persisted. Screenshots feed the query side only —
  never the team DB.
- Eval fixtures in `test/fixtures/screenshots/` (7 positives + 1 hard
  negative; MANIFEST.json marks which are in scope for which recognizer).
- **Eval fixtures live in `test/fixtures/screenshots/`** (7 real screenshots +
  MANIFEST.json with ground truth where text names the mons and unverified
  candidates for sprite-only ones). Manual eval script once the API key is
  available; add non-Pokémon negatives before evaluating.
