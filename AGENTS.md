<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# champscope

VGC-first Pokémon Showdown scouting suite for the Pokémon Champions era: replay scouter web app + scheduled ladder watcher building a persistent team database.

@docs/PRODUCT.md
@session-handoff.md

## Conventions
- TypeScript throughout; Next.js App Router; server components read Postgres directly.
- Pure, well-tested core: `lib/scout/` (parser + merge) has no I/O — both UI and cron call it.
- `toID()` (lowercase, strip non-alphanumerics) implemented once in a shared util; never reimplement inline.
- All DB writes are idempotent upserts on primary key; `schema.sql` is idempotent.
- Model TypeScript types from real API responses you inspected, never guessed field names.

## Hard constraints (never violate)
- **Politeness to Showdown**: single global serial queue, ≥600 ms between requests, honest User-Agent with contact URL, exponential backoff on 429/5xx (max 3 tries, then record failure in `scout_runs`).
- **Cache-first**: replay JSON is immutable — once fetched, NEVER refetch. Cron ingests to Postgres; UI reads Postgres.
- **Regulation-agnostic**: format ID, mechanics, display name live in the `formats` config — nothing in the parser assumes a specific regulation. Format IDs are verified at build time, never hardcoded from docs.
- **Sparse-data tolerant**: "no replays found" is a recorded result, never an error.
- **Export fidelity**: exported sets must round-trip Showdown teambuilder import; never fabricate EVs/natures — omit unknown lines.
- No bundled Pokémon assets (sprites/audio) — hotlink official Showdown client resources.
- No websockets, no scraping non-JSON endpoints, no headless browsers, no accounts/auth.
- Vercel Hobby: 10 s function timeout — cron route must be a chunked worker with a persisted cursor.

## Where to look
- Build spec (authoritative): CHAMPSCOPE.md
- Technical reference & gotchas: docs/ARCHITECTURE.md (read on demand)
