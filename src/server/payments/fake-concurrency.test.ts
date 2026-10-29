// BUG-4 regression: several FakePaymentProvider instances (= several processes:
// dev server, `pnpm job`, seed, test workers) sharing one state file must not lose updates.

import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FAKE_PAYMENT_METHODS, FakePaymentProvider } from "./fake";

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("FakePaymentProvider shared state file", () => {
  it("keeps every payment and hold when instances write concurrently", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "fake-race-"));
    const file = path.join(dir, "state.json");
    const instances = Array.from({ length: 4 }, () => new FakePaymentProvider({ stateFile: file, webhookSecret: "x" }));
    const req = (i: number) => ({ amount: 1000, currency: "aed", reference: `r${i}`, idempotencyKey: `k${i}`, paymentMethod: FAKE_PAYMENT_METHODS.success });
    const [payments, holds] = await Promise.all([
      Promise.all(Array.from({ length: 40 }, (_, i) => instances[i % 4].createPayment(req(i)))),
      Promise.all(Array.from({ length: 20 }, (_, i) => instances[(i + 1) % 4].holdDeposit(req(100 + i)))),
    ]);

    const reader = new FakePaymentProvider({ stateFile: file, webhookSecret: "x" });
    for (const p of payments) expect((await reader.refundPayment(p.id, 1)).amountRefunded).toBe(1);
    for (const h of holds) expect((await reader.releaseDeposit(h.id)).status).toBe("released");
    // No temp files or lock left behind.
    expect((await readdir(dir)).sort()).toEqual(["state.json"]);
  }, 15_000);

  it("keeps idempotency across instances (same key → same payment)", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "fake-race-"));
    const file = path.join(dir, "state.json");
    const a = new FakePaymentProvider({ stateFile: file, webhookSecret: "x" });
    const b = new FakePaymentProvider({ stateFile: file, webhookSecret: "x" });
    const req = { amount: 1000, currency: "aed", reference: "r", idempotencyKey: "same", paymentMethod: FAKE_PAYMENT_METHODS.success };
    const results = await Promise.all([a.createPayment(req), b.createPayment(req), a.createPayment(req), b.createPayment(req)]);
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
  });
});
