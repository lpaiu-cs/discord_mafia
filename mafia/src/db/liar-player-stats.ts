import { RecordedLiarMatchStatus, RecordedLiarWinner } from "./liar-types";

export interface LiarPlayerLifetimeStats {
  matchesPlayed: number;
  cancelledMatches: number;
  wins: number;
  losses: number;
  liarMatches: number;
  citizenMatches: number;
  liarWins: number;
  citizenWins: number;
}

export interface LiarCategoryStat {
  categoryId: string;
  categoryLabel: string;
  plays: number;
  wins: number;
  losses: number;
}

export interface LiarStreakStats {
  currentWinStreak: number;
  bestWinStreak: number;
}

export interface LiarRecentMatch {
  externalGameId: string;
  mode: "modeA" | "modeB";
  guildName: string | null;
  categoryLabel: string;
  status: RecordedLiarMatchStatus;
  winner: RecordedLiarWinner;
  endedReason: string | null;
  playerCount: number;
  endedAt: Date;
  wasLiar: boolean;
  wasAccused: boolean;
  isWinner: boolean;
}

export interface LiarPlayerStats {
  discordUserId: string;
  latestDisplayName: string;
  lifetime: LiarPlayerLifetimeStats;
  streaks: LiarStreakStats;
  categoryStats: LiarCategoryStat[];
  recentMatches: LiarRecentMatch[];
}
