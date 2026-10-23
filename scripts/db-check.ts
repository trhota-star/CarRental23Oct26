// Confirms both local databases are reachable and have btree_gist.
//   pnpm db:check

import { Client } from "pg";
import { loadLocalEnv } from "./load-env";

async function check(label: string, url: string | undefined): Promise<boolean> {
  if (!url) {
    console.log(`✗ ${label}: URL not set`);
    return false;
  }
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    const { rows } = await client.query(
      `select current_database() as db, current_user as "user",
              current_setting('server_version') as version,
              (select extversion from pg_extension where extname = 'btree_gist') as btree_gist`,
    );
    const r = rows[0];
    const ok = Boolean(r.btree_gist);
    console.log(
      `${ok ? "✓" : "✗"} ${label}: ${r.db} as ${r.user} on PostgreSQL ${r.version}, btree_gist ${r.btree_gist ?? "MISSING"}`,
    );
    return ok;
  } catch (error) {
    console.log(`✗ ${label}: ${(error as Error).message}`);
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  loadLocalEnv();
  const results = [
    await check("dev ", process.env.DATABASE_URL),
    await check("test", process.env.TEST_DATABASE_URL),
  ];
  if (results.includes(false)) process.exit(1);
}

main();
