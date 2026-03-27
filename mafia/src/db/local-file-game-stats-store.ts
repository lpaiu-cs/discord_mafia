import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { MafiaGame } from "../game/game";
import { buildRecordedMatch } from "./match-record";
import { GameStatsStore } from "./game-stats-store";
import { LiarCategoryStat, LiarPlayerStats, LiarRecentMatch } from "./liar-player-stats";
import { RecordedLiarMatch, RecordedLiarMatchPlayer } from "./liar-types";
import { PlayerDashboardStats, PlayerRecentMatch, PlayerRoleStat } from "./player-dashboard-stats";
import { RecordedMatch, RecordedMatchPlayer } from "./types";
import { EnsureUserProfileInput, UserProfile } from "./user-profile";

interface LocalStatsData {
  version: 1;
  users: Record<string, UserProfile>;
  mafiaMatches: RecordedMatch[];
  liarMatches: RecordedLiarMatch[];
}

export class LocalFileGameStatsStore implements GameStatsStore {
  readonly enabled = true;
  private data: LocalStatsData = createEmptyData();

  constructor(private readonly filePath = resolve(process.cwd(), "mafia", "runtime-data", "game-stats.json")) {}

  async initialize(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      this.data = parseLocalStatsData(JSON.parse(raw) as unknown);
    } catch (error) {
      if (isMissingFileError(error)) {
        await this.persist();
        return;
      }

      throw error;
    }
  }

  async close(): Promise<void> {
    await this.persist();
  }

  async ensureUserProfile(profile: EnsureUserProfileInput): Promise<void> {
    const existing = this.data.users[profile.discordUserId] ?? null;
    const now = new Date();
    this.data.users[profile.discordUserId] = {
      discordUserId: profile.discordUserId,
      latestDisplayName: profile.displayName,
      latestGuildId: profile.discordGuildId ?? existing?.latestGuildId ?? null,
      latestGuildName: profile.guildName ?? existing?.latestGuildName ?? null,
      firstSeenAt: existing?.firstSeenAt ?? now,
      lastSeenAt: now,
      lastPlayedAt: existing?.lastPlayedAt ?? null,
    };
    await this.persist();
  }

  async getUserProfile(discordUserId: string): Promise<UserProfile | null> {
    return cloneUserProfile(this.data.users[discordUserId] ?? null);
  }

  async recordEndedGame(game: MafiaGame): Promise<void> {
    const record = buildRecordedMatch(game);
    upsertRecordedMatch(this.data.mafiaMatches, record);
    for (const player of record.players) {
      upsertUserFromMatchPlayer(this.data.users, record, player, record.endedAt);
    }
    await this.persist();
  }

  async recordEndedLiarGame(record: RecordedLiarMatch): Promise<void> {
    upsertRecordedLiarMatch(this.data.liarMatches, record);
    for (const player of record.players) {
      upsertUserFromLiarPlayer(this.data.users, record, player, record.endedAt);
    }
    await this.persist();
  }

  async getPlayerDashboardStats(discordUserId: string): Promise<PlayerDashboardStats | null> {
    const profile = this.data.users[discordUserId] ?? null;
    if (!profile) {
      return null;
    }

    const playerMatches = this.data.mafiaMatches
      .map((match) => ({ match, player: match.players.find((entry) => entry.discordUserId === discordUserId) ?? null }))
      .filter((entry): entry is { match: RecordedMatch; player: RecordedMatchPlayer } => Boolean(entry.player));

    const completedMatches = playerMatches.filter((entry) => entry.match.status === "completed");
    const roleStatsByRole = new Map<PlayerRoleStat["role"], PlayerRoleStat>();
    for (const entry of completedMatches) {
      const current = roleStatsByRole.get(entry.player.originalRole) ?? {
        role: entry.player.originalRole,
        plays: 0,
        wins: 0,
        losses: 0,
      };
      current.plays += 1;
      current.wins += entry.player.isWinner ? 1 : 0;
      current.losses += entry.player.isWinner ? 0 : 1;
      roleStatsByRole.set(entry.player.originalRole, current);
    }

    return {
      discordUserId,
      latestDisplayName: profile.latestDisplayName,
      lifetime: {
        matchesPlayed: completedMatches.length,
        wins: completedMatches.filter((entry) => entry.player.isWinner).length,
        losses: completedMatches.filter((entry) => !entry.player.isWinner).length,
        mafiaWins: completedMatches.filter((entry) => entry.player.isWinner && entry.player.team === "mafia").length,
        citizenWins: completedMatches.filter((entry) => entry.player.isWinner && entry.player.team === "citizen").length,
      },
      roleStats: [...roleStatsByRole.values()].sort((left, right) => {
        if (right.plays !== left.plays) {
          return right.plays - left.plays;
        }

        if (right.wins !== left.wins) {
          return right.wins - left.wins;
        }

        return left.role.localeCompare(right.role);
      }),
      recentMatches: playerMatches
        .sort(compareEndedAtDesc)
        .slice(0, 10)
        .map(({ match, player }): PlayerRecentMatch => ({
          externalGameId: match.externalGameId,
          guildName: match.guildName,
          ruleset: match.ruleset,
          status: match.status,
          winnerTeam: match.winnerTeam,
          endedReason: match.endedReason,
          playerCount: match.playerCount,
          endedAt: new Date(match.endedAt),
          originalRole: player.originalRole,
          finalRole: player.finalRole,
          team: player.team,
          isWinner: player.isWinner,
          survived: player.survived,
          deathReason: player.deathReason,
        })),
    };
  }

  async getLiarPlayerStats(discordUserId: string): Promise<LiarPlayerStats | null> {
    const profile = this.data.users[discordUserId] ?? null;
    if (!profile) {
      return null;
    }

    const playerMatches = this.data.liarMatches
      .map((match) => ({ match, player: match.players.find((entry) => entry.discordUserId === discordUserId) ?? null }))
      .filter((entry): entry is { match: RecordedLiarMatch; player: RecordedLiarMatchPlayer } => Boolean(entry.player));

    const completedMatches = playerMatches.filter((entry) => entry.match.status === "completed");
    const categoryStatsById = new Map<string, LiarCategoryStat>();
    for (const entry of completedMatches) {
      const current = categoryStatsById.get(entry.match.categoryId) ?? {
        categoryId: entry.match.categoryId,
        categoryLabel: entry.match.categoryLabel,
        plays: 0,
        wins: 0,
        losses: 0,
      };
      current.plays += 1;
      current.wins += entry.player.isWinner ? 1 : 0;
      current.losses += entry.player.isWinner ? 0 : 1;
      categoryStatsById.set(entry.match.categoryId, current);
    }

    const streaks = calculateLiarStreaks(
      completedMatches
        .slice()
        .sort(compareEndedAtAsc)
        .map((entry) => ({ endedAt: entry.match.endedAt, isWinner: entry.player.isWinner })),
    );

    return {
      discordUserId,
      latestDisplayName: profile.latestDisplayName,
      lifetime: {
        matchesPlayed: completedMatches.length,
        cancelledMatches: playerMatches.filter((entry) => entry.match.status === "cancelled").length,
        wins: completedMatches.filter((entry) => entry.player.isWinner).length,
        losses: completedMatches.filter((entry) => !entry.player.isWinner).length,
        liarMatches: completedMatches.filter((entry) => entry.player.isLiar).length,
        citizenMatches: completedMatches.filter((entry) => !entry.player.isLiar).length,
        liarWins: completedMatches.filter((entry) => entry.player.isLiar && entry.player.isWinner).length,
        citizenWins: completedMatches.filter((entry) => !entry.player.isLiar && entry.player.isWinner).length,
      },
      streaks,
      categoryStats: [...categoryStatsById.values()]
        .sort((left, right) => {
          if (right.plays !== left.plays) {
            return right.plays - left.plays;
          }

          if (right.wins !== left.wins) {
            return right.wins - left.wins;
          }

          return left.categoryLabel.localeCompare(right.categoryLabel);
        })
        .slice(0, 5),
      recentMatches: playerMatches
        .sort(compareEndedAtDesc)
        .slice(0, 10)
        .map(({ match, player }): LiarRecentMatch => ({
          externalGameId: match.externalGameId,
          mode: match.mode,
          guildName: match.guildName,
          categoryLabel: match.categoryLabel,
          status: match.status,
          winner: match.winner,
          endedReason: match.endedReason,
          playerCount: match.playerCount,
          endedAt: new Date(match.endedAt),
          wasLiar: player.isLiar,
          wasAccused: player.wasAccused,
          isWinner: player.isWinner,
        })),
    };
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempFilePath = `${this.filePath}.tmp`;
    await writeFile(tempFilePath, JSON.stringify(this.data, null, 2), "utf8");
    await rename(tempFilePath, this.filePath);
  }
}

function createEmptyData(): LocalStatsData {
  return {
    version: 1,
    users: {},
    mafiaMatches: [],
    liarMatches: [],
  };
}

function parseLocalStatsData(raw: unknown): LocalStatsData {
  const source = raw as Partial<{
    version: unknown;
    users: Record<string, unknown>;
    mafiaMatches: unknown[];
    liarMatches: unknown[];
  }>;

  const users: Record<string, UserProfile> = {};
  for (const [discordUserId, value] of Object.entries(source.users ?? {})) {
    const profile = value as Partial<UserProfile> & {
      firstSeenAt?: string | Date;
      lastSeenAt?: string | Date;
      lastPlayedAt?: string | Date | null;
    };
    users[discordUserId] = {
      discordUserId,
      latestDisplayName: profile.latestDisplayName ?? discordUserId,
      latestGuildId: profile.latestGuildId ?? null,
      latestGuildName: profile.latestGuildName ?? null,
      firstSeenAt: new Date(profile.firstSeenAt ?? Date.now()),
      lastSeenAt: new Date(profile.lastSeenAt ?? Date.now()),
      lastPlayedAt: profile.lastPlayedAt ? new Date(profile.lastPlayedAt) : null,
    };
  }

  return {
    version: 1,
    users,
    mafiaMatches: Array.isArray(source.mafiaMatches) ? source.mafiaMatches.map(deserializeRecordedMatch) : [],
    liarMatches: Array.isArray(source.liarMatches) ? source.liarMatches.map(deserializeRecordedLiarMatch) : [],
  };
}

function deserializeRecordedMatch(raw: unknown): RecordedMatch {
  const value = raw as RecordedMatch & {
    createdAt: string | Date;
    startedAt: string | Date | null;
    endedAt: string | Date;
  };
  return {
    ...value,
    createdAt: new Date(value.createdAt),
    startedAt: value.startedAt ? new Date(value.startedAt) : null,
    endedAt: new Date(value.endedAt),
  };
}

function deserializeRecordedLiarMatch(raw: unknown): RecordedLiarMatch {
  const value = raw as RecordedLiarMatch & {
    createdAt: string | Date;
    startedAt: string | Date | null;
    endedAt: string | Date;
  };
  return {
    ...value,
    createdAt: new Date(value.createdAt),
    startedAt: value.startedAt ? new Date(value.startedAt) : null,
    endedAt: new Date(value.endedAt),
  };
}

function cloneUserProfile(profile: UserProfile | null): UserProfile | null {
  if (!profile) {
    return null;
  }

  return {
    ...profile,
    firstSeenAt: new Date(profile.firstSeenAt),
    lastSeenAt: new Date(profile.lastSeenAt),
    lastPlayedAt: profile.lastPlayedAt ? new Date(profile.lastPlayedAt) : null,
  };
}

function upsertRecordedMatch(matches: RecordedMatch[], record: RecordedMatch): void {
  const index = matches.findIndex((entry) => entry.externalGameId === record.externalGameId);
  if (index === -1) {
    matches.push(record);
    return;
  }

  matches[index] = record;
}

function upsertRecordedLiarMatch(matches: RecordedLiarMatch[], record: RecordedLiarMatch): void {
  const index = matches.findIndex((entry) => entry.externalGameId === record.externalGameId);
  if (index === -1) {
    matches.push(record);
    return;
  }

  matches[index] = record;
}

function upsertUserFromMatchPlayer(
  users: Record<string, UserProfile>,
  record: RecordedMatch,
  player: RecordedMatchPlayer,
  playedAt: Date,
): void {
  const existing = users[player.discordUserId] ?? null;
  users[player.discordUserId] = {
    discordUserId: player.discordUserId,
    latestDisplayName: player.displayName,
    latestGuildId: record.discordGuildId,
    latestGuildName: record.guildName,
    firstSeenAt: existing?.firstSeenAt ?? playedAt,
    lastSeenAt: playedAt,
    lastPlayedAt: playedAt,
  };
}

function upsertUserFromLiarPlayer(
  users: Record<string, UserProfile>,
  record: RecordedLiarMatch,
  player: RecordedLiarMatchPlayer,
  playedAt: Date,
): void {
  const existing = users[player.discordUserId] ?? null;
  users[player.discordUserId] = {
    discordUserId: player.discordUserId,
    latestDisplayName: player.displayName,
    latestGuildId: record.discordGuildId,
    latestGuildName: record.guildName,
    firstSeenAt: existing?.firstSeenAt ?? playedAt,
    lastSeenAt: playedAt,
    lastPlayedAt: playedAt,
  };
}

function compareEndedAtDesc<T extends { match: { endedAt: Date; externalGameId: string } }>(left: T, right: T): number {
  const diff = right.match.endedAt.getTime() - left.match.endedAt.getTime();
  if (diff !== 0) {
    return diff;
  }

  return right.match.externalGameId.localeCompare(left.match.externalGameId);
}

function compareEndedAtAsc<T extends { match: { endedAt: Date; externalGameId: string } }>(left: T, right: T): number {
  const diff = left.match.endedAt.getTime() - right.match.endedAt.getTime();
  if (diff !== 0) {
    return diff;
  }

  return left.match.externalGameId.localeCompare(right.match.externalGameId);
}

function calculateLiarStreaks(
  rows: ReadonlyArray<{ endedAt: Date; isWinner: boolean }>,
): { currentWinStreak: number; bestWinStreak: number } {
  let bestWinStreak = 0;
  let runningWinStreak = 0;

  for (const row of rows) {
    if (row.isWinner) {
      runningWinStreak += 1;
      bestWinStreak = Math.max(bestWinStreak, runningWinStreak);
      continue;
    }

    runningWinStreak = 0;
  }

  return {
    currentWinStreak: runningWinStreak,
    bestWinStreak,
  };
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
