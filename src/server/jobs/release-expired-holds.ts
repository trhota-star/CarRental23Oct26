import type { PaymentProvider } from "../payments/types";

/** A booking hold whose time has run out. */
export type ExpiredHold = {
  id: string;
  /** Deposit hold at the payment provider, if one was taken. */
  depositHoldId: string | null;
};

/** Where holds live. Implemented over the database once bookings exist. */
export interface HoldStore {
  findExpired(now: Date, limit: number): Promise<ExpiredHold[]>;
  markReleased(holdId: string, now: Date): Promise<void>;
}

export type ReleaseResult = { released: number; failed: number };

export async function releaseExpiredHolds(deps: {
  now: Date;
  holds: HoldStore;
  payments: PaymentProvider;
  batchSize?: number;
}): Promise<ReleaseResult> {
  const expired = await deps.holds.findExpired(deps.now, deps.batchSize ?? 100);
  const result: ReleaseResult = { released: 0, failed: 0 };
  for (const hold of expired) {
    try {
      if (hold.depositHoldId) await deps.payments.releaseDeposit(hold.depositHoldId);
      await deps.holds.markReleased(hold.id, deps.now);
      result.released++;
    } catch (error) {
      result.failed++;
      console.error(`[release-expired-holds] hold ${hold.id}: ${(error as Error).message}`);
    }
  }
  return result;
}
