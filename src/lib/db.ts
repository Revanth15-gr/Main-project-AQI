import "server-only";
import { Pool } from "pg";

let pool: Pool | undefined;

export function getDatabasePool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is missing. PostgreSQL is optional and only needed to persist CPCB station snapshots.");
  }

  if (!pool) {
    pool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return pool;
}
