// Expired-hold sweeper (DB-10). Idempotent and safe to run in parallel (e.g. two
// overlapping Vercel Cron invocations): every row is claimed with
// FOR UPDATE SKIP LOCKED in its own transaction and its status is re-checked under
// the lock, so concurrent runs never process the same row and a re-run finds
// nothing left to do.
//
// 1. PENDING reservations with hold_expires_at <= now  → EXPIRED (trigger frees the vehicle).
// 2. HELD deposits on EXPIRED / CANCELLED / REFUNDED reservations → released at the provider.
// 3. Payments on EXPIRED reservations: SUCCEEDED → refunded in full, PENDING → voided.
//    (A payment can succeed after its hold expired; the customer must not be charged.)
//
// Only rows created through the CURRENT provider (payments.provider / deposits.provider
// = provider.name) are touched: a Stripe id is never sent to the fake provider or vice versa.
//
// Ids the provider doesn't know ("orphans"):
// - PENDING payment / HELD deposit → nothing can be charged or is held at the provider,
//   so the row is closed (CANCELED / RELEASED, reason "provider_not_found") and counted as `orphaned`.
// - SUCCEEDED payment → money may have moved; never auto-closed. Counted as `failed`
//   and logged at error level for a human to resolve.

import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { getDb, type Db } from "../db";
import { deposits, payments, reservations } from "../db/schema";
import { log } from "../log";
import { getPaymentProvider } from "../payments";
import { PaymentError, type PaymentProvider } from "../payments/types";
import { applyDepositState, applyPaymentState } from "./payment-flow";

export type SweepResult = {
  expired: number;
  depositsReleased: number;
  paymentsRefunded: number;
  paymentsVoided: number;
  /** Rows closed because the provider has no record of them (nothing held or charged). */
  orphaned: number;
  failed: number;
};

export type SweepOptions = {
  now?: Date;
  db?: Db;
  provider?: PaymentProvider;
  batchSize?: number;
  /** Restrict the sweep to these vehicles (tests on a shared database, targeted admin runs). */
  vehicleIds?: string[];
};

/** True when the provider says the payment/hold id does not exist. */
export function isProviderNotFound(error: unknown): boolean {
  if (!(error instanceof PaymentError)) return false;
  return error.code === "not_found" || error.code === "resource_missing";
}

export async function releaseExpiredReservationHolds(opts: SweepOptions = {}): Promise<SweepResult> {
  const db = opts.db ?? getDb();
  const now = opts.now ?? new Date();
  const provider = opts.provider ?? getPaymentProvider();
  const batchSize = opts.batchSize ?? 100;
  const result: SweepResult = { expired: 0, depositsReleased: 0, paymentsRefunded: 0, paymentsVoided: 0, orphaned: 0, failed: 0 };
  if (opts.vehicleIds && opts.vehicleIds.length === 0) return result;
  const inScope: SQL | undefined = opts.vehicleIds ? inArray(reservations.vehicleId, opts.vehicleIds) : undefined;

  // ---- 1. expire holds ----
  for (;;) {
    const ids = await db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: reservations.id })
        .from(reservations)
        .where(and(eq(reservations.status, "PENDING"), sql`${reservations.holdExpiresAt} <= ${now.toISOString()}::timestamptz`, inScope))
        .orderBy(asc(reservations.holdExpiresAt))
        .limit(batchSize)
        .for("update", { skipLocked: true });
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.id);
      await tx
        .update(reservations)
        .set({ status: "EXPIRED", expiredAt: now })
        .where(and(inArray(reservations.id, ids), eq(reservations.status, "PENDING")));
      return ids;
    });
    result.expired += ids.length;
    if (ids.length) log.info("holds.expired", { count: ids.length, reservationIds: ids });
    if (ids.length < batchSize) break;
  }

  // ---- 2. release deposits ----
  const depositCandidates = await db
    .select({ id: deposits.id })
    .from(deposits)
    .innerJoin(reservations, eq(reservations.id, deposits.reservationId))
    .where(
      and(
        eq(deposits.status, "HELD"),
        eq(deposits.provider, provider.name),
        inArray(reservations.status, ["EXPIRED", "CANCELLED", "REFUNDED"]),
        inScope,
      ),
    )
    .limit(batchSize * 10);
  for (const { id } of depositCandidates) {
    try {
      const outcome = await db.transaction(async (tx) => {
        const [d] = await tx
          .select()
          .from(deposits)
          .where(and(eq(deposits.id, id), eq(deposits.status, "HELD")))
          .for("update", { skipLocked: true });
        if (!d || !d.providerHoldId) return null;
        try {
          await applyDepositState(tx, d.id, await provider.releaseDeposit(d.providerHoldId), now);
          return "released" as const;
        } catch (error) {
          if (!isProviderNotFound(error)) throw error;
          await tx
            .update(deposits)
            .set({ status: "RELEASED", releasedAt: now, failureReason: "provider_not_found" })
            .where(eq(deposits.id, d.id));
          log.warn("holds.deposit_orphaned", { depositId: d.id, providerHoldId: d.providerHoldId });
          return "orphaned" as const;
        }
      });
      if (outcome === "released") result.depositsReleased++;
      if (outcome === "orphaned") result.orphaned++;
    } catch (error) {
      result.failed++;
      log.error("holds.deposit_release_failed", { depositId: id, error });
    }
  }

  // ---- 3. refund / void payments on expired reservations ----
  const paymentCandidates = await db
    .select({ id: payments.id })
    .from(payments)
    .innerJoin(reservations, eq(reservations.id, payments.reservationId))
    .where(
      and(
        inArray(payments.status, ["SUCCEEDED", "PARTIALLY_REFUNDED", "PENDING"]),
        eq(payments.provider, provider.name),
        eq(reservations.status, "EXPIRED"),
        inScope,
      ),
    )
    .limit(batchSize * 10);
  for (const { id } of paymentCandidates) {
    try {
      const outcome = await db.transaction(async (tx) => {
        const [p] = await tx
          .select()
          .from(payments)
          .where(and(eq(payments.id, id), inArray(payments.status, ["SUCCEEDED", "PARTIALLY_REFUNDED", "PENDING"])))
          .for("update", { skipLocked: true });
        if (!p) return null;
        if (p.status === "PENDING") {
          if (!p.providerPaymentId) {
            await tx.update(payments).set({ status: "CANCELED", failureReason: "hold_expired" }).where(eq(payments.id, p.id));
            return "voided" as const;
          }
          try {
            await applyPaymentState(tx, p.id, await provider.cancelPayment(p.providerPaymentId));
            return "voided" as const;
          } catch (error) {
            if (!isProviderNotFound(error)) throw error;
            await tx.update(payments).set({ status: "CANCELED", failureReason: "provider_not_found" }).where(eq(payments.id, p.id));
            log.warn("holds.payment_orphaned", { paymentId: p.id, providerPaymentId: p.providerPaymentId });
            return "orphaned" as const;
          }
        }
        if (!p.providerPaymentId) return null;
        const remaining = p.amountFils - p.amountRefundedFils;
        if (remaining > 0) await applyPaymentState(tx, p.id, await provider.refundPayment(p.providerPaymentId, remaining));
        return "refunded" as const;
      });
      if (outcome === "voided") result.paymentsVoided++;
      if (outcome === "refunded") result.paymentsRefunded++;
      if (outcome === "orphaned") result.orphaned++;
    } catch (error) {
      result.failed++;
      log.error("holds.payment_cleanup_failed", { paymentId: id, error });
    }
  }

  log.info("holds.sweep", { ...result });
  return result;
}
