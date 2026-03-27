import { MafiaGame } from "../game/game";
import { PlayerDashboardStats } from "./player-dashboard-stats";

export interface GameStatsStore {
  readonly enabled: boolean;
  initialize(): Promise<void>;
  recordEndedGame(game: MafiaGame): Promise<void>;
  getPlayerDashboardStats(discordUserId: string): Promise<PlayerDashboardStats | null>;
  close(): Promise<void>;
}

export class NoopGameStatsStore implements GameStatsStore {
  readonly enabled = false;

  async initialize(): Promise<void> {
    return;
  }

  async recordEndedGame(_game: MafiaGame): Promise<void> {
    return;
  }

  async getPlayerDashboardStats(_discordUserId: string): Promise<PlayerDashboardStats | null> {
    return null;
  }

  async close(): Promise<void> {
    return;
  }
}
