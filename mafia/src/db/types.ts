import { Role, Ruleset, Team } from "../game/model";

export type RecordedMatchStatus = "completed" | "aborted";

export interface RecordedMatchPlayer {
  discordUserId: string;
  displayName: string;
  seatNo: number;
  originalRole: Role;
  finalRole: Role;
  team: Team;
  isHost: boolean;
  isWinner: boolean;
  survived: boolean;
  deathReason: string | null;
}

export interface RecordedMatch {
  externalGameId: string;
  discordGuildId: string;
  guildName: string | null;
  ruleset: Ruleset;
  status: RecordedMatchStatus;
  winnerTeam: Team | null;
  endedReason: string | null;
  playerCount: number;
  createdAt: Date;
  startedAt: Date | null;
  endedAt: Date;
  players: RecordedMatchPlayer[];
}
