create table if not exists users (
  id bigserial primary key,
  discord_user_id text not null unique,
  latest_display_name text not null,
  latest_guild_id text,
  latest_guild_name text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_played_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table users add column if not exists latest_guild_id text;
alter table users add column if not exists latest_guild_name text;
alter table users add column if not exists first_seen_at timestamptz;
alter table users add column if not exists last_seen_at timestamptz;
alter table users add column if not exists last_played_at timestamptz;
update users
set
  first_seen_at = coalesce(first_seen_at, created_at),
  last_seen_at = coalesce(last_seen_at, updated_at, created_at)
where first_seen_at is null or last_seen_at is null;
alter table users alter column first_seen_at set default now();
alter table users alter column last_seen_at set default now();
alter table users alter column first_seen_at set not null;
alter table users alter column last_seen_at set not null;

create table if not exists guilds (
  id bigserial primary key,
  discord_guild_id text not null unique,
  latest_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists matches (
  id bigserial primary key,
  external_game_id text not null unique,
  discord_guild_id text not null references guilds(discord_guild_id),
  ruleset text not null,
  status text not null check (status in ('completed', 'aborted')),
  winner_team text check (winner_team in ('mafia', 'citizen')),
  ended_reason text,
  player_count integer not null,
  created_at timestamptz not null,
  started_at timestamptz,
  ended_at timestamptz not null
);

create table if not exists match_players (
  id bigserial primary key,
  match_id bigint not null references matches(id) on delete cascade,
  discord_user_id text not null references users(discord_user_id),
  seat_no integer not null,
  display_name text not null,
  original_role text not null,
  final_role text not null,
  team text not null check (team in ('mafia', 'citizen')),
  is_host boolean not null,
  is_winner boolean not null,
  survived boolean not null,
  death_reason text,
  unique (match_id, discord_user_id)
);

create table if not exists player_lifetime_stats (
  discord_user_id text primary key references users(discord_user_id) on delete cascade,
  matches_played integer not null,
  wins integer not null,
  losses integer not null,
  mafia_wins integer not null,
  citizen_wins integer not null,
  updated_at timestamptz not null
);

create table if not exists player_role_stats (
  discord_user_id text not null references users(discord_user_id) on delete cascade,
  role text not null,
  plays integer not null,
  wins integer not null,
  losses integer not null,
  updated_at timestamptz not null,
  primary key (discord_user_id, role)
);

create table if not exists liar_matches (
  id bigserial primary key,
  external_game_id text not null unique,
  discord_guild_id text not null references guilds(discord_guild_id),
  mode text not null default 'modeA',
  category_id text not null,
  category_label text not null,
  secret_word text,
  liar_assigned_word text,
  status text not null check (status in ('completed', 'cancelled')),
  winner text check (winner in ('liar', 'citizens')),
  ended_reason text,
  guessed_word text,
  accused_user_id text references users(discord_user_id),
  player_count integer not null,
  created_at timestamptz not null,
  started_at timestamptz,
  ended_at timestamptz not null
);

create table if not exists liar_match_players (
  id bigserial primary key,
  liar_match_id bigint not null references liar_matches(id) on delete cascade,
  discord_user_id text not null references users(discord_user_id),
  display_name text not null,
  joined_order integer not null,
  is_host boolean not null,
  is_liar boolean not null,
  was_accused boolean not null,
  is_winner boolean not null,
  submitted_clue boolean not null,
  clue_order integer,
  vote_target_user_id text references users(discord_user_id),
  unique (liar_match_id, discord_user_id)
);

create table if not exists liar_player_lifetime_stats (
  discord_user_id text primary key references users(discord_user_id) on delete cascade,
  matches_played integer not null,
  wins integer not null,
  losses integer not null,
  liar_wins integer not null,
  citizen_wins integer not null,
  updated_at timestamptz not null
);

alter table liar_matches add column if not exists mode text;
update liar_matches set mode = coalesce(mode, 'modeA') where mode is null;
alter table liar_matches alter column mode set default 'modeA';
alter table liar_matches alter column mode set not null;
alter table liar_matches drop constraint if exists liar_matches_mode_check;
alter table liar_matches add constraint liar_matches_mode_check check (mode in ('modeA', 'modeB'));
alter table liar_matches add column if not exists liar_assigned_word text;

create index if not exists idx_matches_guild_ended_at on matches (discord_guild_id, ended_at desc);
create index if not exists idx_match_players_user on match_players (discord_user_id, match_id desc);
create index if not exists idx_liar_matches_guild_ended_at on liar_matches (discord_guild_id, ended_at desc);
create index if not exists idx_liar_match_players_user on liar_match_players (discord_user_id, liar_match_id desc);
