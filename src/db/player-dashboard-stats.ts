import { Role, Ruleset, Team } from "../game/model";
import { RecordedMatchStatus } from "./types";

export interface PlayerLifetimeStats {
  matchesPlayed: number;
  wins: number;
  losses: number;
  mafiaWins: number;
  citizenWins: number;
}

export interface PlayerRoleStat {
  role: Role;
  plays: number;
  wins: number;
  losses: number;
}

export interface PlayerRecentMatch {
  externalGameId: string;
  guildName: string | null;
  ruleset: Ruleset;
  status: RecordedMatchStatus;
  winnerTeam: Team | null;
  endedReason: string | null;
  playerCount: number;
  endedAt: Date;
  originalRole: Role;
  finalRole: Role;
  team: Team;
  isWinner: boolean;
  survived: boolean;
  deathReason: string | null;
}

export interface PlayerDashboardStats {
  discordUserId: string;
  latestDisplayName: string;
  lifetime: PlayerLifetimeStats;
  roleStats: PlayerRoleStat[];
  recentMatches: PlayerRecentMatch[];
}
