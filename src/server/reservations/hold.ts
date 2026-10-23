// Reservation hold transaction (DB-6).
//
// BEGIN
//   SELECT … FROM vehicles WHERE id = $1 FOR UPDATE          -- serialise holds per vehicle
//   UPDATE reservations SET status='EXPIRED' …               -- stale PENDING holds on this vehicle that overlap
//   overlap check against vehicle_bookings (live rows)       -- friendly early error
//   server-side quote                                          -- never trust client prices
//   INSERT reservation (PENDING, hold_expires_at)            -- trigger inserts the vehicle_bookings row;
//                                                             -- EXCLUDE constraint is the final guard (23P01)
//   INSERT reservation_extras, audit_logs
// COMMIT
//
// Idempotency: (user_id, idempotency_key) is unique. A retry with the same key
// returns the original reservation (if the request matches) instead of creating another.

import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { parseActor, type Actor } from "../actor";
import { audit } from "../audit";
import { getDb, type Db } from "../db";
import { reservationExtras, reservations, vehicles } from "../db/schema";
import {
  IdempotencyConflictError,
  NotFoundError,
  PG_EXCLUSION_VIOLATION,
  PG_UNIQUE_VIOLATION,
  pgConstraint,
  pgErrorCode,
  ValidationError,
  VehicleUnavailableError,
} from "../errors";
import { log } from "../log";
import { quoteInputSchema, quoteWith } from "../pricing/quote";
import { parseInput } from "../validation";
import { isVehicleFree, rangeSql } from "./availability";
import { loadReservationView, type ReservationView } from "./views";

export type MutationOptions = {
  /** Clock override (tests). Defaults to new Date(). */
  now?: Date;
  /** Database override (tests that need independent pools). Defaults to getDb(). */
  db?: Db;
};

export function holdMinutes(): number {
  const n = Number(process.env.RESERVATION_HOLD_MINUTES ?? 15);
  return Number.isFinite(n) && n > 0 ? n : 15;
}

export const createHoldSchema = z.intersection(
  quoteInputSchema,
  z.object({ idempotencyKey: z.string().trim().min(8).max(200) }),
);
export type CreateReservationHoldInput = z.input<typeof createHoldSchema>;

const REF_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export function newReference(): string {
  const bytes = randomBytes(8);
  let s = "";
  for (const b of bytes) s += REF_ALPHABET[b % REF_ALPHABET.length];
  return `DE-${s}`;
}

/** Marks stale (expired) PENDING holds on a vehicle that overlap [from, to) as EXPIRED. Caller holds the vehicle lock. */
export async function expireStaleHolds(
  tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
  vehicleId: string,
  from: Date,
  to: Date,
  now: Date,
): Promise<number> {
  const rows = await tx
    .update(reservations)
    .set({ status: "EXPIRED", expiredAt: now })
    .where(
      and(
        eq(reservations.vehicleId, vehicleId),
        eq(reservations.status, "PENDING"),
        sql`${reservations.holdExpiresAt} <= ${now.toISOString()}::timestamptz`,
        sql`${reservations.period} && ${rangeSql(from, to)}`,
      ),
    )
    .returning({ id: reservations.id });
  if (rows.length) log.info("reservation.hold.expired_inline", { vehicleId, reservationIds: rows.map((r) => r.id) });
  return rows.length;
}

async function findByKey(db: Db, userId: string, key: string) {
  const [row] = await db
    .select()
    .from(reservations)
    .where(and(eq(reservations.userId, userId), eq(reservations.idempotencyKey, key)));
  return row;
}

function sameRequest(row: typeof reservations.$inferSelect, input: z.output<typeof createHoldSchema>): boolean {
  return (
    row.vehicleId === input.vehicleId &&
    row.pickupBranchId === input.pickupBranchId &&
    row.returnBranchId === input.returnBranchId &&
    row.pickupAt.getTime() === input.pickupAt.getTime() &&
    row.returnAt.getTime() === input.returnAt.getTime()
  );
}

/**
 * Creates a PENDING reservation that holds the vehicle for `holdMinutes()` minutes.
 * Throws VehicleUnavailableError if the vehicle is taken, ValidationError for bad
 * input, PricingError if the trip can't be priced, IdempotencyConflictError if the
 * key was used for a different request.
 */
export async function createReservationHold(
  actorInput: Actor,
  input: CreateReservationHoldInput,
  opts: MutationOptions = {},
): Promise<ReservationView> {
  const actor = parseActor(actorInput);
  const data = parseInput(createHoldSchema, input);
  const db = opts.db ?? getDb();
  const now = opts.now ?? new Date();

  const existing = await findByKey(db, actor.userId, data.idempotencyKey);
  if (existing) {
    if (!sameRequest(existing, data)) throw new IdempotencyConflictError();
    return (await loadReservationView(existing.id, db))!;
  }
  if (data.pickupAt.getTime() < now.getTime() - 5 * 60_000) {
    throw new ValidationError("Pick-up time must be in the future", { fields: { pickupAt: "Pick-up time must be in the future" } });
  }

  let reservationId: string;
  try {
    reservationId = await db.transaction(async (tx) => {
      const [vehicle] = await tx
        .select({ id: vehicles.id, status: vehicles.status, branchId: vehicles.branchId })
        .from(vehicles)
        .where(eq(vehicles.id, data.vehicleId))
        .for("update");
      if (!vehicle) throw new NotFoundError("Vehicle");
      if (vehicle.status === "RETIRED" || vehicle.status === "MAINTENANCE") throw new VehicleUnavailableError();
      if (vehicle.branchId !== data.pickupBranchId) {
        throw new ValidationError("This vehicle is not available at the selected pick-up branch");
      }

      await expireStaleHolds(tx, data.vehicleId, data.pickupAt, data.returnAt, now);
      if (!(await isVehicleFree(tx, data.vehicleId, data.pickupAt, data.returnAt, { now }))) {
        throw new VehicleUnavailableError();
      }

      const quote = await quoteWith(tx, data);
      const [row] = await tx
        .insert(reservations)
        .values({
          reference: newReference(),
          userId: actor.userId,
          vehicleId: data.vehicleId,
          pickupBranchId: data.pickupBranchId,
          returnBranchId: data.returnBranchId,
          pickupAt: data.pickupAt,
          returnAt: data.returnAt,
          status: "PENDING",
          holdExpiresAt: new Date(now.getTime() + holdMinutes() * 60_000),
          idempotencyKey: data.idempotencyKey,
          currency: quote.currency,
          rentalDays: quote.rentalDays,
          dailyRateFils: quote.dailyRateFils,
          baseFils: quote.baseFils,
          extrasFils: quote.extrasFils,
          oneWayFeeFils: quote.oneWayFeeFils,
          subtotalFils: quote.subtotalFils,
          vatRateBps: quote.vatRateBps,
          vatFils: quote.vatFils,
          totalFils: quote.totalFils,
          depositFils: quote.depositFils,
          quote: { ...quote, categoryId: undefined },
        })
        .returning({ id: reservations.id });
      if (quote.extras.length) {
        await tx.insert(reservationExtras).values(
          quote.extras.map((e) => ({
            reservationId: row.id,
            extraId: e.extraId,
            quantity: e.quantity,
            unitPriceFils: e.unitPriceFils,
            chargeType: e.chargeType,
            totalFils: e.totalFils,
          })),
        );
      }
      await audit(tx, {
        actorId: actor.userId,
        action: "reservation.hold.created",
        entityType: "reservation",
        entityId: row.id,
        data: { vehicleId: data.vehicleId, totalFils: quote.totalFils },
      });
      return row.id;
    });
  } catch (error) {
    const code = pgErrorCode(error);
    if (code === PG_EXCLUSION_VIOLATION) {
      log.info("reservation.hold.conflict", { vehicleId: data.vehicleId, userId: actor.userId });
      throw new VehicleUnavailableError();
    }
    if (code === PG_UNIQUE_VIOLATION && pgConstraint(error) === "reservations_user_idempotency_key") {
      const row = await findByKey(db, actor.userId, data.idempotencyKey);
      if (row && sameRequest(row, data)) return (await loadReservationView(row.id, db))!;
      throw new IdempotencyConflictError();
    }
    throw error;
  }

  log.info("reservation.hold.created", { reservationId, vehicleId: data.vehicleId, userId: actor.userId });
  return (await loadReservationView(reservationId, db))!;
}
