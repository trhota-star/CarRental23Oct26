// Priced fleet fixture: two branches, one category with its own pricing rules,
// vehicles at branch A, and two extras. All values in fils.
//   daily rate 20,000 · deposit 200,000 · one-way A→B 30,000 · VAT 5%
//   late return 4,000/started hour, 30 min grace
//   extras: per-day 3,000 (max 2) · per-rental 7,500

import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import * as schema from "@/server/db/schema";
import type { Db } from "@/server/db";
import { createBranch, createCategory, createVehicle } from "./db";

export const PRICES = {
  daily: 20_000,
  deposit: 200_000,
  oneWay: 30_000,
  vatBps: 500,
  lateHourly: 4_000,
  lateGrace: 30,
  perDayExtra: 3_000,
  perRentalExtra: 7_500,
} as const;

export const drizzleFor = (pool: Pool): Db => drizzle({ client: pool, schema });

export async function createPricedFleet(pool: Pool, vehicleCount = 1) {
  const branchA = await createBranch(pool);
  const branchB = await createBranch(pool);
  const category = await createCategory(pool);
  const vehicles = [];
  for (let i = 0; i < vehicleCount; i++) vehicles.push(await createVehicle(pool, branchA.id, category.id));

  const rule = (kind: string, cols: Record<string, unknown>) => {
    const keys = Object.keys(cols);
    return pool.query(
      `insert into pricing_rules (kind, name, ${keys.join(", ")}) values ($1, $2, ${keys.map((_, i) => `$${i + 3}`).join(", ")})`,
      [kind, `QA ${kind} ${category.code}`, ...Object.values(cols)],
    );
  };
  await rule("DAILY_RATE", { category_id: category.id, min_days: 1, amount_fils: PRICES.daily });
  await rule("DEPOSIT", { category_id: category.id, amount_fils: PRICES.deposit });
  await rule("ONE_WAY_FEE", { from_branch_id: branchA.id, to_branch_id: branchB.id, amount_fils: PRICES.oneWay });
  await rule("LATE_RETURN", { category_id: category.id, amount_fils: PRICES.lateHourly, grace_minutes: PRICES.lateGrace });
  const vat = await pool.query(`select rate_bps from pricing_rules where kind = 'VAT' and is_active`);
  if (vat.rowCount === 0) await rule("VAT", { rate_bps: PRICES.vatBps });
  else if (vat.rows.some((r) => r.rate_bps !== PRICES.vatBps)) throw new Error("Unexpected VAT rule in driveeasy_test");

  const tag = randomBytes(3).toString("hex").toUpperCase();
  const perDay = await pool.query(
    `insert into extras (code, name, charge_type, price_fils, max_quantity) values ($1, 'QA child seat', 'PER_DAY', $2, 2) returning id`,
    [`QA_SEAT_${tag}`, PRICES.perDayExtra],
  );
  const perRental = await pool.query(
    `insert into extras (code, name, charge_type, price_fils, max_quantity) values ($1, 'QA full cover', 'PER_RENTAL', $2, 1) returning id`,
    [`QA_COVER_${tag}`, PRICES.perRentalExtra],
  );

  return {
    branchA,
    branchB,
    category,
    vehicles,
    vehicle: vehicles[0],
    extras: { perDay: perDay.rows[0].id as string, perRental: perRental.rows[0].id as string },
  };
}

export type PricedFleet = Awaited<ReturnType<typeof createPricedFleet>>;
