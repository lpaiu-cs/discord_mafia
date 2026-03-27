import { Pool, PoolClient } from "pg";
import { MafiaGame } from "../game/game";
import { buildRecordedMatch } from "./match-record";
import { GameStatsStore } from "./game-stats-store";
import { LiarCategoryStat, LiarPlayerStats, LiarRecentMatch } from "./liar-player-stats";
import { RecordedLiarMatch, RecordedLiarMatchPlayer } from "./liar-types";
import { PlayerDashboardStats, PlayerLifetimeStats, PlayerRecentMatch, PlayerRoleStat } from "./player-dashboard-stats";
import { EnsureUserProfileInput, UserProfile } from "./user-profile";
import { RecordedMatch, RecordedMatchPlayer } from "./types";

export class PostgresGameStatsStore implements GameStatsStore {
  readonly enabled = true;

  constructor(private readonly pool: Pool) {}

  async initialize(): Promise<void> {
    await this.pool.query("select 1");
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async ensureUserProfile(profile: EnsureUserProfileInput): Promise<void> {
    const client = await this.pool.connect();

    try {
      if (profile.discordGuildId) {
        await upsertGuildRecord(client, profile.discordGuildId, profile.guildName ?? null);
      }

      await upsertUserProfile(client, profile);
    } finally {
      client.release();
    }
  }

  async getUserProfile(discordUserId: string): Promise<UserProfile | null> {
    const result = await this.pool.query<UserProfileRow>(
      `
        select
          discord_user_id,
          latest_display_name,
          latest_guild_id,
          latest_guild_name,
          first_seen_at,
          last_seen_at,
          last_played_at
        from users
        where discord_user_id = $1
      `,
      [discordUserId],
    );

    const row = result.rows[0];
    return row ? mapUserProfileRow(row) : null;
  }

  async getPlayerDashboardStats(discordUserId: string): Promise<PlayerDashboardStats | null> {
    const summaryResult = await this.pool.query<PlayerSummaryRow>(
      `
        select
          u.discord_user_id,
          u.latest_display_name,
          coalesce(pls.matches_played, 0)::int as matches_played,
          coalesce(pls.wins, 0)::int as wins,
          coalesce(pls.losses, 0)::int as losses,
          coalesce(pls.mafia_wins, 0)::int as mafia_wins,
          coalesce(pls.citizen_wins, 0)::int as citizen_wins
        from users u
        left join player_lifetime_stats pls on pls.discord_user_id = u.discord_user_id
        where u.discord_user_id = $1
      `,
      [discordUserId],
    );

    const summaryRow = summaryResult.rows[0];
    if (!summaryRow) {
      return null;
    }

    const [roleStatsResult, recentMatchesResult] = await Promise.all([
      this.pool.query<PlayerRoleRow>(
        `
          select
            role,
            plays::int,
            wins::int,
            losses::int
          from player_role_stats
          where discord_user_id = $1
          order by plays desc, wins desc, role asc
        `,
        [discordUserId],
      ),
      this.pool.query<PlayerRecentMatchRow>(
        `
          select
            m.external_game_id,
            g.latest_name as guild_name,
            m.ruleset,
            m.status,
            m.winner_team,
            m.ended_reason,
            m.player_count::int,
            m.ended_at,
            mp.original_role,
            mp.final_role,
            mp.team,
            mp.is_winner,
            mp.survived,
            mp.death_reason
          from match_players mp
          join matches m on m.id = mp.match_id
          left join guilds g on g.discord_guild_id = m.discord_guild_id
          where mp.discord_user_id = $1
          order by m.ended_at desc, m.id desc
          limit 10
        `,
        [discordUserId],
      ),
    ]);

    return {
      discordUserId: summaryRow.discord_user_id,
      latestDisplayName: summaryRow.latest_display_name,
      lifetime: {
        matchesPlayed: summaryRow.matches_played,
        wins: summaryRow.wins,
        losses: summaryRow.losses,
        mafiaWins: summaryRow.mafia_wins,
        citizenWins: summaryRow.citizen_wins,
      },
      roleStats: roleStatsResult.rows.map(mapRoleStatRow),
      recentMatches: recentMatchesResult.rows.map(mapRecentMatchRow),
    };
  }

  async getLiarPlayerStats(discordUserId: string): Promise<LiarPlayerStats | null> {
    const summaryResult = await this.pool.query<LiarPlayerSummaryRow>(
      `
        select
          u.discord_user_id,
          u.latest_display_name,
          coalesce(stats.matches_played, 0)::int as matches_played,
          coalesce(stats.cancelled_matches, 0)::int as cancelled_matches,
          coalesce(stats.wins, 0)::int as wins,
          coalesce(stats.losses, 0)::int as losses,
          coalesce(stats.liar_matches, 0)::int as liar_matches,
          coalesce(stats.citizen_matches, 0)::int as citizen_matches,
          coalesce(stats.liar_wins, 0)::int as liar_wins,
          coalesce(stats.citizen_wins, 0)::int as citizen_wins
        from users u
        left join (
          select
            lmp.discord_user_id,
            count(*) filter (where lm.status = 'completed') as matches_played,
            count(*) filter (where lm.status = 'cancelled') as cancelled_matches,
            count(*) filter (where lm.status = 'completed' and lmp.is_winner) as wins,
            count(*) filter (where lm.status = 'completed' and not lmp.is_winner) as losses,
            count(*) filter (where lm.status = 'completed' and lmp.is_liar) as liar_matches,
            count(*) filter (where lm.status = 'completed' and not lmp.is_liar) as citizen_matches,
            count(*) filter (where lm.status = 'completed' and lmp.is_winner and lmp.is_liar) as liar_wins,
            count(*) filter (where lm.status = 'completed' and lmp.is_winner and not lmp.is_liar) as citizen_wins
          from liar_match_players lmp
          join liar_matches lm on lm.id = lmp.liar_match_id
          group by lmp.discord_user_id
        ) stats on stats.discord_user_id = u.discord_user_id
        where u.discord_user_id = $1
      `,
      [discordUserId],
    );

    const summaryRow = summaryResult.rows[0];
    if (!summaryRow) {
      return null;
    }

    const [recentMatchesResult, categoryStatsResult, streakHistoryResult] = await Promise.all([
      this.pool.query<LiarRecentMatchRow>(
        `
          select
            lm.external_game_id,
            lm.mode,
            g.latest_name as guild_name,
            lm.category_label,
            lm.status,
            lm.winner,
            lm.ended_reason,
            lm.player_count::int,
            lm.ended_at,
            lmp.is_liar,
            lmp.was_accused,
            lmp.is_winner
          from liar_match_players lmp
          join liar_matches lm on lm.id = lmp.liar_match_id
          left join guilds g on g.discord_guild_id = lm.discord_guild_id
          where lmp.discord_user_id = $1
          order by lm.ended_at desc, lm.id desc
          limit 10
        `,
        [discordUserId],
      ),
      this.pool.query<LiarCategoryStatRow>(
        `
          select
            lm.category_id,
            lm.category_label,
            count(*) filter (where lm.status = 'completed')::int as plays,
            count(*) filter (where lm.status = 'completed' and lmp.is_winner)::int as wins,
            count(*) filter (where lm.status = 'completed' and not lmp.is_winner)::int as losses
          from liar_match_players lmp
          join liar_matches lm on lm.id = lmp.liar_match_id
          where lmp.discord_user_id = $1
          group by lm.category_id, lm.category_label
          having count(*) filter (where lm.status = 'completed') > 0
          order by plays desc, wins desc, lm.category_label asc
          limit 5
        `,
        [discordUserId],
      ),
      this.pool.query<LiarStreakHistoryRow>(
        `
          select
            lm.ended_at,
            lmp.is_winner
          from liar_match_players lmp
          join liar_matches lm on lm.id = lmp.liar_match_id
          where lmp.discord_user_id = $1
            and lm.status = 'completed'
          order by lm.ended_at asc, lm.id asc
        `,
        [discordUserId],
      ),
    ]);

    return {
      discordUserId: summaryRow.discord_user_id,
      latestDisplayName: summaryRow.latest_display_name,
      lifetime: {
        matchesPlayed: summaryRow.matches_played,
        cancelledMatches: summaryRow.cancelled_matches,
        wins: summaryRow.wins,
        losses: summaryRow.losses,
        liarMatches: summaryRow.liar_matches,
        citizenMatches: summaryRow.citizen_matches,
        liarWins: summaryRow.liar_wins,
        citizenWins: summaryRow.citizen_wins,
      },
      streaks: calculateLiarStreaks(streakHistoryResult.rows),
      categoryStats: categoryStatsResult.rows.map(mapLiarCategoryStatRow),
      recentMatches: recentMatchesResult.rows.map(mapLiarRecentMatchRow),
    };
  }

  async recordEndedGame(game: MafiaGame): Promise<void> {
    const record = buildRecordedMatch(game);
    const client = await this.pool.connect();

    try {
      await client.query("begin");
      await upsertGuild(client, record);
      await upsertUsers(client, record);
      const matchId = await upsertMatch(client, record);
      await client.query("delete from match_players where match_id = $1", [matchId]);
      for (const player of record.players) {
        await insertMatchPlayer(client, matchId, player);
      }

      const affectedUserIds = [...new Set(record.players.map((player) => player.discordUserId))];
      for (const discordUserId of affectedUserIds) {
        await refreshLifetimeStats(client, discordUserId);
        await refreshRoleStats(client, discordUserId);
      }

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async recordEndedLiarGame(record: RecordedLiarMatch): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query("begin");
      await upsertGuild(client, {
        discordGuildId: record.discordGuildId,
        guildName: record.guildName,
      });
      await upsertUsersForLiarRecord(client, record);
      const liarMatchId = await upsertLiarMatch(client, record);
      await client.query("delete from liar_match_players where liar_match_id = $1", [liarMatchId]);
      for (const player of record.players) {
        await insertLiarMatchPlayer(client, liarMatchId, player);
      }

      const affectedUserIds = [...new Set(record.players.map((player) => player.discordUserId))];
      for (const discordUserId of affectedUserIds) {
        await refreshLiarLifetimeStats(client, discordUserId);
      }

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}

interface UserProfileRow {
  discord_user_id: string;
  latest_display_name: string;
  latest_guild_id: string | null;
  latest_guild_name: string | null;
  first_seen_at: Date;
  last_seen_at: Date;
  last_played_at: Date | null;
}

interface PlayerSummaryRow {
  discord_user_id: string;
  latest_display_name: string;
  matches_played: number;
  wins: number;
  losses: number;
  mafia_wins: number;
  citizen_wins: number;
}

interface LiarPlayerSummaryRow {
  discord_user_id: string;
  latest_display_name: string;
  matches_played: number;
  cancelled_matches: number;
  wins: number;
  losses: number;
  liar_matches: number;
  citizen_matches: number;
  liar_wins: number;
  citizen_wins: number;
}

interface PlayerRoleRow {
  role: PlayerRoleStat["role"];
  plays: number;
  wins: number;
  losses: number;
}

interface PlayerRecentMatchRow {
  external_game_id: string;
  guild_name: string | null;
  ruleset: PlayerRecentMatch["ruleset"];
  status: PlayerRecentMatch["status"];
  winner_team: PlayerRecentMatch["winnerTeam"];
  ended_reason: string | null;
  player_count: number;
  ended_at: Date;
  original_role: PlayerRecentMatch["originalRole"];
  final_role: PlayerRecentMatch["finalRole"];
  team: PlayerRecentMatch["team"];
  is_winner: boolean;
  survived: boolean;
  death_reason: string | null;
}

interface LiarRecentMatchRow {
  external_game_id: string;
  mode: LiarRecentMatch["mode"];
  guild_name: string | null;
  category_label: string;
  status: LiarRecentMatch["status"];
  winner: LiarRecentMatch["winner"];
  ended_reason: string | null;
  player_count: number;
  ended_at: Date;
  is_liar: boolean;
  was_accused: boolean;
  is_winner: boolean;
}

interface LiarCategoryStatRow {
  category_id: string;
  category_label: string;
  plays: number;
  wins: number;
  losses: number;
}

interface LiarStreakHistoryRow {
  ended_at: Date;
  is_winner: boolean;
}

function mapUserProfileRow(row: UserProfileRow): UserProfile {
  return {
    discordUserId: row.discord_user_id,
    latestDisplayName: row.latest_display_name,
    latestGuildId: row.latest_guild_id,
    latestGuildName: row.latest_guild_name,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    lastPlayedAt: row.last_played_at,
  };
}

function mapRoleStatRow(row: PlayerRoleRow): PlayerRoleStat {
  return {
    role: row.role,
    plays: row.plays,
    wins: row.wins,
    losses: row.losses,
  };
}

function mapRecentMatchRow(row: PlayerRecentMatchRow): PlayerRecentMatch {
  return {
    externalGameId: row.external_game_id,
    guildName: row.guild_name,
    ruleset: row.ruleset,
    status: row.status,
    winnerTeam: row.winner_team,
    endedReason: row.ended_reason,
    playerCount: row.player_count,
    endedAt: row.ended_at,
    originalRole: row.original_role,
    finalRole: row.final_role,
    team: row.team,
    isWinner: row.is_winner,
    survived: row.survived,
    deathReason: row.death_reason,
  };
}

function mapLiarRecentMatchRow(row: LiarRecentMatchRow): LiarRecentMatch {
  return {
    externalGameId: row.external_game_id,
    mode: row.mode,
    guildName: row.guild_name,
    categoryLabel: row.category_label,
    status: row.status,
    winner: row.winner,
    endedReason: row.ended_reason,
    playerCount: row.player_count,
    endedAt: row.ended_at,
    wasLiar: row.is_liar,
    wasAccused: row.was_accused,
    isWinner: row.is_winner,
  };
}

function mapLiarCategoryStatRow(row: LiarCategoryStatRow): LiarCategoryStat {
  return {
    categoryId: row.category_id,
    categoryLabel: row.category_label,
    plays: row.plays,
    wins: row.wins,
    losses: row.losses,
  };
}

function calculateLiarStreaks(rows: readonly LiarStreakHistoryRow[]): { currentWinStreak: number; bestWinStreak: number } {
  let bestWinStreak = 0;
  let runningWinStreak = 0;

  for (const row of rows) {
    if (row.is_winner) {
      runningWinStreak += 1;
      bestWinStreak = Math.max(bestWinStreak, runningWinStreak);
      continue;
    }

    runningWinStreak = 0;
  }

  let currentWinStreak = 0;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (!rows[index].is_winner) {
      break;
    }

    currentWinStreak += 1;
  }

  return {
    currentWinStreak,
    bestWinStreak,
  };
}

async function upsertGuild(client: PoolClient, record: { discordGuildId: string; guildName: string | null }): Promise<void> {
  await upsertGuildRecord(client, record.discordGuildId, record.guildName);
}

async function upsertUsers(client: PoolClient, record: RecordedMatch): Promise<void> {
  for (const player of record.players) {
    await upsertUserProfile(client, {
      discordUserId: player.discordUserId,
      displayName: player.displayName,
      discordGuildId: record.discordGuildId,
      guildName: record.guildName,
    }, {
      seenAt: record.endedAt,
      lastPlayedAt: record.endedAt,
    });
  }
}

async function upsertUsersForLiarRecord(client: PoolClient, record: RecordedLiarMatch): Promise<void> {
  for (const player of record.players) {
    await upsertUserProfile(
      client,
      {
        discordUserId: player.discordUserId,
        displayName: player.displayName,
        discordGuildId: record.discordGuildId,
        guildName: record.guildName,
      },
      {
        seenAt: record.endedAt,
        lastPlayedAt: record.endedAt,
      },
    );
  }
}

async function upsertGuildRecord(client: PoolClient, discordGuildId: string, guildName: string | null): Promise<void> {
  await client.query(
    `
      insert into guilds (discord_guild_id, latest_name, created_at, updated_at)
      values ($1, $2, now(), now())
      on conflict (discord_guild_id) do update
      set latest_name = excluded.latest_name,
          updated_at = now()
    `,
    [discordGuildId, guildName],
  );
}

interface UpsertUserProfileOptions {
  seenAt?: Date;
  lastPlayedAt?: Date | null;
}

async function upsertUserProfile(
  client: PoolClient,
  profile: EnsureUserProfileInput,
  options: UpsertUserProfileOptions = {},
): Promise<void> {
  const seenAt = options.seenAt ?? new Date();
  const lastPlayedAt = options.lastPlayedAt ?? null;

  await client.query(
    `
      insert into users (
        discord_user_id,
        latest_display_name,
        latest_guild_id,
        latest_guild_name,
        created_at,
        updated_at,
        first_seen_at,
        last_seen_at,
        last_played_at
      )
      values ($1, $2, $3, $4, now(), now(), $5, $5, $6)
      on conflict (discord_user_id) do update
      set latest_display_name = excluded.latest_display_name,
          latest_guild_id = coalesce(excluded.latest_guild_id, users.latest_guild_id),
          latest_guild_name = case
            when excluded.latest_guild_id is not null then excluded.latest_guild_name
            else users.latest_guild_name
          end,
          updated_at = now(),
          last_seen_at = greatest(users.last_seen_at, excluded.last_seen_at),
          last_played_at = case
            when excluded.last_played_at is null then users.last_played_at
            when users.last_played_at is null then excluded.last_played_at
            else greatest(users.last_played_at, excluded.last_played_at)
          end
    `,
    [
      profile.discordUserId,
      profile.displayName,
      profile.discordGuildId ?? null,
      profile.guildName ?? null,
      seenAt,
      lastPlayedAt,
    ],
  );
}

async function upsertMatch(client: PoolClient, record: RecordedMatch): Promise<number> {
  const result = await client.query<{ id: number }>(
    `
      insert into matches (
        external_game_id,
        discord_guild_id,
        ruleset,
        status,
        winner_team,
        ended_reason,
        player_count,
        created_at,
        started_at,
        ended_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      on conflict (external_game_id) do update
      set discord_guild_id = excluded.discord_guild_id,
          ruleset = excluded.ruleset,
          status = excluded.status,
          winner_team = excluded.winner_team,
          ended_reason = excluded.ended_reason,
          player_count = excluded.player_count,
          created_at = excluded.created_at,
          started_at = excluded.started_at,
          ended_at = excluded.ended_at
      returning id
    `,
    [
      record.externalGameId,
      record.discordGuildId,
      record.ruleset,
      record.status,
      record.winnerTeam,
      record.endedReason,
      record.playerCount,
      record.createdAt,
      record.startedAt,
      record.endedAt,
    ],
  );

  return result.rows[0].id;
}

async function insertMatchPlayer(client: PoolClient, matchId: number, player: RecordedMatchPlayer): Promise<void> {
  await client.query(
    `
      insert into match_players (
        match_id,
        discord_user_id,
        seat_no,
        display_name,
        original_role,
        final_role,
        team,
        is_host,
        is_winner,
        survived,
        death_reason
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `,
    [
      matchId,
      player.discordUserId,
      player.seatNo,
      player.displayName,
      player.originalRole,
      player.finalRole,
      player.team,
      player.isHost,
      player.isWinner,
      player.survived,
      player.deathReason,
    ],
  );
}

async function upsertLiarMatch(client: PoolClient, record: RecordedLiarMatch): Promise<number> {
  const result = await client.query<{ id: number }>(
    `
      insert into liar_matches (
        external_game_id,
        discord_guild_id,
        mode,
        category_id,
        category_label,
        secret_word,
        liar_assigned_word,
        status,
        winner,
        ended_reason,
        guessed_word,
        accused_user_id,
        player_count,
        created_at,
        started_at,
        ended_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      on conflict (external_game_id) do update
      set discord_guild_id = excluded.discord_guild_id,
          mode = excluded.mode,
          category_id = excluded.category_id,
          category_label = excluded.category_label,
          secret_word = excluded.secret_word,
          liar_assigned_word = excluded.liar_assigned_word,
          status = excluded.status,
          winner = excluded.winner,
          ended_reason = excluded.ended_reason,
          guessed_word = excluded.guessed_word,
          accused_user_id = excluded.accused_user_id,
          player_count = excluded.player_count,
          created_at = excluded.created_at,
          started_at = excluded.started_at,
          ended_at = excluded.ended_at
      returning id
    `,
    [
      record.externalGameId,
      record.discordGuildId,
      record.mode,
      record.categoryId,
      record.categoryLabel,
      record.secretWord,
      record.liarAssignedWord,
      record.status,
      record.winner,
      record.endedReason,
      record.guessedWord,
      record.accusedUserId,
      record.playerCount,
      record.createdAt,
      record.startedAt,
      record.endedAt,
    ],
  );

  return result.rows[0].id;
}

async function insertLiarMatchPlayer(client: PoolClient, liarMatchId: number, player: RecordedLiarMatchPlayer): Promise<void> {
  await client.query(
    `
      insert into liar_match_players (
        liar_match_id,
        discord_user_id,
        display_name,
        joined_order,
        is_host,
        is_liar,
        was_accused,
        is_winner,
        submitted_clue,
        clue_order,
        vote_target_user_id
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `,
    [
      liarMatchId,
      player.discordUserId,
      player.displayName,
      player.joinedOrder,
      player.isHost,
      player.isLiar,
      player.wasAccused,
      player.isWinner,
      player.submittedClue,
      player.clueOrder,
      player.voteTargetUserId,
    ],
  );
}

async function refreshLifetimeStats(client: PoolClient, discordUserId: string): Promise<void> {
  await client.query(
    `
      insert into player_lifetime_stats (
        discord_user_id,
        matches_played,
        wins,
        losses,
        mafia_wins,
        citizen_wins,
        updated_at
      )
      select
        u.discord_user_id,
        coalesce(count(*) filter (where m.status = 'completed'), 0)::int as matches_played,
        coalesce(count(*) filter (where m.status = 'completed' and mp.is_winner), 0)::int as wins,
        coalesce(count(*) filter (where m.status = 'completed' and not mp.is_winner), 0)::int as losses,
        coalesce(count(*) filter (where m.status = 'completed' and mp.is_winner and mp.team = 'mafia'), 0)::int as mafia_wins,
        coalesce(count(*) filter (where m.status = 'completed' and mp.is_winner and mp.team = 'citizen'), 0)::int as citizen_wins,
        now()
      from users u
      left join match_players mp on mp.discord_user_id = u.discord_user_id
      left join matches m on m.id = mp.match_id
      where u.discord_user_id = $1
      group by u.discord_user_id
      on conflict (discord_user_id) do update
      set matches_played = excluded.matches_played,
          wins = excluded.wins,
          losses = excluded.losses,
          mafia_wins = excluded.mafia_wins,
          citizen_wins = excluded.citizen_wins,
          updated_at = excluded.updated_at
    `,
    [discordUserId],
  );
}

async function refreshRoleStats(client: PoolClient, discordUserId: string): Promise<void> {
  await client.query("delete from player_role_stats where discord_user_id = $1", [discordUserId]);
  await client.query(
    `
      insert into player_role_stats (
        discord_user_id,
        role,
        plays,
        wins,
        losses,
        updated_at
      )
      select
        mp.discord_user_id,
        mp.original_role as role,
        count(*) filter (where m.status = 'completed')::int as plays,
        count(*) filter (where m.status = 'completed' and mp.is_winner)::int as wins,
        count(*) filter (where m.status = 'completed' and not mp.is_winner)::int as losses,
        now()
      from match_players mp
      join matches m on m.id = mp.match_id
      where mp.discord_user_id = $1
      group by mp.discord_user_id, mp.original_role
      having count(*) filter (where m.status = 'completed') > 0
    `,
    [discordUserId],
  );
}

async function refreshLiarLifetimeStats(client: PoolClient, discordUserId: string): Promise<void> {
  await client.query(
    `
      insert into liar_player_lifetime_stats (
        discord_user_id,
        matches_played,
        wins,
        losses,
        liar_wins,
        citizen_wins,
        updated_at
      )
      select
        u.discord_user_id,
        coalesce(count(*) filter (where lm.status = 'completed'), 0)::int as matches_played,
        coalesce(count(*) filter (where lm.status = 'completed' and lmp.is_winner), 0)::int as wins,
        coalesce(count(*) filter (where lm.status = 'completed' and not lmp.is_winner), 0)::int as losses,
        coalesce(count(*) filter (where lm.status = 'completed' and lmp.is_winner and lmp.is_liar), 0)::int as liar_wins,
        coalesce(count(*) filter (where lm.status = 'completed' and lmp.is_winner and not lmp.is_liar), 0)::int as citizen_wins,
        now()
      from users u
      left join liar_match_players lmp on lmp.discord_user_id = u.discord_user_id
      left join liar_matches lm on lm.id = lmp.liar_match_id
      where u.discord_user_id = $1
      group by u.discord_user_id
      on conflict (discord_user_id) do update
      set matches_played = excluded.matches_played,
          wins = excluded.wins,
          losses = excluded.losses,
          liar_wins = excluded.liar_wins,
          citizen_wins = excluded.citizen_wins,
          updated_at = excluded.updated_at
    `,
    [discordUserId],
  );
}
