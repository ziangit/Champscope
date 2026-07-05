# Team sources — verified, planned for future implementation

> Research verified live on 2026-07-05. Every endpoint below was actually fetched
> and its response shape inspected. Decision: X/Twitter is NOT used (API paywalled;
> VGCPastes mirrors the teams that matter anyway).

## The shared foundation (build first)

One **set importer** that parses Showdown export text (the inverse of
`lib/scout/export.ts`) and files teams into the existing fingerprint space:

- `team_profiles.origin: 'replay' | 'paste' | 'tournament'` (new column; existing rows = 'replay')
- source metadata per imported team: source URL, creator/player, event, placing,
  record, rental code, date shared
- provenance: imported sets are sheet-grade (`source: 'sheet'`); EVs/nature only
  when the source provides them — never fabricated
- species-name normalization on top of `toID` (pokedata uses e.g. `"Basculegion [Male]"`)

All sources funnel through it. Ingest jobs share the polite queue + cache rules.

## Sources, in quality order

### 1. pokedata.ovh — official tournament team sheets (JSON API)

Machine-readable mirror of RK9's officially published open team sheets, with results.

- `GET https://www.pokedata.ovh/apiv2/vgc/tournaments`
  → 190 VG events: `{id, name, date, decklists, players, winners, tournamentStatus, roundNumbers, lastUpdated, rk9link}`
- `GET https://www.pokedata.ovh/apiv2/id/{rk9link}/decklists`
  → array with `tournament_data[division].data[]`:
  `{name, placing, record{wins,losses,ties}, decklist: [{id, name, ability, item, stat_alignment, badges[4 moves]}]}`
- NAIC 2026 verified: 1,096 masters sheets, champion first.
- No EVs (official OTS omit them). Nature = `stat_alignment`, moves = `badges`.
- Unknown endpoints return `{}` (not 404) — probe carefully.

### 2. VGCPastes repository — curated community teams with full EVs

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

## Also planned: live team matching (/match)

When facing an opponent on ladder, look up their previewed team in the DB:

- **Exact 6/6**: normalize via `baseFormeId` → `teamFingerprint` → unique-index
  lookup. An exact hit under a different username doubles as an alt suggestion.
- **Partial 4–5/6**: single overlap query — GIN index on `team_profiles.roster`,
  prefilter `roster ?| $species`, count intersection in SQL, `ORDER BY overlap
  DESC, last_seen DESC`, keep overlap ≥ 4.
- Delivery tiers: `/match` page + `GET /api/match?format=&species=` JSON route
  first; then an optional Tampermonkey userscript that reads team preview from
  the battle DOM and opens `/match` prefilled; Showdex-fork overlay stays Phase 3.
