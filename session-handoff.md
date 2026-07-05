# Session handoff

**Current phase:** Build step 1 — bootstrap repo (harness docs, Next.js scaffold, `schema.sql`, `vercel.json`, env wiring)
**Next concrete step:** Scaffold the Next.js + TypeScript app, then build the shared Showdown client (`toID()`, rate-limited queue, typed endpoint wrappers) and verify the live Champions format ID.

## Done so far
- Harness docs created (CLAUDE.md, docs/PRODUCT.md, docs/ARCHITECTURE.md, this file).

## Open questions (record answers in docs/ARCHITECTURE.md as resolved)
- Exact Champions format ID(s); is Reg M-A history worth backfilling alongside M-B?
- Does `search.json` support combined `user+format` in one query, or is client-side filtering needed?
- Do Champions ladder replays include `|showteam|` (open team sheets)?
- Does ladder JSON expose Glicko/GXE fields (and their actual names) for the trajectory chart?
