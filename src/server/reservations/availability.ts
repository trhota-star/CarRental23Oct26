// Availability queries over the vehicle_bookings occupancy table.
// A PENDING hold whose hold_expires_at has passed no longer blocks anyone.

import { and, asc, eq, gte, notInArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { featuresByVehicle, type VehicleDetails } from "../catalog/queries";
import { getDb, type Executor } from "../db";
import { branches, vehicleBookings, vehicleCategories, vehicles } from "../db/schema";
import { NotFoundError } from "../errors";
import { computeQuote, PricingRuleError, type Quote } from "../pricing/engine";
import { loadPricingRules, MAX_RENTAL_DAYS } from "../pricing/quote";
import { checkRange, instant, parseInput } from "../validation";

/** SQL tstzrange literal for [from, to). */
export function rangeSql(from: Date, to: Date): SQL {
  return sql`tstzrange(${from.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz, '[)')`;
}

/** Condition: a booking row that still blocks at `now`. */
export function bookingIsLive(now: Date): SQL {
  return sql`(${vehicleBookings.holdExpiresAt} is null or ${vehicleBookings.holdExpiresAt} > ${now.toISOString()}::timestamptz)`;
}

/** True when the vehicle has no live booking overlapping [from, to). */
export async function isVehicleFree(
  db: Executor,
  vehicleId: string,
  from: Date,
  to: Date,
  opts: { now?: Date; ignoreReservationId?: string } = {},
): Promise<boolean> {
  const now = opts.now ?? new Date();
  const rows = await db
    .select({ id: vehicleBookings.id })
    .from(vehicleBookings)
    .where(
      and(
        eq(vehicleBookings.vehicleId, vehicleId),
        sql`${vehicleBookings.period} && ${rangeSql(from, to)}`,
        bookingIsLive(now),
        opts.ignoreReservationId
          ? sql`${vehicleBookings.reservationId} is distinct from ${opts.ignoreReservationId}::uuid`
          : undefined,
      ),
    )
    .limit(1);
  return rows.length === 0;
}

export const searchAvailabilitySchema = z
  .object({
    pickupBranchId: z.uuid(),
    returnBranchId: z.uuid(),
    pickupAt: instant,
    returnAt: instant,
    categoryId: z.uuid().optional(),
    transmission: z.enum(["AUTOMATIC", "MANUAL"]).optional(),
    fuelType: z.enum(["PETROL", "DIESEL", "HYBRID", "ELECTRIC"]).optional(),
    minSeats: z.number().int().min(1).max(15).optional(),
    minDailyRateFils: z.number().int().nonnegative().optional(),
    maxDailyRateFils: z.number().int().nonnegative().optional(),
    sort: z.enum(["price_asc", "price_desc", "name"]).default("price_asc"),
  })
  .superRefine(checkRange("pickupAt", "returnAt", MAX_RENTAL_DAYS * 86_400_000, { order: "Return must be after pick-up", tooLong: `Rentals are limited to ${MAX_RENTAL_DAYS} days` }));
export type SearchAvailabilityInput = z.input<typeof searchAvailabilitySchema>;

export type AvailableVehicle = VehicleDetails & {
  /** Quote without extras for the requested dates/branches. */
  quote: Quote;
};

/**
 * Vehicles based at the pick-up branch that are free for the whole period,
 * with a server-side quote (no extras). Price filters apply to the daily rate.
 */
export async function searchAvailability(input: SearchAvailabilityInput, opts: { now?: Date } = {}): Promise<AvailableVehicle[]> {
  const f = parseInput(searchAvailabilitySchema, input);
  const now = opts.now ?? new Date();
  const db = getDb();
  const rows = await db
    .select({
      v: vehicles,
      branch: { id: branches.id, code: branches.code, name: branches.name, city: branches.city, timezone: branches.timezone },
      category: { id: vehicleCategories.id, code: vehicleCategories.code, name: vehicleCategories.name },
    })
    .from(vehicles)
    .innerJoin(branches, eq(branches.id, vehicles.branchId))
    .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
    .where(
      and(
        eq(vehicles.branchId, f.pickupBranchId),
        eq(branches.isActive, true),
        notInArray(vehicles.status, ["RETIRED", "MAINTENANCE"]),
        f.categoryId ? eq(vehicles.categoryId, f.categoryId) : undefined,
        f.transmission ? eq(vehicles.transmission, f.transmission) : undefined,
        f.fuelType ? eq(vehicles.fuelType, f.fuelType) : undefined,
        f.minSeats ? gte(vehicles.seats, f.minSeats) : undefined,
        sql`not exists (
          select 1 from ${vehicleBookings}
          where ${vehicleBookings.vehicleId} = ${vehicles.id}
            and ${vehicleBookings.period} && ${rangeSql(f.pickupAt, f.returnAt)}
            and ${bookingIsLive(now)})`,
      ),
    )
    .orderBy(asc(vehicleCategories.sortOrder), asc(vehicles.make), asc(vehicles.model));

  const rules = await loadPricingRules(db);
  const features = await featuresByVehicle(rows.map((r) => r.v.id), db);
  const results: AvailableVehicle[] = [];
  for (const r of rows) {
    let quote: Quote;
    try {
      quote = computeQuote({
        categoryId: r.v.categoryId,
        pickupBranchId: f.pickupBranchId,
        returnBranchId: f.returnBranchId,
        pickupAt: f.pickupAt,
        returnAt: f.returnAt,
        extras: [],
        rules,
      });
    } catch (error) {
      if (error instanceof PricingRuleError) continue; // not rentable on these terms
      throw error;
    }
    if (f.minDailyRateFils !== undefined && quote.dailyRateFils < f.minDailyRateFils) continue;
    if (f.maxDailyRateFils !== undefined && quote.dailyRateFils > f.maxDailyRateFils) continue;
    results.push({ ...r.v, branch: r.branch, category: r.category, features: features.get(r.v.id) ?? [], quote });
  }
  if (f.sort === "price_asc") results.sort((a, b) => a.quote.totalFils - b.quote.totalFils);
  else if (f.sort === "price_desc") results.sort((a, b) => b.quote.totalFils - a.quote.totalFils);
  return results;
}

const calendarSchema = z
  .object({ vehicleId: z.uuid(), from: instant, to: instant })
  .superRefine(checkRange("from", "to", 366 * 86_400_000, { order: "`to` must be after `from`", tooLong: "Range too long" }));

export type BusyInterval = { start: string; end: string; kind: "RESERVED" | "MAINTENANCE" };

/**
 * Busy intervals for a vehicle in [from, to), clipped to the window. No customer
 * data is exposed. Intervals are half-open [start, end).
 */
export async function getVehicleCalendar(
  input: { vehicleId: string; from: Date | string; to: Date | string },
  opts: { now?: Date } = {},
): Promise<{ vehicleId: string; from: string; to: string; busy: BusyInterval[] }> {
  const f = parseInput(calendarSchema, input);
  const now = opts.now ?? new Date();
  const db = getDb();
  const [vehicle] = await db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.id, f.vehicleId));
  if (!vehicle) throw new NotFoundError("Vehicle");
  const rows = await db
    .select({
      start: sql<string>`lower(${vehicleBookings.period} * ${rangeSql(f.from, f.to)})`,
      end: sql<string>`upper(${vehicleBookings.period} * ${rangeSql(f.from, f.to)})`,
      maintenance: sql<boolean>`${vehicleBookings.maintenanceBlockId} is not null`,
    })
    .from(vehicleBookings)
    .where(
      and(
        eq(vehicleBookings.vehicleId, f.vehicleId),
        sql`${vehicleBookings.period} && ${rangeSql(f.from, f.to)}`,
        bookingIsLive(now),
      ),
    )
    .orderBy(sql`lower(${vehicleBookings.period})`);
  return {
    vehicleId: f.vehicleId,
    from: f.from.toISOString(),
    to: f.to.toISOString(),
    busy: rows.map((r) => ({
      start: new Date(r.start).toISOString(),
      end: new Date(r.end).toISOString(),
      kind: r.maintenance ? "MAINTENANCE" : "RESERVED",
    })),
  };
}

