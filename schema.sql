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
