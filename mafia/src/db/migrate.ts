import { readFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { config } from "../config";
import { createPostgresPool } from "./postgres";

async function main(): Promise<void> {
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL 환경 변수가 필요합니다.");
  }

  const pool = createPostgresPool(config.databaseUrl, config.databaseSsl);

  try {
    const schemaPath = resolvePath(__dirname, "schema.sql");
    const schemaSql = await readFile(schemaPath, "utf8");
    await pool.query(schemaSql);
    console.log("database schema is up to date");
  } finally {
    await pool.end();
  }
}

void main().catch((error) => {
  console.error("failed to migrate database", error);
  process.exitCode = 1;
});
