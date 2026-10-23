// Drops and recreates driveeasy_test, applies every migration from zero, then
// seeds (when scripts/seed.ts exists). Used by the Vitest integration global
// setup, the Playwright global setup, and `pnpm test:db:reset`.
//
// SAFETY: refuses to touch any database whose name does not end in "_test".

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";

// All test runners (vitest, playwright, tsx) are started from the repo root.
const ROOT = process.cwd();

export function loadEnv(): void {
  const file = path.join(ROOT, ".env.local");
  if (existsSync(file)) process.loadEnvFile(file);
}

export function testDatabaseUrl(): string {
  loadEnv();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set (.env.local)");
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith("_test")) throw new Error(`Refusing to reset non-test database "${name}"`);
  return url;
}

export type ResetOptions = { seed?: boolean; log?: (msg: string) => void };

export async function resetTestDatabase(opts: ResetOptions = {}): Promise<void> {
  const log = opts.log ?? (() => {});
  const url = testDatabaseUrl();
  const dbName = new URL(url).pathname.slice(1);
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";

  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }
  log(`recreated ${dbName}`);

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await pool.query("CREATE EXTENSION IF NOT EXISTS btree_gist");
    await migrate(drizzle({ client: pool }), { migrationsFolder: path.join(ROOT, "drizzle") });
  } finally {
    await pool.end();
  }
  log(`migrations applied to ${dbName}`);

  if (opts.seed !== false) await seedTestDatabase(log);
}

export function seedScriptExists(): boolean {
  return existsSync(path.join(ROOT, "scripts", "seed.ts"));
}

/** Runs `tsx scripts/seed.ts --test` (the DB agent's seed). No-op until it exists. */
export async function seedTestDatabase(log: (msg: string) => void = () => {}): Promise<boolean> {
  if (!seedScriptExists()) {
    log("scripts/seed.ts not found - skipping seed");
    return false;
  }
  const tsx = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  execFileSync(process.execPath, [tsx, "scripts/seed.ts", "--test"], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
  });
  log("seeded");
  return true;
}

// CLI: tsx tests/setup/reset-test-db.ts [--no-seed]
if (process.argv[1] && /reset-test-db.ts$/.test(process.argv[1])) {
  resetTestDatabase({ seed: !process.argv.includes("--no-seed"), log: (m) => console.log(`[reset-test-db] ${m}`) }).catch(
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
}
