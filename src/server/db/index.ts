import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { requireEnv } from "../config";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
/** A transaction handle (same query API as Db). */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Anything that can run queries: the shared client or an open transaction. */
export type Executor = Db | Tx;

let pool: Pool | undefined;
let db: Db | undefined;

/** Shared Drizzle client for DATABASE_URL. */
export function getDb(): Db {
  if (!db) {
    pool = new Pool({ connectionString: requireEnv("DATABASE_URL"), max: Number(process.env.DATABASE_POOL_MAX ?? 10) });
    pool.on("error", (error) => console.error(JSON.stringify({ level: "error", event: "db.pool.error", message: error.message })));
    db = drizzle({ client: pool, schema });
  }
  return db;
}

/** Closes the shared pool (scripts and tests). */
export async function closeDb(): Promise<void> {
  const p = pool;
  pool = undefined;
  db = undefined;
  await p?.end();
}

export { schema };
