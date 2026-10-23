// QA-7: migrations apply cleanly to an empty database.
// The integration global setup has just dropped driveeasy_test, recreated it and
// applied every migration from zero; this file verifies the result.

import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { newPool } from "./helpers/db";

const pool = newPool(2);
afterAll(() => pool.end());

const REQUIRED_TABLES = [
  "users",
  "sessions",
  "accounts",
  "verifications",
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
  "rental_agreements",
  "damage_reports",
  "maintenance_blocks",
  "audit_logs",
  "vehicle_bookings",
  "processed_webhook_events",
];

describe("migrations from zero", () => {
  it("recorded every migration in the drizzle journal", async () => {
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: unknown[] };
    const { rows } = await pool.query(`select count(*)::int as n from drizzle.__drizzle_migrations`);
    expect(rows[0].n).toBe(journal.entries.length);
  });

  it("created all required tables", async () => {
    const { rows } = await pool.query(`select table_name from information_schema.tables where table_schema = 'public'`);
    const names = rows.map((r) => r.table_name);
    for (const t of REQUIRED_TABLES) expect(names, `table ${t}`).toContain(t);
  });

  it("has the btree_gist extension and the single exclusion constraint", async () => {
    const ext = await pool.query(`select 1 from pg_extension where extname = 'btree_gist'`);
    expect(ext.rowCount).toBe(1);
    const { rows } = await pool.query(
      `select conname, conrelid::regclass::text as tbl from pg_constraint where contype = 'x'`,
    );
    expect(rows).toEqual([{ conname: "vehicle_bookings_no_overlap", tbl: "vehicle_bookings" }]);
  });

  it("has the required enums", async () => {
    const { rows } = await pool.query(
      `select t.typname, array_agg(e.enumlabel order by e.enumsortorder)::text[] as labels
       from pg_type t join pg_enum e on e.enumtypid = t.oid group by t.typname`,
    );
    const enums = Object.fromEntries(rows.map((r) => [r.typname, r.labels]));
    expect(enums.vehicle_status).toEqual(["AVAILABLE", "RESERVED", "ON_RENT", "MAINTENANCE", "RETIRED"]);
    expect(enums.reservation_status).toEqual(["PENDING", "CONFIRMED", "PICKED_UP", "RETURNED", "CANCELLED", "EXPIRED", "REFUNDED"]);
    expect(enums.payment_status).toBeDefined();
    expect(enums.deposit_status).toBeDefined();
  });

  it("enforces unique plate, VIN and branch code", async () => {
    const uniques = await pool.query(
      `select tc.table_name, kcu.column_name from information_schema.table_constraints tc
       join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
       where tc.constraint_type = 'UNIQUE' and tc.table_schema = 'public'`,
    );
    const pairs = uniques.rows.map((r) => `${r.table_name}.${r.column_name}`);
    expect(pairs).toEqual(expect.arrayContaining(["vehicles.plate", "vehicles.vin", "branches.code"]));
  });

  it("uses UUID primary keys on every table with an id column", async () => {
    const { rows } = await pool.query(
      `select table_name, data_type from information_schema.columns
       where table_schema = 'public' and column_name = 'id'`,
    );
    for (const r of rows) expect(r.data_type, r.table_name).toBe("uuid");
  });

  it("uses tstzrange periods on reservations and maintenance_blocks", async () => {
    const { rows } = await pool.query(
      `select table_name, udt_name from information_schema.columns
       where table_schema = 'public' and column_name = 'period' order by table_name`,
    );
    expect(rows.map((r) => `${r.table_name}:${r.udt_name}`)).toEqual([
      "maintenance_blocks:tstzrange",
      "reservations:tstzrange",
      "vehicle_bookings:tstzrange",
    ]);
  });

  it("indexes every foreign-key column", async () => {
    const { rows } = await pool.query(`
      select c.conrelid::regclass::text as tbl, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f' and c.connamespace = 'public'::regnamespace
        and not exists (
          select 1 from pg_index i
          where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]
        )
        -- a gist exclusion index on (vehicle_id, period) also serves vehicle_id lookups
        and not exists (
          select 1 from pg_constraint x where x.conrelid = c.conrelid and x.contype = 'x' and x.conkey[1] = c.conkey[1]
        )`);
    expect(rows).toEqual([]);
  });
});
