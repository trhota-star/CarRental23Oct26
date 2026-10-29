// Read-only access to driveeasy_test from Playwright specs (for expected values).
import { Client } from "pg";

export async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url?.includes("_test")) throw new Error("TEST_DATABASE_URL must point at driveeasy_test");
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    return (await c.query(sql, params)).rows as T[];
  } finally {
    await c.end();
  }
}

export async function branchByCode(code: string) {
  const [b] = await q<{ id: string; name: string; timezone: string }>(`select id, name, timezone from branches where code = $1`, [code]);
  if (!b) throw new Error(`branch ${code} not seeded`);
  return b;
}

/** YYYY-MM-DD `days` from today (UTC). */
export function dateIn(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
