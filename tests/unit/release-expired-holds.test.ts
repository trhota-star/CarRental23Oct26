import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { releaseExpiredHolds, type HoldStore } from "@/server/jobs/release-expired-holds";
import { FAKE_PAYMENT_METHODS, FakePaymentProvider } from "@/server/payments/fake";

describe("releaseExpiredHolds", () => {
  it("releases deposits and marks holds released, continuing past failures", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "holds-"));
    try {
      const payments = new FakePaymentProvider({ stateFile: path.join(dir, "s.json"), webhookSecret: "x" });
      const deposit = await payments.holdDeposit({
        amount: 20000,
        currency: "usd",
        reference: "booking_1",
        idempotencyKey: "d1",
        paymentMethod: FAKE_PAYMENT_METHODS.success,
      });

      const released: string[] = [];
      const holds: HoldStore = {
        findExpired: async () => [
          { id: "h1", depositHoldId: deposit.id },
          { id: "h2", depositHoldId: "fhold_missing" },
          { id: "h3", depositHoldId: null },
        ],
        markReleased: async (id) => void released.push(id),
      };

      const result = await releaseExpiredHolds({ now: new Date(), holds, payments });
      expect(result).toEqual({ released: 2, failed: 1 });
      expect(released).toEqual(["h1", "h3"]);
      expect((await payments.listEvents()).at(-1)?.type).toBe("deposit.released");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
