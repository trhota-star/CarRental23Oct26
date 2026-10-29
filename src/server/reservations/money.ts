// Provider-side money movements for an existing reservation: refunds, voids,
// deposit release/capture. Each call updates our rows from the provider's answer.
// Failures are logged and reported; callers decide whether that is fatal.

import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, type Db } from "../db";
import { deposits, payments } from "../db/schema";
import { log } from "../log";
import { getPaymentProvider } from "../payments";
import type { PaymentProvider } from "../payments/types";
import { applyDepositState, applyPaymentState } from "./payment-flow";

type Deps = { db?: Db; provider?: PaymentProvider; now?: Date };

/** Refunds up to `amountFils` across the reservation's succeeded payments (newest first). Returns fils refunded. */
export async function refundReservationPayments(reservationId: string, amountFils: number, deps: Deps = {}): Promise<number> {
  const db = deps.db ?? getDb();
  const provider = deps.provider ?? getPaymentProvider();
  let remaining = amountFils;
  const rows = await db
    .select()
    .from(payments)
    .where(and(eq(payments.reservationId, reservationId), inArray(payments.status, ["SUCCEEDED", "PARTIALLY_REFUNDED"])))
    .orderBy(desc(payments.createdAt));
  for (const p of rows) {
    if (remaining <= 0) break;
    const refundable = p.amountFils - p.amountRefundedFils;
    const amount = Math.min(refundable, remaining);
    if (amount <= 0 || !p.providerPaymentId) continue;
    try {
      const result = await provider.refundPayment(p.providerPaymentId, amount);
      await db.transaction((tx) => applyPaymentState(tx, p.id, result));
      remaining -= amount;
      log.info("payment.refunded", { reservationId, paymentId: p.id, amountFils: amount });
    } catch (error) {
      log.error("payment.refund_failed", { reservationId, paymentId: p.id, amountFils: amount, error });
    }
  }
  return amountFils - remaining;
}

/** Voids still-pending payments. */
export async function cancelPendingPayments(reservationId: string, deps: Deps = {}): Promise<void> {
  const db = deps.db ?? getDb();
  const provider = deps.provider ?? getPaymentProvider();
  const rows = await db
    .select()
    .from(payments)
    .where(and(eq(payments.reservationId, reservationId), eq(payments.status, "PENDING")));
  for (const p of rows) {
    if (!p.providerPaymentId) {
      await db.update(payments).set({ status: "CANCELED", failureReason: "abandoned" }).where(and(eq(payments.id, p.id), eq(payments.status, "PENDING")));
      continue;
    }
    try {
      const result = await provider.cancelPayment(p.providerPaymentId);
      await db.transaction((tx) => applyPaymentState(tx, p.id, result));
    } catch (error) {
      log.error("payment.cancel_failed", { reservationId, paymentId: p.id, error });
    }
  }
}

/** Releases every HELD deposit of the reservation. Returns how many were released. */
export async function releaseReservationDeposits(reservationId: string, deps: Deps = {}): Promise<number> {
  const db = deps.db ?? getDb();
  const provider = deps.provider ?? getPaymentProvider();
  const rows = await db
    .select()
    .from(deposits)
    .where(and(eq(deposits.reservationId, reservationId), eq(deposits.status, "HELD")));
  let released = 0;
  for (const d of rows) {
    if (!d.providerHoldId) continue;
    try {
      const h = await provider.releaseDeposit(d.providerHoldId);
      await db.transaction((tx) => applyDepositState(tx, d.id, h, deps.now));
      released++;
      log.info("deposit.released", { reservationId, depositId: d.id });
    } catch (error) {
      log.error("deposit.release_failed", { reservationId, depositId: d.id, error });
    }
  }
  return released;
}

/**
 * Captures `amountFils` (capped at the hold) from the HELD deposit, or releases it
 * when the amount is 0. Returns fils captured.
 */
export async function settleReservationDeposit(reservationId: string, amountFils: number, deps: Deps = {}): Promise<number> {
  const db = deps.db ?? getDb();
  const provider = deps.provider ?? getPaymentProvider();
  const [d] = await db
    .select()
    .from(deposits)
    .where(and(eq(deposits.reservationId, reservationId), eq(deposits.status, "HELD")))
    .limit(1);
  if (!d || !d.providerHoldId) return 0;
  const capture = Math.min(amountFils, d.amountFils);
  if (capture <= 0) {
    await releaseReservationDeposits(reservationId, deps);
    return 0;
  }
  const h = await provider.captureDeposit(d.providerHoldId, capture);
  await db.transaction((tx) => applyDepositState(tx, d.id, h, deps.now));
  log.info("deposit.captured", { reservationId, depositId: d.id, amountFils: capture });
  return capture;
}
