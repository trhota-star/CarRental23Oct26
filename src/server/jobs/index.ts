// Scheduled jobs. Locally they run via `pnpm job <name>` (SCHEDULER_PROVIDER=local);
// in the cloud Vercel Cron calls /api/cron/<name>, which runs the same job.

import { releaseExpiredReservationHolds } from "../reservations/expiry";

export type ScheduledJob = {
  description: string;
  run(now: Date): Promise<string>;
};

export const jobs: Record<string, ScheduledJob> = {
  "release-expired-holds": {
    description: "Expire unpaid reservation holds, release their deposits and refund late payments",
    async run(now) {
      const r = await releaseExpiredReservationHolds({ now });
      return `expired ${r.expired}, deposits released ${r.depositsReleased}, payments refunded ${r.paymentsRefunded}, voided ${r.paymentsVoided}, orphaned ${r.orphaned}, failed ${r.failed}`;
    },
  },
};
