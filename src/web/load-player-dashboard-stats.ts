import { GameStatsStore } from "../db/game-stats-store";
import { PlayerDashboardStats } from "../db/player-dashboard-stats";

export async function loadPlayerDashboardStats(
  gameStatsStore: GameStatsStore,
  discordUserId: string,
): Promise<PlayerDashboardStats | null> {
  if (!gameStatsStore.enabled) {
    return null;
  }

  try {
    return await gameStatsStore.getPlayerDashboardStats(discordUserId);
  } catch (error) {
    console.error(`failed to load player dashboard stats for ${discordUserId}`, error);
    return null;
  }
}
