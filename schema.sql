-- champscope schema (idempotent — safe to re-run)
-- Apply with: psql $DATABASE_URL -f schema.sql, or paste into the Supabase SQL editor.

create table if not exists formats (
  id            text primary key,            -- e.g. 'gen9championsvgc2026regmb' (verified live, never guessed)
  display_name  text not null,               -- e.g. '[Gen 9 Champions] VGC 2026 Reg M-B'
  mechanics     jsonb not null default '{}', -- {mega: bool, tera: bool, openTeamSheets: bool, gameType, bestOfDefault, ...}
  active        boolean not null default true
);

create table if not exists players (
  user_id       text primary key,            -- toID(name)
  display_name  text not null,
  first_seen    timestamptz not null default now(),
  last_seen     timestamptz not null default now()
);

create table if not exists replays (
  id             text primary key,           -- e.g. 'gen9championsvgc2026regmb-2644520954'
  format_id      text not null references formats(id),
  upload_time    timestamptz not null,
  rating         integer,                    -- null when unrated
  p1_user_id     text not null references players(user_id),
  p2_user_id     text not null references players(user_id),
  raw_json       jsonb not null,             -- immutable: full replay JSON incl. log; never refetched
  parsed         jsonb not null,             -- ParsedReplay
  parser_version integer not null,
  fetched_at     timestamptz not null default now()
);
create index if not exists replays_format_idx on replays (format_id, upload_time desc);
create index if not exists replays_p1_idx on replays (p1_user_id);
create index if not exists replays_p2_idx on replays (p2_user_id);

create table if not exists team_profiles (
  id              uuid primary key default gen_random_uuid(),
  user_id         text not null references players(user_id),
  format_id       text not null references formats(id),
  fingerprint     text not null,             -- sha1 of sorted, base-forme-normalized 6 species ids
  roster          jsonb not null,            -- the 6 PokemonReveal summaries
  merged_reveals  jsonb not null,            -- per-mon merged sets with provenance + usage counts
  lead_pairs      jsonb not null default '{}',  -- {"speciesA+speciesB": count}
  brings          jsonb not null default '{}',  -- {"a+b+c+d": count}
  wins            integer not null default 0,
  losses          integer not null default 0,
  first_seen      timestamptz not null,
  last_seen       timestamptz not null,
  unique (user_id, format_id, fingerprint)
);
create index if not exists team_profiles_format_idx on team_profiles (format_id, last_seen desc);
create index if not exists team_profiles_fingerprint_idx on team_profiles (format_id, fingerprint);

-- Imported teams (pastes / tournament sheets) live alongside replay-observed
-- ones so /match is a single query, but stay separate rows: origin joins the
-- identity so `reparse` can rebuild replay rows without touching imports.
alter table team_profiles add column if not exists origin text not null default 'replay';
alter table team_profiles add column if not exists sources jsonb not null default '[]';
alter table team_profiles drop constraint if exists team_profiles_user_id_format_id_fingerprint_key;
create unique index if not exists team_profiles_identity_idx on team_profiles (user_id, format_id, fingerprint, origin);
-- Source-key dedupe (jsonb containment on [{"key": ...}]) + roster overlap for /match.
create index if not exists team_profiles_sources_gin on team_profiles using gin (sources jsonb_path_ops);
create index if not exists team_profiles_roster_gin on team_profiles using gin (roster);

-- Ladder-vs-unrated split, queryable in SQL: a replay-origin team is "ladder"
-- evidence only if at least one of its replays was rated. jsonpath @? is
-- immutable, so this can be a stored generated column.
alter table team_profiles add column if not exists has_rated boolean
  generated always as (merged_reveals @? '$.replays[*].rating ? (@ != null)') stored;
create index if not exists team_profiles_browse_idx on team_profiles (format_id, origin, has_rated, last_seen desc);

-- Chip counts for /teams: one scan, five numbers, honest totals.
create or replace function team_chip_counts(p_format_id text, p_species text default null)
returns table (total int, ladder int, unrated int, paste int, tournament int)
language sql stable as $$
  select count(*)::int,
         count(*) filter (where origin = 'replay' and has_rated)::int,
         count(*) filter (where origin = 'replay' and not has_rated)::int,
         count(*) filter (where origin = 'paste')::int,
         count(*) filter (where origin = 'tournament')::int
  from team_profiles
  where format_id = p_format_id
    and (p_species is null or roster ? p_species);
$$;

-- Partial team match: teams in a format sharing >= p_min_overlap species with
-- the (base-forme-normalized) input. GIN-prefiltered; the per-row intersection
-- is a constant 6x6. Ordered best-overlap-first, then most recent.
create or replace function match_teams(p_format_id text, p_species text[], p_min_overlap int default 4, p_limit int default 40)
returns table (overlap int, profile jsonb)
language sql stable as $$
  select o.overlap, to_jsonb(p) as profile
  from team_profiles p
  cross join lateral (
    select count(*)::int as overlap
    from jsonb_array_elements_text(p.roster) r
    where r = any (p_species)
  ) o
  where p.format_id = p_format_id
    and p.roster ?| p_species
    and o.overlap >= p_min_overlap
  order by o.overlap desc, p.last_seen desc
  limit p_limit;
$$;

create table if not exists ladder_snapshots (
  id         uuid primary key default gen_random_uuid(),
  format_id  text not null references formats(id),
  taken_at   timestamptz not null default now(),
  standings  jsonb not null                  -- [{rank, user_id, name, elo, gxe, glicko: {r, rd}}]
);
create index if not exists ladder_snapshots_format_idx on ladder_snapshots (format_id, taken_at desc);

create table if not exists scout_runs (
  id              uuid primary key default gen_random_uuid(),
  format_id       text not null,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  trigger         text not null,             -- 'cron' | 'gh-actions' | 'adhoc'
  cursor          jsonb,                     -- chunked-worker resume state; null once complete
  players_checked integer not null default 0,
  replays_found   integer not null default 0,
  new_teams       integer not null default 0,
  errors          jsonb not null default '[]'
);
create index if not exists scout_runs_format_idx on scout_runs (format_id, started_at desc);

-- The app connects as service_role through PostgREST; make sure it can reach
-- these tables regardless of how this file was applied (SQL editor vs psql).
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant execute on functions to service_role;

-- Seed the verified Champions formats (idempotent; display names/mechanics from
-- play.pokemonshowdown.com/data/formats.js, verified 2026-07-05).
insert into formats (id, display_name, mechanics, active) values
  ('gen9championsvgc2026regmb', '[Gen 9 Champions] VGC 2026 Reg M-B',
   '{"gameType":"doubles","mod":"champions","bestOfDefault":true,"openTeamSheets":true,"mega":true,"tera":false}', true),
  ('gen9championsvgc2026regma', '[Gen 9 Champions] VGC 2026 Reg M-A',
   '{"gameType":"doubles","mod":"champions","bestOfDefault":true,"openTeamSheets":true,"mega":true,"tera":false}', false)
on conflict (id) do update
  set display_name = excluded.display_name,
      mechanics    = excluded.mechanics;
