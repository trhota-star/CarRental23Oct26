// QA-7: the seed is idempotent (global setup already ran it once; run it again here)
// and loads the demo data the brief asks for.

import { afterAll, describe, expect, it } from "vitest";
import { seedScriptExists, seedTestDatabase } from "../setup/reset-test-db";
import { newPool } from "./helpers/db";

const pool = newPool(2);
afterAll(() => pool.end());

const TABLES = [
  "users",
  "accounts",
  "driver_profiles",
  "branches",
  "vehicle_categories",
  "vehicles",
  "vehicle_features",
  "vehicle_feature_map",
  "pricing_rules",
  "extras",
  "reservations",
  "reservation_extras",
  "payments",
  "deposits",
  "maintenance_blocks",
  "vehicle_bookings",
];

async function counts() {
  const out: Record<string, number> = {};
  for (const t of TABLES) out[t] = (await pool.query(`select count(*)::int n from ${t}`)).rows[0].n;
  return out;
}

const seeded = seedScriptExists() && process.env.QA_SKIP_SEED !== "1";

describe.skipIf(!seeded)("seed", () => {
  it("runs a second time without error and without duplicating rows", async () => {
    const before = await counts();
    await seedTestDatabase();
    expect(await counts()).toEqual(before);
  }, 180_000);

  it("loads branches in Asia/Dubai, ~20 vehicles, extras, VAT 5%, one-way fees, future reservations, an admin", async () => {
    const branches = await pool.query(`select city, timezone from branches where code !~ '^Q'`);
    expect(branches.rows.map((r) => r.city)).toEqual(expect.arrayContaining(["Dubai", "Abu Dhabi", "Sharjah"]));
    for (const b of branches.rows) expect(b.timezone).toBe("Asia/Dubai");
    const vehicles = (await pool.query(`select count(*)::int n from vehicles where plate !~ '^QA-'`)).rows[0].n;
    expect(vehicles).toBeGreaterThanOrEqual(15);
    expect((await pool.query(`select count(*)::int n from extras where code !~ '^QA_'`)).rows[0].n).toBeGreaterThan(0);
    const vat = await pool.query(`select rate_bps from pricing_rules where kind = 'VAT' and is_active`);
    expect(vat.rows.map((r) => r.rate_bps)).toContain(500);
    expect((await pool.query(`select count(*)::int n from pricing_rules where kind = 'ONE_WAY_FEE'`)).rows[0].n).toBeGreaterThan(0);
    expect(
      (await pool.query(`select count(*)::int n from reservations where pickup_at > now() and status in ('PENDING','CONFIRMED')`)).rows[0].n,
    ).toBeGreaterThan(0);
    expect((await pool.query(`select count(*)::int n from users where role = 'admin'`)).rows[0].n).toBeGreaterThan(0);
  });
});
