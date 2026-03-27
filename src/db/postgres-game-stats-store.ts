import { Pool, PoolClient } from "pg";
import { MafiaGame } from "../game/game";
import { buildRecordedMatch } from "./match-record";
import { GameStatsStore } from "./game-stats-store";
import { PlayerDashboardStats, PlayerLifetimeStats, PlayerRecentMatch, PlayerRoleStat } from "./player-dashboard-stats";
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

  async recordEndedGame(game: MafiaGame): Promise<void> {
    const record = buildRecordedMatch(game);
    const client = await this.pool.connect();

    try {
      await client.query("begin");
      await upsertGuild(client, record);
      await upsertUsers(client, record.players);
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

async function upsertGuild(client: PoolClient, record: RecordedMatch): Promise<void> {
  await client.query(
    `
      insert into guilds (discord_guild_id, latest_name, created_at, updated_at)
      values ($1, $2, now(), now())
      on conflict (discord_guild_id) do update
      set latest_name = excluded.latest_name,
          updated_at = now()
    `,
    [record.discordGuildId, record.guildName],
  );
}

async function upsertUsers(client: PoolClient, players: RecordedMatchPlayer[]): Promise<void> {
  for (const player of players) {
    await client.query(
      `
        insert into users (discord_user_id, latest_display_name, created_at, updated_at)
        values ($1, $2, now(), now())
        on conflict (discord_user_id) do update
        set latest_display_name = excluded.latest_display_name,
            updated_at = now()
      `,
      [player.discordUserId, player.displayName],
    );
  }
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
