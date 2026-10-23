// QA-2 / QA-3: createReservationHold, quotes, back-to-back, maintenance,
// idempotency, stale holds, search/calendar, and the ≥20-run concurrency gate
// with two independent connection pools.

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/server/db";
import { DomainError } from "@/server/errors";
import { getVehicleCalendar, searchAvailability } from "@/server/reservations/availability";
import { createReservationHold, type CreateReservationHoldInput } from "@/server/reservations/hold";
import { addDays, addMinutes, createUser, futureAt, insertMaintenanceRow, newPool } from "./helpers/db";
import { createPricedFleet, drizzleFor, PRICES, type PricedFleet } from "./helpers/fleet";

const pool = newPool(4);
const db = drizzleFor(pool);
let alice: { userId: string; role: "customer" };
let bob: { userId: string; role: "customer" };

beforeAll(async () => {
  alice = { userId: (await createUser(pool)).id, role: "customer" };
  bob = { userId: (await createUser(pool)).id, role: "customer" };
});
afterAll(async () => {
  await pool.end();
  await closeDb();
});

const key = () => `qa-${randomUUID()}`;
function holdInput(f: PricedFleet, pickupAt: Date, returnAt: Date, extra: Partial<CreateReservationHoldInput> = {}) {
  return {
    vehicleId: f.vehicle.id,
    pickupBranchId: f.branchA.id,
    returnBranchId: f.branchA.id,
    pickupAt,
    returnAt,
    extras: [],
    idempotencyKey: key(),
    ...extra,
  } as CreateReservationHoldInput;
}
const errorCode = (e: unknown) => (e instanceof DomainError ? e.code : `non-domain: ${String(e)}`);

describe("createReservationHold", () => {
  it("creates a PENDING hold with a 15-minute expiry and a server-side price snapshot", async () => {
    const f = await createPricedFleet(pool);
    const now = new Date();
    const start = futureAt(20);
    const r = await createReservationHold(
      alice,
      holdInput(f, start, addDays(start, 3), {
        returnBranchId: f.branchB.id,
        extras: [
          { extraId: f.extras.perDay, quantity: 2 },
          { extraId: f.extras.perRental, quantity: 1 },
        ],
      }),
      { db, now },
    );
    expect(r.status).toBe("PENDING");
    expect(r.reference).toMatch(/^DE-[A-Z0-9]{8}$/);
    expect(r.holdExpiresAt!.getTime() - now.getTime()).toBe(15 * 60_000);
    // base 3 × 20,000 = 60,000; extras 3,000 × 2 × 3 = 18,000 + 7,500 = 25,500;
    // one-way 30,000; subtotal 115,500; VAT 5,775; total 121,275; deposit 200,000.
    expect(r.pricing).toMatchObject({
      currency: "AED",
      rentalDays: 3,
      dailyRateFils: 20_000,
      baseFils: 60_000,
      extrasFils: 25_500,
      oneWayFeeFils: 30_000,
      subtotalFils: 115_500,
      vatRateBps: PRICES.vatBps,
      vatFils: 5_775,
      totalFils: 121_275,
      depositFils: 200_000,
    });
    expect(r.extras.map((e) => e.totalFils).sort((a, b) => a - b)).toEqual([7_500, 18_000]);
  });

  it("back-to-back holds both succeed; a 1-minute overlap is rejected as VEHICLE_UNAVAILABLE", async () => {
    const f = await createPricedFleet(pool);
    const start = futureAt(21);
    await createReservationHold(alice, holdInput(f, start, addDays(start, 2)), { db });
    await expect(createReservationHold(bob, holdInput(f, addDays(start, 2), addDays(start, 4)), { db })).resolves.toMatchObject({
      status: "PENDING",
    });
    await expect(createReservationHold(bob, holdInput(f, addDays(start, -1), start), { db })).resolves.toMatchObject({
      status: "PENDING",
    });
    const err = await createReservationHold(bob, holdInput(f, addMinutes(addDays(start, 4), -1), addDays(start, 5)), { db }).catch(
      (e) => e,
    );
    expect(errorCode(err)).toBe("VEHICLE_UNAVAILABLE");
  });

  it("rejects a hold overlapping a maintenance block", async () => {
    const f = await createPricedFleet(pool);
    const start = futureAt(22);
    await insertMaintenanceRow(pool, f.vehicle.id, start, addDays(start, 1));
    const err = await createReservationHold(alice, holdInput(f, addMinutes(start, 30), addDays(start, 2)), { db }).catch((e) => e);
    expect(errorCode(err)).toBe("VEHICLE_UNAVAILABLE");
    // ending exactly when maintenance starts is fine
    await expect(createReservationHold(alice, holdInput(f, addDays(start, -2), start), { db })).resolves.toBeTruthy();
  });

  it("is idempotent: same key → same reservation; same key, different request → IDEMPOTENCY_CONFLICT", async () => {
    const f = await createPricedFleet(pool);
    const start = futureAt(23);
    const input = holdInput(f, start, addDays(start, 1));
    const [a, b] = await Promise.all([
      createReservationHold(alice, input, { db }),
      createReservationHold(alice, input, { db: drizzleFor(newPool(1)) }),
    ]);
    expect(a.id).toBe(b.id);
    const again = await createReservationHold(alice, input, { db });
    expect(again.id).toBe(a.id);
    const { rows } = await pool.query(`select count(*)::int n from reservations where vehicle_id = $1`, [f.vehicle.id]);
    expect(rows[0].n).toBe(1);
    const err = await createReservationHold(alice, { ...input, returnAt: addDays(start, 2) }, { db }).catch((e) => e);
    expect(errorCode(err)).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("an expired PENDING hold no longer blocks; it is marked EXPIRED when the slot is re-held", async () => {
    const f = await createPricedFleet(pool);
    const start = futureAt(24);
    const stale = await createReservationHold(alice, holdInput(f, start, addDays(start, 2)), {
      db,
      now: addMinutes(new Date(), -30),
    });
    const fresh = await createReservationHold(bob, holdInput(f, start, addDays(start, 2)), { db });
    expect(fresh.status).toBe("PENDING");
    const { rows } = await pool.query(`select status from reservations where id = $1`, [stale.id]);
    expect(rows[0].status).toBe("EXPIRED");
  });

  it("validates input: past pick-up, wrong pick-up branch, return before pick-up, unknown vehicle", async () => {
    const f = await createPricedFleet(pool);
    const past = addDays(new Date(), -1);
    expect(errorCode(await createReservationHold(alice, holdInput(f, past, addDays(past, 2)), { db }).catch((e) => e))).toBe("VALIDATION");
    const start = futureAt(25);
    expect(
      errorCode(
        await createReservationHold(alice, holdInput(f, start, addDays(start, 1), { pickupBranchId: f.branchB.id }), { db }).catch((e) => e),
      ),
    ).toBe("VALIDATION");
    expect(errorCode(await createReservationHold(alice, holdInput(f, start, addDays(start, -1)), { db }).catch((e) => e))).toBe(
      "VALIDATION",
    );
    expect(
      errorCode(await createReservationHold(alice, holdInput(f, start, addDays(start, 1), { vehicleId: randomUUID() }), { db }).catch((e) => e)),
    ).toBe("NOT_FOUND");
  });

  it("rejects an invalid actor", async () => {
    const f = await createPricedFleet(pool);
    const start = futureAt(26);
    const err = await createReservationHold({ userId: "nope", role: "customer" } as never, holdInput(f, start, addDays(start, 1)), {
      db,
    }).catch((e) => e);
    expect(errorCode(err)).toBe("FORBIDDEN");
  });
});

describe("concurrency gate: two independent sessions, overlapping dates", () => {
  it("exactly one hold wins, the other gets VEHICLE_UNAVAILABLE — 25 runs", async () => {
    const poolA = newPool(2);
    const poolB = newPool(2);
    const dbA = drizzleFor(poolA);
    const dbB = drizzleFor(poolB);
    const outcomes: string[] = [];
    try {
      for (let run = 0; run < 25; run++) {
        const f = await createPricedFleet(pool);
        const start = futureAt(30 + run);
        const results = await Promise.allSettled([
          createReservationHold(alice, holdInput(f, start, addDays(start, 3)), { db: dbA }),
          createReservationHold(bob, holdInput(f, addDays(start, 1), addDays(start, 4)), { db: dbB }),
        ]);
        const won = results.filter((r) => r.status === "fulfilled");
        const lost = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
        outcomes.push(results.map((r) => (r.status === "fulfilled" ? "W" : errorCode(r.reason))).join("/"));
        expect(won, `run ${run}: ${outcomes.at(-1)}`).toHaveLength(1);
        expect(errorCode(lost[0].reason), `run ${run}`).toBe("VEHICLE_UNAVAILABLE");
        const { rows } = await pool.query(
          `select count(*)::int n from reservations where vehicle_id = $1 and status = 'PENDING'`,
          [f.vehicle.id],
        );
        expect(rows[0].n).toBe(1);
      }
    } finally {
      await Promise.all([poolA.end(), poolB.end()]);
    }
    console.log(`[concurrency] 25 runs: ${outcomes.join(" ")}`);
  });

  it("ten simultaneous sessions on the same slot: exactly one winner", async () => {
    const pools = Array.from({ length: 10 }, () => newPool(1));
    try {
      const f = await createPricedFleet(pool);
      const start = futureAt(60);
      const users = await Promise.all(pools.map(async () => ({ userId: (await createUser(pool)).id, role: "customer" as const })));
      const results = await Promise.allSettled(
        pools.map((p, i) => createReservationHold(users[i], holdInput(f, start, addDays(start, 2)), { db: drizzleFor(p) })),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of results) if (r.status === "rejected") expect(errorCode(r.reason)).toBe("VEHICLE_UNAVAILABLE");
    } finally {
      await Promise.all(pools.map((p) => p.end()));
    }
  });
});

describe("availability", () => {
  it("search excludes booked/maintenance vehicles, includes back-to-back, quotes each result", async () => {
    const f = await createPricedFleet(pool, 3);
    const [v1, v2, v3] = f.vehicles;
    const start = futureAt(70);
    await createReservationHold(alice, holdInput(f, start, addDays(start, 2), { vehicleId: v1.id }), { db });
    await insertMaintenanceRow(pool, v2.id, addDays(start, 1), addDays(start, 3));
    // v3 is booked back-to-back (ends exactly at the requested pick-up)
    await createReservationHold(alice, holdInput(f, addDays(start, -2), start, { vehicleId: v3.id }), { db });

    const results = await searchAvailability({
      pickupBranchId: f.branchA.id,
      returnBranchId: f.branchA.id,
      pickupAt: start,
      returnAt: addDays(start, 2),
      categoryId: f.category.id,
    });
    expect(results.map((r) => r.id)).toEqual([v3.id]);
    expect(results[0].quote).toMatchObject({ baseFils: 40_000, vatFils: 2_000, totalFils: 42_000, depositFils: 200_000 });
  });

  it("search filters: transmission, fuel, seats, price range", async () => {
    const f = await createPricedFleet(pool);
    const start = futureAt(71);
    const base = { pickupBranchId: f.branchA.id, returnBranchId: f.branchA.id, pickupAt: start, returnAt: addDays(start, 1), categoryId: f.category.id };
    const ids = async (extra: object) => (await searchAvailability({ ...base, ...extra })).map((r) => r.id);
    expect(await ids({})).toEqual([f.vehicle.id]);
    expect(await ids({ transmission: "AUTOMATIC" })).toEqual([f.vehicle.id]);
    expect(await ids({ transmission: "MANUAL" })).toEqual([]);
    expect(await ids({ fuelType: "PETROL" })).toEqual([f.vehicle.id]);
    expect(await ids({ fuelType: "ELECTRIC" })).toEqual([]);
    expect(await ids({ minSeats: 5 })).toEqual([f.vehicle.id]);
    expect(await ids({ minSeats: 7 })).toEqual([]);
    expect(await ids({ minDailyRateFils: 20_000, maxDailyRateFils: 20_000 })).toEqual([f.vehicle.id]);
    expect(await ids({ maxDailyRateFils: 19_999 })).toEqual([]);
    // one-way search includes the one-way fee in the quote
    const oneWay = await searchAvailability({ ...base, returnBranchId: f.branchB.id });
    expect(oneWay[0].quote).toMatchObject({ oneWayFeeFils: 30_000, subtotalFils: 50_000, vatFils: 2_500, totalFils: 52_500 });
  });

  it("an expired hold does not hide the vehicle from search", async () => {
    const f = await createPricedFleet(pool);
    const start = futureAt(72);
    await createReservationHold(alice, holdInput(f, start, addDays(start, 1)), { db, now: addMinutes(new Date(), -20) });
    const results = await searchAvailability({
      pickupBranchId: f.branchA.id,
      returnBranchId: f.branchA.id,
      pickupAt: start,
      returnAt: addDays(start, 1),
      categoryId: f.category.id,
    });
    expect(results.map((r) => r.id)).toEqual([f.vehicle.id]);
  });

  it("calendar lists busy intervals (reservation + maintenance) without customer data", async () => {
    const f = await createPricedFleet(pool);
    const start = futureAt(73);
    await createReservationHold(alice, holdInput(f, start, addDays(start, 1)), { db });
    await insertMaintenanceRow(pool, f.vehicle.id, addDays(start, 2), addDays(start, 3));
    const cal = await getVehicleCalendar({ vehicleId: f.vehicle.id, from: addDays(start, -1), to: addDays(start, 5) });
    expect(cal.busy).toEqual([
      { start: start.toISOString(), end: addDays(start, 1).toISOString(), kind: "RESERVED" },
      { start: addDays(start, 2).toISOString(), end: addDays(start, 3).toISOString(), kind: "MAINTENANCE" },
    ]);
    expect(JSON.stringify(cal)).not.toContain(alice.userId);
  });
});
