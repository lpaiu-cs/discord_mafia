import { Pool, PoolConfig } from "pg";

export function createPostgresPool(connectionString: string, ssl: boolean): Pool {
  const config: PoolConfig = {
    connectionString,
  };

  if (ssl) {
    config.ssl = {
      rejectUnauthorized: false,
    };
  }

  return new Pool(config);
}
