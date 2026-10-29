// Cancellation policy (pure, unit-tested).
//
// - PENDING (not yet confirmed): free; anything paid is refunded.
// - CONFIRMED ≥ 48 h before pick-up: full refund.
// - CONFIRMED < 48 h before pick-up: fee = one day's rate + VAT (capped at the amount paid).
// - After the pick-up time: customers cannot cancel; admins may cancel a no-show with no refund.
// - PICKED_UP / RETURNED / CANCELLED / EXPIRED / REFUNDED: not cancellable.

import { applyRate } from "../pricing/engine";

export const FREE_CANCELLATION_HOURS = 48;

export type CancellationPreview = {
  cancellable: boolean;
  reason?: string;
  refundFils: number;
  feeFils: number;
  policy: string;
};

export const CANCELLATION_POLICY_TEXT =
  `Free cancellation up to ${FREE_CANCELLATION_HOURS} hours before pick-up. ` +
  `Within ${FREE_CANCELLATION_HOURS} hours, one day's rental (plus VAT) is kept. ` +
  "No refunds after the pick-up time.";

export function computeCancellation(input: {
  status: string;
  pickupAt: Date;
  now: Date;
  paidFils: number;
  dailyRateFils: number;
  vatRateBps: number;
  isAdmin: boolean;
}): CancellationPreview {
  const policy = CANCELLATION_POLICY_TEXT;
  const no = (reason: string): CancellationPreview => ({ cancellable: false, reason, refundFils: 0, feeFils: 0, policy });
  if (input.status === "PENDING") return { cancellable: true, refundFils: input.paidFils, feeFils: 0, policy };
  if (input.status !== "CONFIRMED") return no(`A ${input.status.toLowerCase().replace("_", " ")} booking can't be cancelled`);

  const msToPickup = input.pickupAt.getTime() - input.now.getTime();
  if (msToPickup <= 0) {
    if (!input.isAdmin) return no("The pick-up time has passed. Please contact the branch.");
    return { cancellable: true, refundFils: 0, feeFils: input.paidFils, policy };
  }
  if (msToPickup >= FREE_CANCELLATION_HOURS * 3_600_000) {
    return { cancellable: true, refundFils: input.paidFils, feeFils: 0, policy };
  }
  const fee = Math.min(input.paidFils, input.dailyRateFils + applyRate(input.dailyRateFils, input.vatRateBps));
  return { cancellable: true, refundFils: input.paidFils - fee, feeFils: fee, policy };
}
