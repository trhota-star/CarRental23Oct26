// Customer-facing reservation reads, cancellation and date changes (DB-8).
// Authorisation: owner or admin. Someone else's reservation is reported as NotFound
// (no existence leak through id/reference guessing).

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { isAdmin, parseActor, type Actor } from "../actor";
import { audit } from "../audit";
import { getDb, type Db } from "../db";
import { payments, reservationExtras, reservations, vehicles, type ReservationStatus } from "../db/schema";
import {
  InvalidStateError,
  NotFoundError,
  PaymentFailedError,
  PG_EXCLUSION_VIOLATION,
  pgErrorCode,
  PolicyError,
  ValidationError,
  VehicleUnavailableError,
} from "../errors";
import { log } from "../log";
import { getPaymentProvider } from "../payments";
import { PaymentError, type PaymentProvider } from "../payments/types";
import type { Quote } from "../pricing/engine";
import { quoteWith } from "../pricing/quote";
import { checkRange, instant, parseInput } from "../validation";
import { isVehicleFree } from "./availability";
import { expireStaleHolds, type MutationOptions } from "./hold";
import { cancelPendingPayments, refundReservationPayments, releaseReservationDeposits } from "./money";
import { applyPaymentState, netPaidFils } from "./payment-flow";
import { computeCancellation, type CancellationPreview } from "./policy";
import { loadReservationView, loadReservationViewByReference, loadReservationViews, type ReservationView } from "./views";

type Opts = MutationOptions & { provider?: PaymentProvider };

async function loadOwned(actor: Actor, reservationId: string, db: Db): Promise<ReservationView> {
  const id = parseInput(z.uuid(), reservationId);
  const view = await loadReservationView(id, db);
  if (!view || (!isAdmin(actor) && view.userId !== actor.userId)) throw new NotFoundError("Reservation");
  return view;
}

/** Owner or admin; anyone else gets NotFound. */
export async function getReservationForUser(actorInput: Actor, reservationId: string, opts: { db?: Db } = {}): Promise<ReservationView> {
  return loadOwned(parseActor(actorInput), reservationId, opts.db ?? getDb());
}

/** Voucher lookup by reference (e.g. "DE-7KQ2M9XA"). Owner or admin. */
export async function getReservationByReference(actorInput: Actor, reference: string, opts: { db?: Db } = {}): Promise<ReservationView> {
  const actor = parseActor(actorInput);
  const ref = parseInput(z.string().trim().regex(/^DE-[0-9A-Z]{8}$/i, "Invalid reference"), reference);
  const view = await loadReservationViewByReference(ref, opts.db ?? getDb());
  if (!view || (!isAdmin(actor) && view.userId !== actor.userId)) throw new NotFoundError("Reservation");
  return view;
}

const listSchema = z.object({
  statuses: z.array(z.enum(["PENDING", "CONFIRMED", "PICKED_UP", "RETURNED", "CANCELLED", "EXPIRED", "REFUNDED"])).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

/** The actor's own reservations, newest pick-up first. */
export async function listReservationsForUser(
  actorInput: Actor,
  filter: z.input<typeof listSchema> = {},
  opts: { db?: Db } = {},
): Promise<{ items: ReservationView[]; total: number }> {
  const actor = parseActor(actorInput);
  const f = parseInput(listSchema, filter);
  return loadReservationViews({ userId: actor.userId, statuses: f.statuses as ReservationStatus[] | undefined, limit: f.limit, offset: f.offset }, opts.db ?? getDb());
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

export async function previewCancellation(actorInput: Actor, reservationId: string, opts: Opts = {}): Promise<CancellationPreview> {
  const actor = parseActor(actorInput);
  const db = opts.db ?? getDb();
  const view = await loadOwned(actor, reservationId, db);
  return computeCancellation({
    status: view.status,
    pickupAt: view.pickupAt,
    now: opts.now ?? new Date(),
    paidFils: view.paidFils,
    dailyRateFils: view.pricing.dailyRateFils,
    vatRateBps: view.pricing.vatRateBps,
    isAdmin: isAdmin(actor),
  });
}

const cancelSchema = z.object({ reservationId: z.uuid(), reason: z.string().trim().max(500).optional() });

/**
 * Cancels per policy, refunds what the policy allows, voids pending payments and
 * releases the deposit. Calling it again on a cancelled reservation is a no-op.
 */
export async function cancelReservation(actorInput: Actor, input: z.input<typeof cancelSchema>, opts: Opts = {}): Promise<ReservationView> {
  const actor = parseActor(actorInput);
  const data = parseInput(cancelSchema, input);
  const db = opts.db ?? getDb();
  const now = opts.now ?? new Date();
  const view = await loadOwned(actor, data.reservationId, db);
  if (view.status === "CANCELLED") return view;

  const preview = await db.transaction(async (tx) => {
    const [r] = await tx.select().from(reservations).where(eq(reservations.id, view.id)).for("update");
    const paid = await netPaidFils(tx, r.id);
    const p = computeCancellation({
      status: r.status,
      pickupAt: r.pickupAt,
      now,
      paidFils: paid,
      dailyRateFils: r.dailyRateFils,
      vatRateBps: r.vatRateBps,
      isAdmin: isAdmin(actor),
    });
    if (!p.cancellable) throw new PolicyError(p.reason ?? "This booking can't be cancelled");
    await tx
      .update(reservations)
      .set({ status: "CANCELLED", cancelledAt: now, cancellationReason: data.reason ?? (isAdmin(actor) && actor.userId !== r.userId ? "Cancelled by DriveEasy" : "Cancelled by customer") })
      .where(eq(reservations.id, r.id));
    await audit(tx, { actorId: actor.userId, action: "reservation.cancelled", entityType: "reservation", entityId: r.id, data: { refundFils: p.refundFils, feeFils: p.feeFils } });
    return p;
  });

  const deps = { db, provider: opts.provider, now };
  await cancelPendingPayments(view.id, deps);
  const refunded = preview.refundFils > 0 ? await refundReservationPayments(view.id, preview.refundFils, deps) : 0;
  await releaseReservationDeposits(view.id, deps);
  if (refunded < preview.refundFils) log.error("reservation.cancel.refund_incomplete", { reservationId: view.id, expected: preview.refundFils, refunded });
  log.info("reservation.cancelled", { reservationId: view.id, refundFils: refunded });
  return (await loadReservationView(view.id, db))!;
}

/** Admin: refunds whatever is still paid on a CANCELLED reservation and marks it REFUNDED. */
export async function refundReservation(actorInput: Actor, reservationId: string, opts: Opts = {}): Promise<ReservationView> {
  const actor = parseActor(actorInput);
  if (!isAdmin(actor)) throw new NotFoundError("Reservation");
  const db = opts.db ?? getDb();
  const view = await loadOwned(actor, reservationId, db);
  if (view.status !== "CANCELLED" && view.status !== "REFUNDED") throw new InvalidStateError("Only cancelled bookings can be refunded");
  const net = await netPaidFils(db, view.id);
  if (net > 0) await refundReservationPayments(view.id, net, { db, provider: opts.provider });
  await releaseReservationDeposits(view.id, { db, provider: opts.provider });
  await db.update(reservations).set({ status: "REFUNDED" }).where(eq(reservations.id, view.id));
  await audit(db, { actorId: actor.userId, action: "reservation.refunded", entityType: "reservation", entityId: view.id, data: { refundFils: net } });
  return (await loadReservationView(view.id, db))!;
}

// ---------------------------------------------------------------------------
// Date changes
// ---------------------------------------------------------------------------

const modifyPreviewSchema = z
  .object({ reservationId: z.uuid(), pickupAt: instant, returnAt: instant })
  .superRefine(checkRange("pickupAt", "returnAt", 90 * 86_400_000, { order: "Return must be after pick-up", tooLong: "Rentals are limited to 90 days" }));

const modifySchema = z
  .object({
    reservationId: z.uuid(),
    pickupAt: instant,
    returnAt: instant,
    /** Required when the new price is higher (charged immediately). */
    paymentMethod: z.string().trim().min(1).max(200).optional(),
    idempotencyKey: z.string().trim().min(8).max(200),
  })
  .superRefine(checkRange("pickupAt", "returnAt", 90 * 86_400_000, { order: "Return must be after pick-up", tooLong: "Rentals are limited to 90 days" }));

async function quoteForChange(db: Db | Parameters<Parameters<Db["transaction"]>[0]>[0], view: ReservationView, pickupAt: Date, returnAt: Date) {
  const extraRows = await db.select().from(reservationExtras).where(eq(reservationExtras.reservationId, view.id));
  return quoteWith(db, {
    vehicleId: view.vehicle.id,
    pickupBranchId: view.pickupBranch.id,
    returnBranchId: view.returnBranch.id,
    pickupAt,
    returnAt,
    extras: extraRows.map((e) => ({ extraId: e.extraId, quantity: e.quantity })),
  });
}

function assertModifiable(view: ReservationView, pickupAt: Date, now: Date) {
  if (view.status !== "PENDING" && view.status !== "CONFIRMED") throw new PolicyError(`A ${view.status.toLowerCase()} booking can't be changed`);
  if (view.pickupAt.getTime() <= now.getTime()) throw new PolicyError("Dates can't be changed after the pick-up time");
  if (pickupAt.getTime() < now.getTime()) throw new ValidationError("Pick-up time must be in the future", { fields: { pickupAt: "Pick-up time must be in the future" } });
}

/** Price and availability for new dates (same vehicle, branches and extras). */
export async function previewModification(
  actorInput: Actor,
  input: z.input<typeof modifyPreviewSchema>,
  opts: Opts = {},
): Promise<{ available: boolean; quote: Quote; differenceFils: number }> {
  const actor = parseActor(actorInput);
  const data = parseInput(modifyPreviewSchema, input);
  const db = opts.db ?? getDb();
  const now = opts.now ?? new Date();
  const view = await loadOwned(actor, data.reservationId, db);
  assertModifiable(view, data.pickupAt, now);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { categoryId, ...quote } = await quoteForChange(db, view, data.pickupAt, data.returnAt);
  const available = await isVehicleFree(db, view.vehicle.id, data.pickupAt, data.returnAt, { now, ignoreReservationId: view.id });
  const base = view.status === "CONFIRMED" ? view.paidFils : view.pricing.totalFils;
  return { available, quote, differenceFils: quote.totalFils - base };
}

/**
 * Moves a PENDING/CONFIRMED booking to new dates on the same vehicle.
 * CONFIRMED: a higher price is charged now (paymentMethod required, inside the
 * transaction — if the charge fails nothing changes); a lower price is refunded.
 */
export async function modifyReservationDates(actorInput: Actor, input: z.input<typeof modifySchema>, opts: Opts = {}): Promise<ReservationView> {
  const actor = parseActor(actorInput);
  const data = parseInput(modifySchema, input);
  const db = opts.db ?? getDb();
  const now = opts.now ?? new Date();
  const provider = opts.provider ?? getPaymentProvider();
  const view = await loadOwned(actor, data.reservationId, db);

  // Idempotent retry: dates already applied, or this key already charged.
  if (view.pickupAt.getTime() === data.pickupAt.getTime() && view.returnAt.getTime() === data.returnAt.getTime()) return view;
  const [keyed] = await db.select({ id: payments.id }).from(payments).where(eq(payments.idempotencyKey, data.idempotencyKey));
  if (keyed) return view;

  assertModifiable(view, data.pickupAt, now);
  if (view.status === "PENDING" && view.paidFils > 0) {
    throw new PolicyError("Finish paying for this booking (or cancel it) before changing dates");
  }

  let refundFils = 0;
  try {
    await db.transaction(async (tx) => {
      await tx.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.id, view.vehicle.id)).for("update");
      const [r] = await tx.select().from(reservations).where(eq(reservations.id, view.id)).for("update");
      if (r.status !== view.status) throw new InvalidStateError("This booking changed meanwhile. Please reload.");
      await expireStaleHolds(tx, r.vehicleId, data.pickupAt, data.returnAt, now);
      if (!(await isVehicleFree(tx, r.vehicleId, data.pickupAt, data.returnAt, { now, ignoreReservationId: r.id }))) {
        throw new VehicleUnavailableError("The vehicle is not available for the new dates");
      }
      const quote = await quoteForChange(tx, view, data.pickupAt, data.returnAt);
      await tx
        .update(reservations)
        .set({
          pickupAt: data.pickupAt,
          returnAt: data.returnAt,
          rentalDays: quote.rentalDays,
          dailyRateFils: quote.dailyRateFils,
          baseFils: quote.baseFils,
          extrasFils: quote.extrasFils,
          oneWayFeeFils: quote.oneWayFeeFils,
          subtotalFils: quote.subtotalFils,
          vatRateBps: quote.vatRateBps,
          vatFils: quote.vatFils,
          totalFils: quote.totalFils,
          depositFils: r.status === "CONFIRMED" ? r.depositFils : quote.depositFils,
          quote: { ...quote, categoryId: undefined },
        })
        .where(eq(reservations.id, r.id));
      for (const e of quote.extras) {
        await tx
          .update(reservationExtras)
          .set({ totalFils: e.totalFils, unitPriceFils: e.unitPriceFils })
          .where(and(eq(reservationExtras.reservationId, r.id), eq(reservationExtras.extraId, e.extraId)));
      }

      if (r.status === "CONFIRMED") {
        const paid = await netPaidFils(tx, r.id);
        const diff = quote.totalFils - paid;
        if (diff > 0) {
          if (!data.paymentMethod) throw new ValidationError("A payment method is needed for the price difference", { fields: { paymentMethod: "Required" } });
          const [row] = await tx
            .insert(payments)
            .values({ reservationId: r.id, provider: provider.name, idempotencyKey: data.idempotencyKey, purpose: "ADJUSTMENT", amountFils: diff, currency: r.currency })
            .returning();
          let p;
          try {
            p = await provider.createPayment({
              amount: diff,
              currency: r.currency.toLowerCase(),
              reference: r.reference,
              idempotencyKey: data.idempotencyKey,
              paymentMethod: data.paymentMethod,
              metadata: { kind: "payment", paymentId: row.id, reservationId: r.id },
            });
          } catch (error) {
            if (error instanceof PaymentError) throw new PaymentFailedError("The extra payment was not successful");
            throw error;
          }
          if (p.status !== "succeeded") throw new PaymentFailedError("The extra payment was not successful", { status: p.status });
          await applyPaymentState(tx, row.id, p);
        } else if (diff < 0) {
          refundFils = -diff;
        }
      }
      await audit(tx, {
        actorId: actor.userId,
        action: "reservation.dates_changed",
        entityType: "reservation",
        entityId: r.id,
        data: { from: [r.pickupAt, r.returnAt], to: [data.pickupAt, data.returnAt], totalFils: quote.totalFils },
      });
    });
  } catch (error) {
    if (pgErrorCode(error) === PG_EXCLUSION_VIOLATION) throw new VehicleUnavailableError("The vehicle is not available for the new dates");
    throw error;
  }

  if (refundFils > 0) await refundReservationPayments(view.id, refundFils, { db, provider, now });
  log.info("reservation.dates_changed", { reservationId: view.id, refundFils });
  return (await loadReservationView(view.id, db))!;
}

/** Convenience for UIs: a fresh idempotency key. */
export function newIdempotencyKey(): string {
  return randomUUID();
}
