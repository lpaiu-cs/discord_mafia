import { config } from "../config";
import { GameStatsStore, NoopGameStatsStore } from "./game-stats-store";
import { createPostgresPool } from "./postgres";
import { PostgresGameStatsStore } from "./postgres-game-stats-store";

export function createGameStatsStore(): GameStatsStore {
  if (!config.databaseUrl) {
    return new NoopGameStatsStore();
  }

  const pool = createPostgresPool(config.databaseUrl, config.databaseSsl);
  return new PostgresGameStatsStore(pool);
}
