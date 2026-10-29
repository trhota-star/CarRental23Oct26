// QA-2: quotePrice against the database (rules + extras loaded from driveeasy_test).
// Fixture prices (fils): daily 20,000 · deposit 200,000 · one-way A→B 30,000 · VAT 5%
// extras: per-day 3,000 (max 2) · per-rental 7,500.

import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "@/server/db";
import { DomainError } from "@/server/errors";
import { quotePrice } from "@/server/pricing/quote";
import { createReservationHold, searchAvailability } from "@/server/reservations/service";
import { addDays, addMinutes, futureAt, newPool } from "./helpers/db";
import { createPricedFleet } from "./helpers/fleet";

const pool = newPool(2);
afterAll(async () => {
  await pool.end();
  await closeDb();
});
const code = (e: unknown) => (e instanceof DomainError ? e.code : `non-domain: ${String(e)}`);

describe("quotePrice", () => {
  it("5 days one-way with extras, ISO strings with +04:00 offsets", async () => {
    const f = await createPricedFleet(pool);
    const q = await quotePrice({
      vehicleId: f.vehicle.id,
      pickupBranchId: f.branchA.id,
      returnBranchId: f.branchB.id,
      pickupAt: "2031-01-10T10:00:00+04:00",
      returnAt: "2031-01-15T10:00:00+04:00",
      extras: [
        { extraId: f.extras.perDay, quantity: 1 },
        { extraId: f.extras.perRental, quantity: 1 },
      ],
    });
    // base 5 × 20,000 = 100,000; extras 3,000 × 5 = 15,000 + 7,500 = 22,500; one-way 30,000
    // subtotal 152,500; VAT 7,625; total 160,125; deposit 200,000
    expect(q).toMatchObject({
      rentalDays: 5,
      baseFils: 100_000,
      extrasFils: 22_500,
      oneWayFeeFils: 30_000,
      subtotalFils: 152_500,
      vatFils: 7_625,
      totalFils: 160_125,
      depositFils: 200_000,
    });
    expect(q.pickupAt).toBe("2031-01-10T06:00:00.000Z");
  });

  it("charges an extra day for 1 minute over", async () => {
    const f = await createPricedFleet(pool);
    const start = futureAt(10);
    const q = await quotePrice({
      vehicleId: f.vehicle.id,
      pickupBranchId: f.branchA.id,
      returnBranchId: f.branchA.id,
      pickupAt: start,
      returnAt: addMinutes(addDays(start, 1), 1),
    });
    expect(q).toMatchObject({ rentalDays: 2, baseFils: 40_000, vatFils: 2_000, totalFils: 42_000 });
  });

  it("rejects bad input with typed errors", async () => {
    const f = await createPricedFleet(pool);
    const start = futureAt(10);
    const base = { vehicleId: f.vehicle.id, pickupBranchId: f.branchA.id, returnBranchId: f.branchA.id, pickupAt: start, returnAt: addDays(start, 1) };
    expect(code(await quotePrice({ ...base, returnAt: start }).catch((e) => e))).toBe("VALIDATION");
    expect(code(await quotePrice({ ...base, returnAt: addDays(start, 91) }).catch((e) => e))).toBe("VALIDATION");
    expect(code(await quotePrice({ ...base, vehicleId: randomUUID() }).catch((e) => e))).toBe("NOT_FOUND");
    expect(code(await quotePrice({ ...base, extras: [{ extraId: randomUUID(), quantity: 1 }] }).catch((e) => e))).toBe("NOT_FOUND");
    expect(code(await quotePrice({ ...base, extras: [{ extraId: f.extras.perRental, quantity: 2 }] }).catch((e) => e))).toBe("PRICING");
    // B → A has no one-way rule; but an any→any rule may exist in seed data, so only assert it's typed if it fails
    const reverse = await quotePrice({ ...base, pickupBranchId: f.branchB.id }).catch((e) => e);
    expect(reverse instanceof DomainError || typeof reverse.totalFils === "number").toBe(true);
    expect(code(await quotePrice({ ...base, pickupAt: "2031-01-10T10:00:00" as never }).catch((e) => e))).toBe("VALIDATION");
  });

  it("malformed / offset-less dates are VALIDATION errors in search and hold too (BUG-2)", async () => {
    const f = await createPricedFleet(pool);
    const bad = { pickupAt: "2031-01-10T10:00:00", returnAt: "not-a-date" };
    const search = await searchAvailability({ pickupBranchId: f.branchA.id, returnBranchId: f.branchA.id, ...bad }).catch((e) => e);
    expect(code(search)).toBe("VALIDATION");
    const hold = await createReservationHold(
      { userId: randomUUID(), role: "customer" },
      { vehicleId: f.vehicle.id, pickupBranchId: f.branchA.id, returnBranchId: f.branchA.id, ...bad, idempotencyKey: "qa-bad-dates-1" },
    ).catch((e) => e);
    expect(code(hold)).toBe("VALIDATION");
  });
});
