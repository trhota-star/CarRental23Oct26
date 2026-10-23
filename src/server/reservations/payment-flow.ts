// Payment + deposit orchestration, confirmation and webhooks (DB-7).
//
// Rules
// - A reservation is CONFIRMED only when (a) succeeded RENTAL payments cover total_fils
//   and (b) a deposit is HELD (or the deposit amount is 0). Both facts come from the
//   provider's own responses or from signature-verified webhooks.
// - payments.idempotency_key / deposits.idempotency_key are unique and are passed to
//   the provider as its idempotency key, so retries never double-charge.
// - processed_webhook_events (provider, event_id) is the dedup table; the insert and
//   the state change happen in one transaction, so a duplicate delivery is a no-op.
// - Provider states only move forward (a late "succeeded" never undoes a refund).

import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { assertOwnerOrAdmin, parseActor, type Actor } from "../actor";
import { audit } from "../audit";
import { getDb, type Executor, type Tx } from "../db";
import { deposits, driverProfiles, payments, processedWebhookEvents, reservations } from "../db/schema";
import {
  DriverProfileIncompleteError,
  IdempotencyConflictError,
  InvalidStateError,
  NotFoundError,
} from "../errors";
import { log } from "../log";
import { getPaymentProvider } from "../payments";
import { PaymentError, type DepositHold, type Payment, type PaymentProvider, type PaymentWebhookEvent } from "../payments/types";
import { parseInput } from "../validation";
import type { MutationOptions } from "./hold";
import { loadReservationView, type ReservationView } from "./views";

type PaymentRowStatus = (typeof payments.$inferSelect)["status"];
type DepositRowStatus = (typeof deposits.$inferSelect)["status"];

const PAYMENT_STATUS: Record<Payment["status"], PaymentRowStatus> = {
  pending: "PENDING",
  succeeded: "SUCCEEDED",
  failed: "FAILED",
  canceled: "CANCELED",
  refunded: "REFUNDED",
  partially_refunded: "PARTIALLY_REFUNDED",
};
const PAYMENT_RANK: Record<PaymentRowStatus, number> = {
  PENDING: 0,
  FAILED: 1,
  CANCELED: 1,
  SUCCEEDED: 1,
  PARTIALLY_REFUNDED: 2,
  REFUNDED: 3,
};
const DEPOSIT_STATUS: Record<DepositHold["status"], DepositRowStatus> = {
  held: "HELD",
  failed: "FAILED",
  released: "RELEASED",
  captured: "CAPTURED",
};
const DEPOSIT_RANK: Record<DepositRowStatus, number> = { PENDING: 0, HELD: 1, FAILED: 1, RELEASED: 2, CAPTURED: 2 };

/** Applies a provider payment snapshot to our row (forward-only). */
export async function applyPaymentState(tx: Executor, paymentRowId: string, p: Payment): Promise<typeof payments.$inferSelect> {
  const [row] = await tx.select().from(payments).where(eq(payments.id, paymentRowId)).for("update");
  if (!row) throw new NotFoundError("Payment");
  const next = PAYMENT_STATUS[p.status];
  const forward = PAYMENT_RANK[next] > PAYMENT_RANK[row.status] || (PAYMENT_RANK[next] === PAYMENT_RANK[row.status] && row.status === "PENDING");
  const refunded = Math.min(row.amountFils, Math.max(row.amountRefundedFils, p.amountRefunded));
  const [updated] = await tx
    .update(payments)
    .set({
      providerPaymentId: row.providerPaymentId ?? p.id,
      status: forward ? next : row.status,
      amountRefundedFils: refunded,
      failureReason: forward ? (p.failureReason ?? null) : row.failureReason,
    })
    .where(eq(payments.id, row.id))
    .returning();
  return updated;
}

/** Applies a provider deposit-hold snapshot to our row (forward-only). */
export async function applyDepositState(tx: Executor, depositRowId: string, h: DepositHold, now = new Date()): Promise<typeof deposits.$inferSelect> {
  const [row] = await tx.select().from(deposits).where(eq(deposits.id, depositRowId)).for("update");
  if (!row) throw new NotFoundError("Deposit");
  const next = DEPOSIT_STATUS[h.status];
  const forward = DEPOSIT_RANK[next] > DEPOSIT_RANK[row.status];
  const [updated] = await tx
    .update(deposits)
    .set({
      providerHoldId: row.providerHoldId ?? h.id,
      status: forward ? next : row.status,
      amountCapturedFils: Math.min(row.amountFils, Math.max(row.amountCapturedFils, h.amountCaptured)),
      failureReason: forward ? (h.failureReason ?? null) : row.failureReason,
      releasedAt: forward && next === "RELEASED" ? now : row.releasedAt,
      capturedAt: forward && next === "CAPTURED" ? now : row.capturedAt,
    })
    .where(eq(deposits.id, row.id))
    .returning();
  return updated;
}

/** Net succeeded RENTAL+ADJUSTMENT money for a reservation (fils). */
export async function netPaidFils(db: Executor, reservationId: string): Promise<number> {
  const [r] = await db
    .select({ net: sql<number>`coalesce(sum(${payments.amountFils} - ${payments.amountRefundedFils}), 0)::int` })
    .from(payments)
    .where(
      and(eq(payments.reservationId, reservationId), inArray(payments.status, ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"])),
    );
  return r.net;
}

async function grossSucceededFils(db: Executor, reservationId: string): Promise<number> {
  const [r] = await db
    .select({ gross: sql<number>`coalesce(sum(${payments.amountFils}), 0)::int` })
    .from(payments)
    .where(and(eq(payments.reservationId, reservationId), inArray(payments.status, ["SUCCEEDED", "PARTIALLY_REFUNDED"])));
  return r.gross;
}

async function heldDeposit(db: Executor, reservationId: string) {
  const [d] = await db
    .select()
    .from(deposits)
    .where(and(eq(deposits.reservationId, reservationId), eq(deposits.status, "HELD")))
    .limit(1);
  return d;
}

/**
 * Confirms a PENDING reservation inside `tx` if payment and deposit are both in place.
 * Returns the resulting status. Never throws for "not ready yet".
 */
export async function confirmInTx(tx: Tx, reservationId: string, now: Date): Promise<{ confirmed: boolean; status: string }> {
  const [r] = await tx.select().from(reservations).where(eq(reservations.id, reservationId)).for("update");
  if (!r) throw new NotFoundError("Reservation");
  if (r.status !== "PENDING") return { confirmed: r.status === "CONFIRMED", status: r.status };
  const paid = await grossSucceededFils(tx, r.id);
  const depositOk = r.depositFils === 0 || Boolean(await heldDeposit(tx, r.id));
  if (paid < r.totalFils || !depositOk) return { confirmed: false, status: r.status };
  await tx
    .update(reservations)
    .set({ status: "CONFIRMED", confirmedAt: now, holdExpiresAt: null })
    .where(eq(reservations.id, r.id));
  await audit(tx, { actorId: null, action: "reservation.confirmed", entityType: "reservation", entityId: r.id, data: { paidFils: paid } });
  log.info("reservation.confirmed", { reservationId: r.id });
  return { confirmed: true, status: "CONFIRMED" };
}

/**
 * Confirms a reservation if a verified payment and an authorised deposit exist.
 * System-level (called by payForReservation and the webhook handler); safe to call repeatedly.
 */
export async function confirmReservation(reservationId: string, opts: MutationOptions = {}): Promise<ReservationView> {
  const id = parseInput(z.uuid(), reservationId);
  const db = opts.db ?? getDb();
  await db.transaction((tx) => confirmInTx(tx, id, opts.now ?? new Date()));
  return (await loadReservationView(id, db))!;
}

/** Throws DriverProfileIncompleteError unless the user has a usable driver profile + licence for this trip. */
export async function assertDriverReady(db: Executor, userId: string, pickupAt: Date, returnAt: Date): Promise<void> {
  const [p] = await db.select().from(driverProfiles).where(eq(driverProfiles.userId, userId));
  if (!p) throw new DriverProfileIncompleteError();
  if (!p.licenceFileKey) throw new DriverProfileIncompleteError("Upload a photo of your driving licence before paying");
  if (new Date(`${p.licenceExpiry}T23:59:59Z`).getTime() < returnAt.getTime()) {
    throw new DriverProfileIncompleteError("Your driving licence expires before the end of this rental");
  }
  const dob = new Date(`${p.dateOfBirth}T00:00:00Z`);
  const twentyOne = new Date(Date.UTC(dob.getUTCFullYear() + 21, dob.getUTCMonth(), dob.getUTCDate()));
  if (twentyOne.getTime() > pickupAt.getTime()) throw new DriverProfileIncompleteError("Drivers must be at least 21 years old");
}

export const payForReservationSchema = z.object({
  reservationId: z.uuid(),
  /** Provider payment-method token (fake: pm_fake_success | pm_fake_decline | pm_fake_cancel | pm_fake_pending). */
  paymentMethod: z.string().trim().min(1).max(200),
  /** Unique per payment attempt. Reuse it to retry the same attempt safely. */
  idempotencyKey: z.string().trim().min(8).max(200),
});
export type PayForReservationInput = z.input<typeof payForReservationSchema>;

export type PayOutcome =
  | "CONFIRMED"
  | "ALREADY_CONFIRMED"
  | "PAYMENT_FAILED"
  | "PAYMENT_PENDING"
  | "DEPOSIT_FAILED"
  | "HOLD_EXPIRED";

export type PayResult = { outcome: PayOutcome; message: string; reservation: ReservationView };

const OUTCOME_MESSAGES: Record<PayOutcome, string> = {
  CONFIRMED: "Your booking is confirmed",
  ALREADY_CONFIRMED: "Your booking is already confirmed",
  PAYMENT_FAILED: "Your payment was not successful. Please try another card.",
  PAYMENT_PENDING: "Your payment is processing. We'll confirm your booking as soon as it completes.",
  DEPOSIT_FAILED: "We couldn't place the security deposit hold. Please try another card.",
  HOLD_EXPIRED: "Your hold expired before payment completed. Any payment taken will be refunded.",
};

/**
 * Charges the rental total and holds the security deposit, then confirms.
 * Idempotent per idempotencyKey. Never charges twice for the same reservation:
 * a retry after a deposit failure only retries the deposit.
 */
export async function payForReservation(
  actorInput: Actor,
  input: PayForReservationInput,
  opts: MutationOptions & { provider?: PaymentProvider } = {},
): Promise<PayResult> {
  const actor = parseActor(actorInput);
  const data = parseInput(payForReservationSchema, input);
  const db = opts.db ?? getDb();
  const now = opts.now ?? new Date();
  const provider = opts.provider ?? getPaymentProvider();
  const result = async (outcome: PayOutcome): Promise<PayResult> => ({
    outcome,
    message: OUTCOME_MESSAGES[outcome],
    reservation: (await loadReservationView(data.reservationId, db))!,
  });

  const [r] = await db.select().from(reservations).where(eq(reservations.id, data.reservationId));
  if (!r) throw new NotFoundError("Reservation");
  assertOwnerOrAdmin(actor, r.userId);
  if (r.status === "CONFIRMED" || r.status === "PICKED_UP" || r.status === "RETURNED") return result("ALREADY_CONFIRMED");
  if (r.status !== "PENDING") throw new InvalidStateError(`This booking is ${r.status.toLowerCase()} and can't be paid`);

  const [keyed] = await db.select().from(payments).where(eq(payments.idempotencyKey, data.idempotencyKey));
  if (keyed && keyed.reservationId !== r.id) throw new IdempotencyConflictError();
  if (!keyed && r.holdExpiresAt && r.holdExpiresAt.getTime() <= now.getTime()) {
    throw new InvalidStateError("Your hold has expired. Please search again and make a new booking.");
  }
  await assertDriverReady(db, r.userId, r.pickupAt, r.returnAt);

  // ---- 1. rental payment (skip if already covered) ----
  if ((await grossSucceededFils(db, r.id)) < r.totalFils) {
    const row =
      keyed ??
      (
        await db
          .insert(payments)
          .values({
            reservationId: r.id,
            provider: provider.name,
            idempotencyKey: data.idempotencyKey,
            purpose: "RENTAL",
            amountFils: r.totalFils,
            currency: r.currency,
          })
          .onConflictDoNothing({ target: payments.idempotencyKey })
          .returning()
      )[0] ??
      (await db.select().from(payments).where(eq(payments.idempotencyKey, data.idempotencyKey)))[0];
    let state = row;
    try {
      const p = await provider.createPayment({
        amount: row.amountFils,
        currency: row.currency.toLowerCase(),
        reference: r.reference,
        idempotencyKey: row.idempotencyKey,
        paymentMethod: data.paymentMethod,
        metadata: { kind: "payment", paymentId: row.id, reservationId: r.id },
      });
      state = await db.transaction((tx) => applyPaymentState(tx, row.id, p));
    } catch (error) {
      if (!(error instanceof PaymentError)) throw error;
      log.warn("payment.provider_error", { reservationId: r.id, code: error.code, error });
      [state] = await db
        .update(payments)
        .set({ status: "FAILED", failureReason: error.code })
        .where(and(eq(payments.id, row.id), eq(payments.status, "PENDING")))
        .returning();
      state ??= row;
    }
    log.info("payment.attempt", { reservationId: r.id, paymentId: row.id, status: state.status });
    if (state.status === "PENDING") return result("PAYMENT_PENDING");
    if (state.status !== "SUCCEEDED") return result("PAYMENT_FAILED");
  }

  // ---- 2. security deposit hold (skip if already held or not required) ----
  if (r.depositFils > 0 && !(await heldDeposit(db, r.id))) {
    const depositKey = `${data.idempotencyKey}:deposit`;
    const row =
      (
        await db
          .insert(deposits)
          .values({
            reservationId: r.id,
            provider: provider.name,
            idempotencyKey: depositKey,
            amountFils: r.depositFils,
            currency: r.currency,
          })
          .onConflictDoNothing({ target: deposits.idempotencyKey })
          .returning()
      )[0] ?? (await db.select().from(deposits).where(eq(deposits.idempotencyKey, depositKey)))[0];
    let state = row;
    try {
      const h = await provider.holdDeposit({
        amount: row.amountFils,
        currency: row.currency.toLowerCase(),
        reference: r.reference,
        idempotencyKey: row.idempotencyKey,
        paymentMethod: data.paymentMethod,
        metadata: { kind: "deposit", depositId: row.id, reservationId: r.id },
      });
      state = await db.transaction((tx) => applyDepositState(tx, row.id, h, now));
    } catch (error) {
      if (!(error instanceof PaymentError)) throw error;
      log.warn("deposit.provider_error", { reservationId: r.id, code: error.code, error });
      [state] = await db
        .update(deposits)
        .set({ status: "FAILED", failureReason: error.code })
        .where(and(eq(deposits.id, row.id), eq(deposits.status, "PENDING")))
        .returning();
      state ??= row;
    }
    log.info("deposit.attempt", { reservationId: r.id, depositId: row.id, status: state.status });
    if (state.status !== "HELD") return result("DEPOSIT_FAILED");
  }

  // ---- 3. confirm ----
  const { confirmed, status } = await db.transaction((tx) => confirmInTx(tx, r.id, now));
  if (confirmed) return result("CONFIRMED");
  if (status === "EXPIRED" || status === "CANCELLED") return result("HOLD_EXPIRED");
  return result("PAYMENT_PENDING");
}

export type WebhookResult = { status: "processed" | "duplicate" | "ignored"; eventId: string; type: string };

/**
 * Verifies and processes a provider webhook. Throws PaymentError("invalid_signature")
 * for bad signatures (route → 400). Duplicate event ids are no-ops.
 */
export async function handlePaymentWebhook(
  rawBody: string,
  signature: string | null,
  opts: MutationOptions & { provider?: PaymentProvider } = {},
): Promise<WebhookResult> {
  const provider = opts.provider ?? getPaymentProvider();
  const event: PaymentWebhookEvent = provider.verifyWebhook(rawBody, signature);
  const db = opts.db ?? getDb();
  const now = opts.now ?? new Date();

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(processedWebhookEvents)
      .values({ provider: provider.name, eventId: event.id, eventType: event.type })
      .onConflictDoNothing()
      .returning({ eventId: processedWebhookEvents.eventId });
    if (inserted.length === 0) {
      log.info("webhook.duplicate", { eventId: event.id, type: event.type });
      return { status: "duplicate" as const, eventId: event.id, type: event.type };
    }

    let reservationId: string | undefined;
    if (event.type.startsWith("payment.")) {
      const data = event.data as Payment;
      const [row] = await tx
        .select({ id: payments.id, reservationId: payments.reservationId })
        .from(payments)
        .where(
          data.metadata?.paymentId && z.uuid().safeParse(data.metadata.paymentId).success
            ? sql`${payments.providerPaymentId} = ${data.id} or ${payments.id} = ${data.metadata.paymentId}::uuid`
            : eq(payments.providerPaymentId, data.id),
        )
        .limit(1);
      if (!row) {
        log.warn("webhook.unknown_payment", { eventId: event.id, providerPaymentId: data.id });
        return { status: "ignored" as const, eventId: event.id, type: event.type };
      }
      await applyPaymentState(tx, row.id, data);
      reservationId = row.reservationId;
    } else {
      const data = event.data as DepositHold;
      const [row] = await tx
        .select({ id: deposits.id, reservationId: deposits.reservationId })
        .from(deposits)
        .where(
          data.metadata?.depositId && z.uuid().safeParse(data.metadata.depositId).success
            ? sql`${deposits.providerHoldId} = ${data.id} or ${deposits.id} = ${data.metadata.depositId}::uuid`
            : eq(deposits.providerHoldId, data.id),
        )
        .limit(1);
      if (!row) {
        log.warn("webhook.unknown_deposit", { eventId: event.id, providerHoldId: data.id });
        return { status: "ignored" as const, eventId: event.id, type: event.type };
      }
      await applyDepositState(tx, row.id, data, now);
      reservationId = row.reservationId;
    }

    if (event.type === "payment.succeeded" || event.type === "deposit.held") {
      await confirmInTx(tx, reservationId, now);
    }
    log.info("webhook.processed", { eventId: event.id, type: event.type, reservationId });
    return { status: "processed" as const, eventId: event.id, type: event.type };
  });
}
