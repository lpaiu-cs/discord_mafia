create table if not exists users (
  id bigserial primary key,
  discord_user_id text not null unique,
  latest_display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create index if not exists idx_matches_guild_ended_at on matches (discord_guild_id, ended_at desc);
create index if not exists idx_match_players_user on match_players (discord_user_id, match_id desc);
