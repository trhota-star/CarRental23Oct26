// QA-4: payments + deposits with the fake provider: success, decline, cancel,
// pending, retry with the same idempotency key, deposit failure + retry,
// webhooks (valid, tampered, duplicate, parallel duplicates).

import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "@/server/db";
import { DomainError } from "@/server/errors";
import { PaymentError } from "@/server/payments/types";
import { handlePaymentWebhook } from "@/server/reservations/service";
import { addMinutes, createUser, newPool } from "./helpers/db";
import { createPricedFleet, drizzleFor } from "./helpers/fleet";
import { addDriverProfile, FAKE_PAYMENT_METHODS, fakeProvider, holdFor, pay, readyCustomer } from "./helpers/booking";

const pool = newPool(4);
const db = drizzleFor(pool);
afterAll(async () => {
  await pool.end();
  await closeDb();
});

const code = (e: unknown) => (e instanceof DomainError ? e.code : `non-domain: ${String(e)}`);
const rows = async (sql: string, id: string) => (await pool.query(sql, [id])).rows;
const paymentsOf = (id: string) => rows(`select status, amount_fils, idempotency_key from payments where reservation_id = $1 order by created_at`, id);
const depositsOf = (id: string) => rows(`select status, amount_fils from deposits where reservation_id = $1 order by created_at`, id);
const statusOf = async (id: string) => (await rows(`select status, hold_expires_at from reservations where id = $1`, id))[0];

describe("payForReservation", () => {
  it("success: charges the total, holds the deposit, confirms", async () => {
    const f = await createPricedFleet(pool);
    const user = await readyCustomer(pool);
    const provider = fakeProvider();
    const r = await holdFor(db, user, f, 100);
    const res = await pay(db, provider, user, r.id);
    expect(res.outcome).toBe("CONFIRMED");
    expect(res.reservation.status).toBe("CONFIRMED");
    expect(res.reservation.holdExpiresAt).toBeNull();
    // 2 days × 20,000 = 40,000 + VAT 2,000 = 42,000; deposit 200,000
    expect(await paymentsOf(r.id)).toMatchObject([{ status: "SUCCEEDED", amount_fils: 42_000 }]);
    expect(await depositsOf(r.id)).toMatchObject([{ status: "HELD", amount_fils: 200_000 }]);
    expect(res.reservation.paidFils).toBe(42_000);
  });

  it("decline: PAYMENT_FAILED, stays PENDING; retry with a new card confirms", async () => {
    const f = await createPricedFleet(pool);
    const user = await readyCustomer(pool);
    const provider = fakeProvider();
    const r = await holdFor(db, user, f, 101);
    const bad = await pay(db, provider, user, r.id, FAKE_PAYMENT_METHODS.decline);
    expect(bad.outcome).toBe("PAYMENT_FAILED");
    expect((await statusOf(r.id)).status).toBe("PENDING");
    expect(await depositsOf(r.id)).toEqual([]);
    const ok = await pay(db, provider, user, r.id, FAKE_PAYMENT_METHODS.success);
    expect(ok.outcome).toBe("CONFIRMED");
    expect((await paymentsOf(r.id)).map((p) => p.status)).toEqual(["FAILED", "SUCCEEDED"]);
  });

  it("customer cancels at checkout: PAYMENT_FAILED (canceled), not confirmed", async () => {
    const f = await createPricedFleet(pool);
    const user = await readyCustomer(pool);
    const r = await holdFor(db, user, f, 102);
    const res = await pay(db, fakeProvider(), user, r.id, FAKE_PAYMENT_METHODS.cancel);
    expect(res.outcome).toBe("PAYMENT_FAILED");
    expect(await paymentsOf(r.id)).toMatchObject([{ status: "CANCELED" }]);
    expect((await statusOf(r.id)).status).toBe("PENDING");
  });

  it("pending payment: PAYMENT_PENDING, no deposit, not confirmed", async () => {
    const f = await createPricedFleet(pool);
    const user = await readyCustomer(pool);
    const r = await holdFor(db, user, f, 103);
    const res = await pay(db, fakeProvider(), user, r.id, FAKE_PAYMENT_METHODS.pending);
    expect(res.outcome).toBe("PAYMENT_PENDING");
    expect((await statusOf(r.id)).status).toBe("PENDING");
  });

  it("retry with the same idempotency key (sequential + parallel): one payment, one charge, one deposit", async () => {
    const f = await createPricedFleet(pool);
    const user = await readyCustomer(pool);
    const provider = fakeProvider();
    const r = await holdFor(db, user, f, 104);
    const key = "qa-same-key-123456";
    const db2 = drizzleFor(newPool(2));
    const results = await Promise.allSettled([
      pay(db, provider, user, r.id, FAKE_PAYMENT_METHODS.success, key),
      pay(db2, provider, user, r.id, FAKE_PAYMENT_METHODS.success, key),
    ]);
    for (const x of results) expect(x.status, String((x as PromiseRejectedResult).reason)).toBe("fulfilled");
    const again = await pay(db, provider, user, r.id, FAKE_PAYMENT_METHODS.success, key);
    expect(again.outcome).toBe("ALREADY_CONFIRMED");
    expect(await paymentsOf(r.id)).toHaveLength(1);
    expect(await depositsOf(r.id)).toHaveLength(1);
    const events = await provider.listEvents();
    expect(events.filter((e) => e.type === "payment.succeeded")).toHaveLength(1);
    expect(events.filter((e) => e.type === "deposit.held")).toHaveLength(1);
    expect((await statusOf(r.id)).status).toBe("CONFIRMED");
  });

  it("an idempotency key used for another reservation is rejected", async () => {
    const f = await createPricedFleet(pool);
    const user = await readyCustomer(pool);
    const provider = fakeProvider();
    const a = await holdFor(db, user, f, 105);
    const b = await holdFor(db, user, f, 108);
    await pay(db, provider, user, a.id, FAKE_PAYMENT_METHODS.success, "qa-shared-key-0001");
    const err = await pay(db, provider, user, b.id, FAKE_PAYMENT_METHODS.success, "qa-shared-key-0001").catch((e) => e);
    expect(code(err)).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("deposit hold fails: DEPOSIT_FAILED; retry holds the deposit without charging again", async () => {
    const f = await createPricedFleet(pool);
    const user = await readyCustomer(pool);
    const provider = fakeProvider();
    const r = await holdFor(db, user, f, 110);
    const failingDeposit = Object.assign(Object.create(Object.getPrototypeOf(provider)), provider, {
      holdDeposit: (input: Parameters<typeof provider.holdDeposit>[0]) =>
        provider.holdDeposit({ ...input, paymentMethod: FAKE_PAYMENT_METHODS.decline }),
    });
    const first = await pay(db, failingDeposit, user, r.id);
    expect(first.outcome).toBe("DEPOSIT_FAILED");
    expect((await statusOf(r.id)).status).toBe("PENDING");
    const second = await pay(db, provider, user, r.id);
    expect(second.outcome).toBe("CONFIRMED");
    expect((await paymentsOf(r.id)).map((p) => p.status)).toEqual(["SUCCEEDED"]);
    expect((await depositsOf(r.id)).map((d) => d.status)).toEqual(["FAILED", "HELD"]);
  });

  it("refuses to pay: incomplete driver profile, expired hold, another user's booking", async () => {
    const f = await createPricedFleet(pool);
    const noLicence = { userId: (await createUser(pool)).id, role: "customer" as const };
    await addDriverProfile(pool, noLicence.userId, { licence: false });
    const r1 = await holdFor(db, noLicence, f, 120);
    expect(code(await pay(db, fakeProvider(), noLicence, r1.id).catch((e) => e))).toBe("DRIVER_PROFILE_INCOMPLETE");

    const under21 = { userId: (await createUser(pool)).id, role: "customer" as const };
    await addDriverProfile(pool, under21.userId, { dob: `${new Date().getUTCFullYear() - 19}-01-01` });
    const r2 = await holdFor(db, under21, f, 123);
    expect(code(await pay(db, fakeProvider(), under21, r2.id).catch((e) => e))).toBe("DRIVER_PROFILE_INCOMPLETE");

    const user = await readyCustomer(pool);
    const stale = await holdFor(db, user, f, 126, 2, { now: addMinutes(new Date(), -30) });
    expect(code(await pay(db, fakeProvider(), user, stale.id).catch((e) => e))).toBe("INVALID_STATE");

    const owner = await readyCustomer(pool);
    const other = await readyCustomer(pool);
    const r3 = await holdFor(db, owner, f, 129);
    expect(code(await pay(db, fakeProvider(), other, r3.id).catch((e) => e))).toBe("FORBIDDEN");
    expect(await paymentsOf(r3.id)).toEqual([]);
  });
});

describe("payment webhooks", () => {
  it("valid webhooks are processed once; duplicate and parallel redeliveries are no-ops", async () => {
    const f = await createPricedFleet(pool);
    const user = await readyCustomer(pool);
    const provider = fakeProvider();
    const r = await holdFor(db, user, f, 140);
    await pay(db, provider, user, r.id);
    const events = (await provider.listEvents()).filter((e) => e.data.reference === r.reference);
    expect(events.map((e) => e.type).sort()).toEqual(["deposit.held", "payment.succeeded"]);

    const deliver = (e: (typeof events)[number], d = db) => {
      const { body, headers } = provider.signedWebhook(e);
      return handlePaymentWebhook(body, headers[provider.webhookSignatureHeader], { db: d, provider });
    };
    const first = await Promise.all(events.map((e) => deliver(e)));
    expect(first.map((x) => x.status)).toEqual(["processed", "processed"]);
    const before = { p: await paymentsOf(r.id), d: await depositsOf(r.id), s: (await statusOf(r.id)).status };

    // 5 duplicate copies of each, delivered in parallel over two pools
    const db2 = drizzleFor(newPool(3));
    const dupes = await Promise.all(events.flatMap((e) => Array.from({ length: 5 }, (_, i) => deliver(e, i % 2 ? db2 : db))));
    expect(new Set(dupes.map((x) => x.status))).toEqual(new Set(["duplicate"]));

    const processed = await pool.query(`select count(*)::int n from processed_webhook_events where event_id = any($1)`, [
      events.map((e) => e.id),
    ]);
    expect(processed.rows[0].n).toBe(2);
    expect({ p: await paymentsOf(r.id), d: await depositsOf(r.id), s: (await statusOf(r.id)).status }).toEqual(before);
  });

  it("first-time parallel deliveries of the same event: exactly one 'processed'", async () => {
    const f = await createPricedFleet(pool);
    const user = await readyCustomer(pool);
    const provider = fakeProvider();
    const r = await holdFor(db, user, f, 145);
    await pay(db, provider, user, r.id);
    const [event] = (await provider.listEvents()).filter((e) => e.data.reference === r.reference && e.type === "payment.succeeded");
    const { body, headers } = provider.signedWebhook(event);
    const pools = [newPool(1), newPool(1), newPool(1), newPool(1)];
    try {
      const results = await Promise.all(
        pools.map((p) => handlePaymentWebhook(body, headers[provider.webhookSignatureHeader], { db: drizzleFor(p), provider })),
      );
      expect(results.filter((x) => x.status === "processed")).toHaveLength(1);
      expect(results.filter((x) => x.status === "duplicate")).toHaveLength(3);
    } finally {
      await Promise.all(pools.map((p) => p.end()));
    }
  });

  it("tampered or unsigned webhooks are rejected and not recorded", async () => {
    const f = await createPricedFleet(pool);
    const user = await readyCustomer(pool);
    const provider = fakeProvider();
    const r = await holdFor(db, user, f, 150);
    await pay(db, provider, user, r.id);
    const [event] = (await provider.listEvents()).filter((e) => e.data.reference === r.reference);
    const { body, headers } = provider.signedWebhook(event);
    const sig = headers[provider.webhookSignatureHeader];
    await expect(handlePaymentWebhook(body.replace(/"amount":\d+/, '"amount":1'), sig, { db, provider })).rejects.toBeInstanceOf(PaymentError);
    await expect(handlePaymentWebhook(body, null, { db, provider })).rejects.toBeInstanceOf(PaymentError);
    const n = await pool.query(`select count(*)::int n from processed_webhook_events where event_id = $1`, [event.id]);
    expect(n.rows[0].n).toBe(0);
  });

  it("an unknown payment id is ignored (recorded, no state change)", async () => {
    const provider = fakeProvider();
    await provider.createPayment({
      amount: 100,
      currency: "aed",
      reference: "DE-UNKNOWN",
      idempotencyKey: "qa-unknown-1",
      paymentMethod: FAKE_PAYMENT_METHODS.success,
    });
    const [event] = await provider.listEvents();
    const { body, headers } = provider.signedWebhook(event);
    const res = await handlePaymentWebhook(body, headers[provider.webhookSignatureHeader], { db, provider });
    expect(res.status).toBe("ignored");
  });
});
