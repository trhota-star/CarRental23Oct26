import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { requireEnv } from "../config";
import * as schema from "./schema";

let db: NodePgDatabase<typeof schema> | undefined;

/** Shared Drizzle client for DATABASE_URL. */
export function getDb(): NodePgDatabase<typeof schema> {
  db ??= drizzle({ client: new Pool({ connectionString: requireEnv("DATABASE_URL") }), schema });
  return db;
}
