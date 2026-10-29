// QA-2 / QA-4: cancellation + refund policy, date changes, check-out / check-in
// (late fee, damage, deposit capture / release). Skipped until DB-8 / DB-9 land.
//
// Fixture (fils): daily 20,000 · VAT 5% · deposit 200,000 · late 4,000/started hour, 30 min grace.
// A 2-day booking costs 40,000 + 2,000 VAT = 42,000.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/server/db";
import { DomainError } from "@/server/errors";
import { addDays, addMinutes, createUser, newPool } from "./helpers/db";
import { createPricedFleet, drizzleFor, type PricedFleet } from "./helpers/fleet";
import { fakeProvider, holdFor, pay, readyCustomer } from "./helpers/booking";
import { loadFns } from "./helpers/pending";

const SVC = ["@/server/reservations/service"];
const cancelApi = await loadFns(SVC, ["cancelReservation", "previewCancellation"] as const);
const modifyApi = await loadFns(SVC, ["modifyReservationDates", "previewModification"] as const);
const desk = await loadFns(SVC, ["checkOutReservation", "checkInReservation", "previewCheckIn"] as const);

const pool = newPool(4);
const db = drizzleFor(pool);
let admin: { userId: string; role: "admin" };
beforeAll(async () => {
  admin = { userId: (await createUser(pool, "admin")).id, role: "admin" };
});
afterAll(async () => {
  await pool.end();
  await closeDb();
});

const code = (e: unknown) => (e instanceof DomainError ? e.code : `non-domain: ${String(e)}`);
const one = async (sql: string, id: string) => (await pool.query(sql, [id])).rows[0];
const payment = (rid: string) => one(`select status, amount_fils, amount_refunded_fils from payments where reservation_id = $1 and purpose = 'RENTAL' and status <> 'FAILED'`, rid);
const deposit = (rid: string) => one(`select status, amount_fils, amount_captured_fils from deposits where reservation_id = $1 and status <> 'FAILED'`, rid);
const res = (rid: string) => one(`select status, pickup_at, return_at from reservations where id = $1`, rid);

/** A CONFIRMED 2-day reservation `dayOffset` days out, paid with the fake provider. */
async function confirmed(f: PricedFleet, dayOffset: number, days = 2) {
  const user = await readyCustomer(pool);
  const provider = fakeProvider();
  const r = await holdFor(db, user, f, dayOffset, days);
  const paid = await pay(db, provider, user, r.id);
  expect(paid.outcome).toBe("CONFIRMED");
  return { user, provider, r };
}

describe.skipIf(!cancelApi.ready)(`cancellation policy${cancelApi.ready ? "" : ` (missing: ${cancelApi.missing})`}`, () => {
  const { cancelReservation, previewCancellation } = cancelApi.fns;

  it("PENDING (unpaid) cancels for free and frees the slot", async () => {
    const f = await createPricedFleet(pool);
    const user = await readyCustomer(pool);
    const r = await holdFor(db, user, f, 200);
    const out = await cancelReservation(user, { reservationId: r.id }, { db });
    expect(out.status).toBe("CANCELLED");
    await expect(holdFor(db, await readyCustomer(pool), f, 200)).resolves.toMatchObject({ status: "PENDING" });
  });

  it("CONFIRMED ≥ 48h before pick-up: full refund, deposit released", async () => {
    const f = await createPricedFleet(pool);
    const { user, provider, r } = await confirmed(f, 201);
    const now = addMinutes(r.pickupAt, -49 * 60);
    const preview = await previewCancellation(user, r.id, { db, now });
    expect(preview).toMatchObject({ cancellable: true, refundFils: 42_000, feeFils: 0 });
    const out = await cancelReservation(user, { reservationId: r.id, reason: "QA" }, { db, now, provider });
    expect(out.status).toBe("CANCELLED");
    expect(await payment(r.id)).toMatchObject({ status: "REFUNDED", amount_refunded_fils: 42_000 });
    expect(await deposit(r.id)).toMatchObject({ status: "RELEASED", amount_captured_fils: 0 });
  });

  it("CONFIRMED < 48h before pick-up: fee = one day + VAT (21,000), refund 21,000", async () => {
    const f = await createPricedFleet(pool);
    const { user, provider, r } = await confirmed(f, 202);
    const now = addMinutes(r.pickupAt, -24 * 60);
    expect(await previewCancellation(user, r.id, { db, now })).toMatchObject({ cancellable: true, refundFils: 21_000, feeFils: 21_000 });
    await cancelReservation(user, { reservationId: r.id }, { db, now, provider });
    expect(await payment(r.id)).toMatchObject({ status: "PARTIALLY_REFUNDED", amount_refunded_fils: 21_000 });
    expect((await deposit(r.id)).status).toBe("RELEASED");
  });

  it("after pick-up time the customer cannot cancel; an admin can (no-show, no refund)", async () => {
    const f = await createPricedFleet(pool);
    const { user, provider, r } = await confirmed(f, 203);
    const now = addMinutes(r.pickupAt, 60);
    expect((await previewCancellation(user, r.id, { db, now })).cancellable).toBe(false);
    expect(code(await cancelReservation(user, { reservationId: r.id }, { db, now, provider }).catch((e) => e))).toBe("POLICY");
    const out = await cancelReservation(admin, { reservationId: r.id, reason: "no-show" }, { db, now, provider });
    expect(out.status).toBe("CANCELLED");
    expect((await payment(r.id)).amount_refunded_fils).toBe(0);
  });

  it("another customer cannot cancel; cancelling twice never refunds twice", async () => {
    const f = await createPricedFleet(pool);
    const { user, provider, r } = await confirmed(f, 204);
    const stranger = await readyCustomer(pool);
    expect(["FORBIDDEN", "NOT_FOUND"]).toContain(code(await cancelReservation(stranger, { reservationId: r.id }, { db, provider }).catch((e) => e)));
    expect((await res(r.id)).status).toBe("CONFIRMED");
    const both = await Promise.allSettled([
      cancelReservation(user, { reservationId: r.id }, { db, provider }),
      cancelReservation(user, { reservationId: r.id }, { db: drizzleFor(newPool(1)), provider }),
    ]);
    expect(both.some((x) => x.status === "fulfilled")).toBe(true);
    expect(await payment(r.id)).toMatchObject({ amount_refunded_fils: 42_000 });
    const events = await provider.listEvents();
    expect(events.filter((e) => e.type === "payment.refunded")).toHaveLength(1);
  });
});

describe.skipIf(!modifyApi.ready)(`date changes${modifyApi.ready ? "" : ` (missing: ${modifyApi.missing})`}`, () => {
  const { modifyReservationDates, previewModification } = modifyApi.fns;

  it("extending by a day charges the difference (21,000); shortening refunds it", async () => {
    const f = await createPricedFleet(pool);
    const { user, provider, r } = await confirmed(f, 210);
    const longer = { reservationId: r.id, pickupAt: r.pickupAt, returnAt: addDays(r.pickupAt, 3) };
    expect(await previewModification(user, longer, { db })).toMatchObject({ available: true, differenceFils: 21_000 });
    const out = await modifyReservationDates(
      user,
      { ...longer, paymentMethod: "pm_fake_success", idempotencyKey: `qa-mod-${r.id}` },
      { db, provider },
    );
    expect(out.pricing).toMatchObject({ rentalDays: 3, totalFils: 63_000 });
    expect(out.paidFils).toBe(63_000);
    const shorter = await modifyReservationDates(
      user,
      { reservationId: r.id, pickupAt: r.pickupAt, returnAt: addDays(r.pickupAt, 1), idempotencyKey: `qa-mod2-${r.id}` },
      { db, provider },
    );
    expect(shorter.pricing.totalFils).toBe(21_000);
    expect(shorter.paidFils).toBe(21_000);
  });

  it("new dates that clash are rejected and the booking is unchanged", async () => {
    const f = await createPricedFleet(pool);
    const a = await confirmed(f, 220);
    await confirmed(f, 223);
    const err = await modifyReservationDates(
      a.user,
      { reservationId: a.r.id, pickupAt: a.r.pickupAt, returnAt: addDays(a.r.pickupAt, 4), paymentMethod: "pm_fake_success", idempotencyKey: `qa-clash-${a.r.id}` },
      { db, provider: a.provider },
    ).catch((e) => e);
    expect(code(err)).toBe("VEHICLE_UNAVAILABLE");
    expect(new Date((await res(a.r.id)).return_at).getTime()).toBe(addDays(a.r.pickupAt, 2).getTime());
  });
});

describe.skipIf(!desk.ready)(`check-out / check-in${desk.ready ? "" : ` (missing: ${desk.missing})`}`, () => {
  const { checkOutReservation, checkInReservation, previewCheckIn } = desk.fns;

  async function pickedUp(f: PricedFleet, dayOffset: number) {
    const c = await confirmed(f, dayOffset);
    const out = await checkOutReservation(admin, { reservationId: c.r.id, mileageKm: 12_000, fuelLevel: 100 }, { db, now: c.r.pickupAt });
    expect(out.status).toBe("PICKED_UP");
    return c;
  }

  it("customers cannot check out or check in", async () => {
    const f = await createPricedFleet(pool);
    const { user, r } = await confirmed(f, 230);
    expect(code(await checkOutReservation(user, { reservationId: r.id, mileageKm: 1, fuelLevel: 50 }, { db }).catch((e) => e))).toBe("FORBIDDEN");
  });

  it("check-out records mileage/fuel and puts the vehicle ON_RENT", async () => {
    const f = await createPricedFleet(pool);
    const { r } = await pickedUp(f, 231);
    const ag = await one(`select pickup_mileage_km, pickup_fuel_level from rental_agreements where reservation_id = $1`, r.id);
    expect(ag).toEqual({ pickup_mileage_km: 12_000, pickup_fuel_level: 100 });
    expect((await one(`select status from vehicles where id = $1`, f.vehicle.id)).status).toBe("ON_RENT");
  });

  it("on-time return: RETURNED, deposit released in full, vehicle AVAILABLE with new mileage", async () => {
    const f = await createPricedFleet(pool);
    const { provider, r } = await pickedUp(f, 232);
    const out = await checkInReservation(admin, { reservationId: r.id, mileageKm: 12_400, fuelLevel: 80 }, { db, now: r.returnAt, provider });
    expect(out.status).toBe("RETURNED");
    expect(await deposit(r.id)).toMatchObject({ status: "RELEASED", amount_captured_fils: 0 });
    expect(await one(`select status, mileage_km, fuel_level from vehicles where id = $1`, f.vehicle.id)).toEqual({
      status: "AVAILABLE",
      mileage_km: 12_400,
      fuel_level: 80,
    });
  });

  it("within grace (30 min late): no fee", async () => {
    const f = await createPricedFleet(pool);
    const { r } = await pickedUp(f, 233);
    const p = await previewCheckIn(admin, { reservationId: r.id, returnAt: addMinutes(r.returnAt, 30) }, { db });
    expect(p.lateFee.totalFils).toBe(0);
  });

  it("61 min late: 2 started hours × 4,000 = 8,000 + VAT 400 = 8,400 captured from the deposit", async () => {
    const f = await createPricedFleet(pool);
    const { provider, r } = await pickedUp(f, 234);
    const at = addMinutes(r.returnAt, 61);
    expect((await previewCheckIn(admin, { reservationId: r.id, returnAt: at }, { db })).lateFee).toMatchObject({ feeFils: 8_000, totalFils: 8_400 });
    await checkInReservation(admin, { reservationId: r.id, mileageKm: 12_100, fuelLevel: 90 }, { db, now: at, provider });
    expect(await deposit(r.id)).toMatchObject({ status: "CAPTURED", amount_captured_fils: 8_400 });
    expect(await one(`select late_fee_fils, deposit_captured_fils from rental_agreements where reservation_id = $1`, r.id)).toMatchObject({
      deposit_captured_fils: 8_400,
    });
  });

  it("damage charge is captured from the deposit, capped at the deposit, and a damage report is filed", async () => {
    const f = await createPricedFleet(pool);
    const { provider, r } = await pickedUp(f, 235);
    await checkInReservation(
      admin,
      {
        reservationId: r.id,
        mileageKm: 12_050,
        fuelLevel: 100,
        damage: { severity: "MAJOR", description: "QA: bumper", chargeFils: 350_000, repairCostFils: 350_000 },
      },
      { db, now: r.returnAt, provider },
    );
    expect(await deposit(r.id)).toMatchObject({ status: "CAPTURED", amount_captured_fils: 200_000 });
    expect((await one(`select count(*)::int n from damage_reports where reservation_id = $1`, r.id)).n).toBe(1);
  });

  it("rejects return mileage below pick-up and fuel outside 0-100; can't check in twice", async () => {
    const f = await createPricedFleet(pool);
    const { provider, r } = await pickedUp(f, 236);
    expect(code(await checkInReservation(admin, { reservationId: r.id, mileageKm: 11_999, fuelLevel: 50 }, { db, provider }).catch((e) => e))).toBe("VALIDATION");
    expect(code(await checkInReservation(admin, { reservationId: r.id, mileageKm: 12_001, fuelLevel: 101 }, { db, provider }).catch((e) => e))).toBe("VALIDATION");
    await checkInReservation(admin, { reservationId: r.id, mileageKm: 12_001, fuelLevel: 50 }, { db, now: r.returnAt, provider });
    expect(code(await checkInReservation(admin, { reservationId: r.id, mileageKm: 12_002, fuelLevel: 50 }, { db, provider }).catch((e) => e))).toBe("INVALID_STATE");
  });

  it("can't check out an unpaid (PENDING) reservation", async () => {
    const f = await createPricedFleet(pool);
    const user = await readyCustomer(pool);
    const r = await holdFor(db, user, f, 237);
    expect(code(await checkOutReservation(admin, { reservationId: r.id, mileageKm: 1, fuelLevel: 50 }, { db }).catch((e) => e))).toBe("INVALID_STATE");
  });
});
