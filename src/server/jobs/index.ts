// Scheduled jobs. Locally they run via `pnpm job <name>` (SCHEDULER_PROVIDER=local);
// in the cloud a cron service will call the same jobs.

import { getPaymentProvider } from "../payments";
import { releaseExpiredHolds, type HoldStore } from "./release-expired-holds";

export type ScheduledJob = {
  description: string;
  run(now: Date): Promise<string>;
};

// There is no bookings table yet, so nothing can expire. Replace with Drizzle
// queries when the bookings schema is built.
const bookingHolds: HoldStore = {
  findExpired: async () => [],
  markReleased: async () => {},
};

export const jobs: Record<string, ScheduledJob> = {
  "release-expired-holds": {
    description: "Release booking holds (and their deposits) that have expired",
    async run(now) {
      const r = await releaseExpiredHolds({ now, holds: bookingHolds, payments: getPaymentProvider() });
      return `released ${r.released}, failed ${r.failed}`;
    },
  },
};
