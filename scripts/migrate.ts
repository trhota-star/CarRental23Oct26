// Applies drizzle/ migrations to DATABASE_URL (or --test → TEST_DATABASE_URL).
//   pnpm db:migrate          dev database (drizzle-kit)
//   pnpm db:migrate:test     test database (this script)

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { loadLocalEnv } from "./load-env";

async function main() {
  loadLocalEnv();
  const useTest = process.argv.includes("--test");
  const url = useTest ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error(`${useTest ? "TEST_DATABASE_URL" : "DATABASE_URL"} is not set`);
  const pool = new Pool({ connectionString: url });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: "drizzle" });
    console.log(`Migrations applied to ${new URL(url).pathname.slice(1)}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
