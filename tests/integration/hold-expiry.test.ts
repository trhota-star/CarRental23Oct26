// QA-2: expired PENDING holds → EXPIRED; HELD deposits released; payments taken on
// an expired hold refunded. Idempotent across repeated and parallel runs
// (SKIP LOCKED), and via the `pnpm job release-expired-holds` CLI.
// The HTTP cron route (401 / 200) is covered in tests/e2e/api-cron.spec.ts.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "@/server/db";
import { FAKE_PAYMENT_METHODS } from "@/server/payments/fake";
import { addMinutes, newPool } from "./helpers/db";
import { createPricedFleet, drizzleFor } from "./helpers/fleet";
import { fakeProvider, holdFor, readyCustomer } from "./helpers/booking";
import { loadFns } from "./helpers/pending";

const api = await loadFns(["@/server/reservations/service"], ["releaseExpiredReservationHolds"] as const);

const pool = newPool(4);
const db = drizzleFor(pool);
afterAll(async () => {
  await pool.end();
  await closeDb();
});

const status = async (id: string) => (await pool.query(`select status from reservations where id = $1`, [id])).rows[0].status;
const past = () => addMinutes(new Date(), -30);

describe.skipIf(!api.ready)(`release expired holds${api.ready ? "" : ` (missing: ${api.missing})`}`, () => {
  const { releaseExpiredReservationHolds: release } = api.fns;

  it("expires only stale PENDING holds; fresh holds and confirmed bookings are untouched", async () => {
    const f = await createPricedFleet(pool, 2);
    const user = await readyCustomer(pool);
    const stale = await holdFor(db, user, f, 300, 2, { now: past() });
    const fresh = await holdFor(db, user, { ...f, vehicle: f.vehicles[1] }, 300);
    const provider = fakeProvider();
    await release({ db, provider });
    expect(await status(stale.id)).toBe("EXPIRED");
    expect(await status(fresh.id)).toBe("PENDING");
    const booking = await pool.query(`select count(*)::int n from vehicle_bookings where reservation_id = $1`, [stale.id]);
    expect(booking.rows[0].n).toBe(0);
  });

  it("releases a HELD deposit and refunds a succeeded payment on an expired hold", async () => {
    const f = await createPricedFleet(pool);
    const user = await readyCustomer(pool);
    const provider = fakeProvider();
    const r = await holdFor(db, user, f, 301, 2, { now: past() });
    // Simulate money taken just before the hold ran out (e.g. a late webhook).
    const p = await provider.createPayment({ amount: 42_000, currency: "aed", reference: r.reference, idempotencyKey: `qa-x-${r.id}`, paymentMethod: FAKE_PAYMENT_METHODS.success });
    const h = await provider.holdDeposit({ amount: 200_000, currency: "aed", reference: r.reference, idempotencyKey: `qa-xd-${r.id}`, paymentMethod: FAKE_PAYMENT_METHODS.success });
    await pool.query(
      `insert into payments (reservation_id, provider, provider_payment_id, idempotency_key, amount_fils, status) values ($1, $2, $3, $4, 42000, 'SUCCEEDED')`,
      [r.id, provider.name, p.id, `qa-x-${r.id}`],
    );
    await pool.query(
      `insert into deposits (reservation_id, provider, provider_hold_id, idempotency_key, amount_fils, status) values ($1, $2, $3, $4, 200000, 'HELD')`,
      [r.id, provider.name, h.id, `qa-xd-${r.id}`],
    );

    const out = await release({ db, provider });
    expect(out.failed).toBe(0);
    expect(await status(r.id)).toBe("EXPIRED");
    const dep = (await pool.query(`select status from deposits where reservation_id = $1`, [r.id])).rows[0];
    const pay = (await pool.query(`select status, amount_refunded_fils from payments where reservation_id = $1`, [r.id])).rows[0];
    expect(dep.status).toBe("RELEASED");
    expect(pay).toMatchObject({ status: "REFUNDED", amount_refunded_fils: 42_000 });
    const events = await provider.listEvents();
    expect(events.filter((e) => e.type === "deposit.released")).toHaveLength(1);
    expect(events.filter((e) => e.type === "payment.refunded")).toHaveLength(1);

    // second run: nothing more happens at the provider
    await release({ db, provider });
    const after = await provider.listEvents();
    expect(after.filter((e) => e.type === "payment.refunded")).toHaveLength(1);
    expect(after.filter((e) => e.type === "deposit.released")).toHaveLength(1);
  });

  it("repeated and parallel runs (separate pools) expire each hold exactly once", async () => {
    const f = await createPricedFleet(pool, 6);
    const user = await readyCustomer(pool);
    const ids: string[] = [];
    for (const v of f.vehicles) ids.push((await holdFor(db, user, { ...f, vehicle: v }, 310, 2, { now: past() })).id);
    const provider = fakeProvider();
    const pools = [newPool(2), newPool(2), newPool(2), newPool(2)];
    try {
      const results = await Promise.all(pools.map((p) => release({ db: drizzleFor(p), provider, batchSize: 2 })));
      for (const r of results) expect(r.failed).toBe(0);
      for (const id of ids) expect(await status(id)).toBe("EXPIRED");
      const audits = await pool.query(
        `select count(*)::int n from audit_logs where entity_id = any($1::uuid[]) and action ilike '%expire%'`,
        [ids],
      );
      expect(audits.rows[0].n).toBeLessThanOrEqual(ids.length);
      const again = await release({ db, provider });
      expect(again.failed).toBe(0);
    } finally {
      await Promise.all(pools.map((p) => p.end()));
    }
  });

  it("`pnpm job release-expired-holds` (tsx scripts/job.ts) expires holds in the test DB, twice in a row", async () => {
    const f = await createPricedFleet(pool);
    const user = await readyCustomer(pool);
    const r = await holdFor(db, user, f, 320, 2, { now: past() });
    const run = () =>
      execFileSync(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), "scripts/job.ts", "release-expired-holds"], {
        env: {
          ...process.env,
          DATABASE_URL: process.env.TEST_DATABASE_URL,
          FAKE_PAYMENTS_STATE_FILE: ".local/fake-payments.test.json",
          PAYMENT_WEBHOOK_URL: "",
        },
        encoding: "utf8",
      });
    run();
    expect(await status(r.id)).toBe("EXPIRED");
    expect(() => run()).not.toThrow();
  }, 60_000);
});
