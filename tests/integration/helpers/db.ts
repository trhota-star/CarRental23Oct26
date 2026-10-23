// Shared helpers for integration tests against driveeasy_test.
// Fixtures are inserted with raw SQL and unique codes so tests never collide
// with seed data or with each other.

import { randomBytes, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";

export function testUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith("_test")) throw new Error("TEST_DATABASE_URL must point at a *_test database");
  return url;
}

/** A fresh, independent connection pool (separate sessions for concurrency tests). */
export function newPool(max = 5): Pool {
  return new Pool({ connectionString: testUrl(), max });
}

const tag = () => randomBytes(4).toString("hex").toUpperCase();
const VIN_CHARS = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";
const vin = () => Array.from({ length: 17 }, () => VIN_CHARS[Math.floor(Math.random() * VIN_CHARS.length)]).join("");

type Q = Pool | PoolClient;

export async function createUser(db: Q, role: "customer" | "admin" = "customer") {
  const id = randomUUID();
  const email = `qa-${id.slice(0, 8)}@example.test`;
  await db.query(`insert into users (id, name, email, role) values ($1, $2, $3, $4)`, [id, `QA ${role}`, email, role]);
  return { id, email };
}

export async function createBranch(db: Q, overrides: { timezone?: string } = {}) {
  const code = `Q${tag().slice(0, 7)}`;
  const { rows } = await db.query(
    `insert into branches (code, name, city, address, timezone) values ($1, $2, 'Dubai', 'QA street', $3) returning id`,
    [code, `QA Branch ${code}`, overrides.timezone ?? "Asia/Dubai"],
  );
  return { id: rows[0].id as string, code };
}

export async function createCategory(db: Q) {
  const code = `QA_${tag()}`;
  const { rows } = await db.query(`insert into vehicle_categories (code, name) values ($1, $2) returning id`, [code, `QA ${code}`]);
  return { id: rows[0].id as string, code };
}

export async function createVehicle(db: Q, branchId: string, categoryId: string) {
  const plate = `QA-${tag()}`;
  const { rows } = await db.query(
    `insert into vehicles (branch_id, category_id, make, model, year, plate, vin, transmission, fuel_type, seats)
     values ($1, $2, 'Toyota', 'Camry', 2025, $3, $4, 'AUTOMATIC', 'PETROL', 5) returning id`,
    [branchId, categoryId, plate, vin()],
  );
  return { id: rows[0].id as string, plate };
}

/** Branch + category + vehicle in one call. */
export async function createFleet(db: Q) {
  const branch = await createBranch(db);
  const category = await createCategory(db);
  const vehicle = await createVehicle(db, branch.id, category.id);
  return { branch, category, vehicle };
}

/** Inserts a reservation row directly (bypasses business logic; exercises DB constraints). */
export async function insertReservationRow(
  db: Q,
  r: {
    userId: string;
    vehicleId: string;
    branchId: string;
    pickupAt: Date;
    returnAt: Date;
    status?: string;
    holdExpiresAt?: Date | null;
  },
) {
  const status = r.status ?? "CONFIRMED";
  const hold = r.holdExpiresAt === undefined ? (status === "PENDING" ? new Date(Date.now() + 15 * 60_000) : null) : r.holdExpiresAt;
  const { rows } = await db.query(
    `insert into reservations (reference, user_id, vehicle_id, pickup_branch_id, return_branch_id, pickup_at, return_at,
       status, hold_expires_at, idempotency_key, rental_days, daily_rate_fils, base_fils, extras_fils, one_way_fee_fils,
       subtotal_fils, vat_rate_bps, vat_fils, total_fils, deposit_fils, quote)
     values ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, 1, 10000, 10000, 0, 0, 10000, 500, 500, 10500, 100000, '{}'::jsonb)
     returning id`,
    [`QA-${tag()}`, r.userId, r.vehicleId, r.branchId, r.pickupAt, r.returnAt, status, hold, randomUUID()],
  );
  return rows[0].id as string;
}

export async function insertMaintenanceRow(db: Q, vehicleId: string, startsAt: Date, endsAt: Date) {
  const { rows } = await db.query(
    `insert into maintenance_blocks (vehicle_id, starts_at, ends_at, reason) values ($1, $2, $3, 'QA service') returning id`,
    [vehicleId, startsAt, endsAt],
  );
  return rows[0].id as string;
}

/** A UTC instant `days` days from now at the given UTC hour, rounded to the hour. */
export function futureAt(days: number, hourUtc = 8, minute = 0): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hourUtc, minute, 0, 0);
  return d;
}

export const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);
export const addDays = (d: Date, n: number) => addMinutes(d, n * 24 * 60);

/** SQLSTATE of an error, looking through Drizzle's `cause`. */
export function sqlState(error: unknown): string | undefined {
  let cur: unknown = error;
  for (let i = 0; i < 4 && cur; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}
