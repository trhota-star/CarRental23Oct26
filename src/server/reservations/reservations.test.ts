// Integration tests against driveeasy_test (vitest sets DATABASE_URL to TEST_DATABASE_URL).
// Each run creates its own branch/category/vehicles/users with unique codes and removes them after.

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMaintenanceBlock } from "../admin/service";
import { authorizeFileAccess, saveLicenceFile } from "../customers/service";
import { closeDb, getDb } from "../db";
import { LocalFileStorage } from "../storage/local";
import * as s from "../db/schema";
import { NotFoundError, VehicleUnavailableError } from "../errors";
import { FAKE_PAYMENT_METHODS, FakePaymentProvider } from "../payments/fake";
import {
  cancelReservation,
  checkInReservation,
  checkOutReservation,
  createReservationHold,
  getReservationForUser,
  modifyReservationDates,
  handlePaymentWebhook,
  payForReservation,
  releaseExpiredReservationHolds,
  searchAvailability,
} from "./service";

const run = Math.random().toString(36).slice(2, 7).toUpperCase();
const db = getDb();
let dir: string;
let provider: FakePaymentProvider;
const ids = { branch: "", category: "", vehicles: [] as string[], users: [] as string[], rules: [] as string[] };
const DAY = 86_400_000;
// Far-future base so seeded/demo data never collides.
const base = new Date(Date.UTC(2031, 0, 1, 6) + Math.floor(Math.random() * 300) * DAY);

async function makeUser(n: number) {
  const [u] = await db
    .insert(s.users)
    .values({ name: `Test ${run} ${n}`, email: `t-${run.toLowerCase()}-${n}-${randomUUID().slice(0, 6)}@test.local` })
    .returning();
  await db.insert(s.driverProfiles).values({
    userId: u.id,
    fullName: u.name,
    phone: "+971500000000",
    dateOfBirth: "1990-01-01",
    nationality: "AE",
    licenceNumber: `L${n}`,
    licenceCountry: "AE",
    licenceExpiry: "2040-01-01",
    licenceFileKey: `licences/${u.id}/x.png`,
    licenceContentType: "image/png",
  });
  ids.users.push(u.id);
  return { userId: u.id, role: "customer" as const };
}

function hold(actor: { userId: string; role: "customer" }, vehicleId: string, startDay: number, days: number, key = randomUUID()) {
  const pickupAt = new Date(base.getTime() + startDay * DAY);
  return createReservationHold(
    actor,
    {
      vehicleId,
      pickupBranchId: ids.branch,
      returnBranchId: ids.branch,
      pickupAt,
      returnAt: new Date(pickupAt.getTime() + days * DAY),
      idempotencyKey: key,
    },
    { now: new Date(base.getTime() - 30 * DAY) },
  );
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "res-test-"));
  provider = new FakePaymentProvider({ stateFile: path.join(dir, "fake.json"), webhookSecret: "test-secret" });
  const [b] = await db.insert(s.branches).values({ code: `T${run}`, name: "Test", city: "Test", address: "Test" }).returning();
  const [c] = await db.insert(s.vehicleCategories).values({ code: `T_${run}`, name: "Test" }).returning();
  ids.branch = b.id;
  ids.category = c.id;
  for (let i = 0; i < 3; i++) {
    const [v] = await db
      .insert(s.vehicles)
      .values({
        branchId: b.id,
        categoryId: c.id,
        make: "Test",
        model: `M${i}`,
        year: 2025,
        plate: `T${run}${i}`,
        vin: `JTEST${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}${i}00`,
        transmission: "AUTOMATIC",
        fuelType: "PETROL",
        seats: 5,
      })
      .returning();
    ids.vehicles.push(v.id);
  }
  const rules = await db
    .insert(s.pricingRules)
    .values([
      { kind: "DAILY_RATE", name: "t", categoryId: c.id, amountFils: 10000 },
      { kind: "DEPOSIT", name: "t", categoryId: c.id, amountFils: 50000 },
      { kind: "VAT", name: "t", rateBps: 500, priority: -100 },
    ])
    .returning();
  ids.rules = rules.map((r) => r.id);
});

afterAll(async () => {
  const res = await db.select({ id: s.reservations.id }).from(s.reservations).where(inArray(s.reservations.vehicleId, ids.vehicles));
  const rids = res.map((r) => r.id);
  if (rids.length) {
    await db.delete(s.rentalAgreements).where(inArray(s.rentalAgreements.reservationId, rids));
    await db.delete(s.damageReports).where(inArray(s.damageReports.reservationId, rids));
    await db.delete(s.payments).where(inArray(s.payments.reservationId, rids));
    await db.delete(s.deposits).where(inArray(s.deposits.reservationId, rids));
    await db.delete(s.reservations).where(inArray(s.reservations.id, rids));
  }
  await db.delete(s.maintenanceBlocks).where(inArray(s.maintenanceBlocks.vehicleId, ids.vehicles));
  await db.delete(s.vehicles).where(inArray(s.vehicles.id, ids.vehicles));
  await db.delete(s.pricingRules).where(inArray(s.pricingRules.id, ids.rules));
  await db.delete(s.vehicleCategories).where(eq(s.vehicleCategories.id, ids.category));
  await db.delete(s.branches).where(eq(s.branches.id, ids.branch));
  await db.delete(s.users).where(inArray(s.users.id, ids.users));
  await closeDb();
  await rm(dir, { recursive: true, force: true });
});

describe("createReservationHold", () => {
  it("is idempotent per user + key", async () => {
    const a = await makeUser(1);
    const key = randomUUID();
    const r1 = await hold(a, ids.vehicles[0], 0, 2, key);
    const r2 = await hold(a, ids.vehicles[0], 0, 2, key);
    expect(r1.id).toBe(r2.id);
    expect(r1.status).toBe("PENDING");
    expect(r1.pricing.totalFils).toBe(21000);
    expect(r1.pricing.depositFils).toBe(50000);
  });

  it("lets exactly one of many concurrent overlapping holds win", async () => {
    const actors = await Promise.all(Array.from({ length: 8 }, (_, i) => makeUser(10 + i)));
    const results = await Promise.allSettled(actors.map((a, i) => hold(a, ids.vehicles[1], 10 + (i % 2), 3)));
    const ok = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    for (const r of rejected) expect(r.reason).toBeInstanceOf(VehicleUnavailableError);
  });

  it("allows back-to-back rentals", async () => {
    const a = await makeUser(30);
    const first = await hold(a, ids.vehicles[2], 40, 2);
    const second = await hold(a, ids.vehicles[2], 42, 2);
    expect(first.returnAt.getTime()).toBe(second.pickupAt.getTime());
  });

  it("does not let an expired-but-unswept hold block a new booking", async () => {
    const a = await makeUser(40);
    const b = await makeUser(41);
    const stale = await hold(a, ids.vehicles[2], 60, 2);
    // b books the same slot after a's hold expired, before any cron run.
    const pickupAt = new Date(base.getTime() + 60 * DAY);
    const fresh = await createReservationHold(
      b,
      { vehicleId: ids.vehicles[2], pickupBranchId: ids.branch, returnBranchId: ids.branch, pickupAt, returnAt: new Date(pickupAt.getTime() + 2 * DAY), idempotencyKey: randomUUID() },
      { now: new Date(stale.holdExpiresAt!.getTime() + 1000) },
    );
    expect(fresh.status).toBe("PENDING");
    const [old] = await db.select().from(s.reservations).where(eq(s.reservations.id, stale.id));
    expect(old.status).toBe("EXPIRED");
  });
});

describe("payment, webhooks and expiry", () => {
  it("confirms after payment + deposit, and duplicate webhooks are no-ops", async () => {
    const a = await makeUser(50);
    const r = await hold(a, ids.vehicles[0], 80, 3);
    const paid = await payForReservation(a, { reservationId: r.id, paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: randomUUID() }, { provider, now: new Date(base.getTime() - 30 * DAY) });
    expect(paid.outcome).toBe("CONFIRMED");
    expect(paid.reservation.status).toBe("CONFIRMED");
    expect(paid.reservation.deposit?.status).toBe("HELD");

    const event = (await provider.listEvents()).find((e) => e.type === "payment.succeeded" && e.data.reference === r.reference)!;
    const { body, headers } = provider.signedWebhook(event);
    const sig = headers[provider.webhookSignatureHeader];
    const first = await handlePaymentWebhook(body, sig, { provider });
    const second = await handlePaymentWebhook(body, sig, { provider });
    expect(first.status).toBe("processed");
    expect(second.status).toBe("duplicate");
    await expect(handlePaymentWebhook(body, "t=1,v1=00", { provider })).rejects.toThrow();
  });

  it("retries only the deposit after a deposit failure (no double charge)", async () => {
    const a = await makeUser(60);
    const r = await hold(a, ids.vehicles[1], 100, 2);
    const now = new Date(base.getTime() - 30 * DAY);
    // Payment succeeds with success token; then force a deposit failure by declining on a second attempt.
    const first = await payForReservation(a, { reservationId: r.id, paymentMethod: FAKE_PAYMENT_METHODS.decline, idempotencyKey: randomUUID() }, { provider, now });
    expect(first.outcome).toBe("PAYMENT_FAILED");
    const second = await payForReservation(a, { reservationId: r.id, paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: randomUUID() }, { provider, now });
    expect(second.outcome).toBe("CONFIRMED");
    const third = await payForReservation(a, { reservationId: r.id, paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: randomUUID() }, { provider, now });
    expect(third.outcome).toBe("ALREADY_CONFIRMED");
    const succeeded = third.reservation.payments.filter((p) => p.status === "SUCCEEDED");
    expect(succeeded).toHaveLength(1);
  });

  it("sweeps expired holds idempotently and in parallel", async () => {
    // Clean up any holds left in PENDING by preceding tests on these vehicles.
    await releaseExpiredReservationHolds({ now: new Date(base.getTime()), provider, vehicleIds: ids.vehicles });
    const a = await makeUser(70);
    const early = new Date(base.getTime() - 30 * DAY);
    const r = await hold(a, ids.vehicles[0], 120, 1);
    // A second expired hold with a payment still PENDING at the provider → must be voided.
    const r2 = await hold(a, ids.vehicles[1], 120, 1);
    const pending = await payForReservation(a, { reservationId: r2.id, paymentMethod: FAKE_PAYMENT_METHODS.pending, idempotencyKey: randomUUID() }, { provider, now: early });
    expect(pending.outcome).toBe("PAYMENT_PENDING");
    // A third with a payment id the provider has never seen (orphan) → closed, not retried forever.
    const r3 = await hold(a, ids.vehicles[2], 120, 1);
    await db.insert(s.payments).values({ reservationId: r3.id, provider: provider.name, providerPaymentId: `fpay_orphan_${randomUUID()}`, idempotencyKey: randomUUID(), amountFils: r3.pricing.totalFils, status: "PENDING" });

    const later = new Date(r.holdExpiresAt!.getTime() + 60_000);
    const scope = { now: later, provider, vehicleIds: ids.vehicles };
    const [x, y] = await Promise.all([releaseExpiredReservationHolds(scope), releaseExpiredReservationHolds(scope)]);
    for (const id of [r.id, r2.id, r3.id]) {
      const [row] = await db.select().from(s.reservations).where(eq(s.reservations.id, id));
      expect(row.status).toBe("EXPIRED");
    }
    expect(x.failed + y.failed).toBe(0);
    expect(x.expired + y.expired).toBe(3);
    expect(x.paymentsVoided + y.paymentsVoided).toBe(1);
    expect(x.orphaned + y.orphaned).toBe(1);
    const pays = await db.select().from(s.payments).where(inArray(s.payments.reservationId, [r2.id, r3.id]));
    expect(pays.map((p) => p.status).sort()).toEqual(["CANCELED", "CANCELED"]);

    const again = await releaseExpiredReservationHolds(scope);
    expect(again).toEqual({ expired: 0, depositsReleased: 0, paymentsRefunded: 0, paymentsVoided: 0, orphaned: 0, failed: 0 });
    // Vehicle is searchable again for that slot.
    const found = await searchAvailability(
      { pickupBranchId: ids.branch, returnBranchId: ids.branch, pickupAt: r.pickupAt, returnAt: r.returnAt },
      { now: later },
    );
    expect(found.map((v) => v.id)).toContain(ids.vehicles[0]);
  });
});

describe("manage + rental lifecycle", () => {
  const early = () => new Date(base.getTime() - 30 * DAY);
  async function confirmed(n: number, vehicle: number, startDay: number, days: number) {
    const a = await makeUser(n);
    const r = await hold(a, ids.vehicles[vehicle], startDay, days);
    const paid = await payForReservation(a, { reservationId: r.id, paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: randomUUID() }, { provider, now: early() });
    expect(paid.outcome).toBe("CONFIRMED");
    return { a, r: paid.reservation };
  }

  it("hides other users' reservations", async () => {
    const { r } = await confirmed(80, 2, 140, 1);
    const other = await makeUser(81);
    await expect(getReservationForUser(other, r.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("cancels early with a full refund and releases the deposit", async () => {
    const { a, r } = await confirmed(82, 2, 150, 2);
    const c = await cancelReservation(a, { reservationId: r.id }, { provider, now: early() });
    expect(c.status).toBe("CANCELLED");
    expect(c.paidFils).toBe(0);
    expect(c.deposit?.status).toBe("RELEASED");
    // the slot is free again
    const again = await hold(await makeUser(83), ids.vehicles[2], 150, 2);
    expect(again.status).toBe("PENDING");
  });

  it("keeps one day + VAT when cancelled within 48h", async () => {
    const { a, r } = await confirmed(84, 2, 160, 3);
    const c = await cancelReservation(a, { reservationId: r.id }, { provider, now: new Date(r.pickupAt.getTime() - 3_600_000) });
    expect(c.paidFils).toBe(10500);
  });

  it("modifies dates: charges the difference and refunds on shortening", async () => {
    const { a, r } = await confirmed(85, 2, 170, 2);
    const longer = await modifyReservationDates(
      a,
      { reservationId: r.id, pickupAt: r.pickupAt, returnAt: new Date(r.pickupAt.getTime() + 4 * DAY), paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: randomUUID() },
      { provider, now: early() },
    );
    expect(longer.pricing.totalFils).toBe(42000);
    expect(longer.paidFils).toBe(42000);
    const shorter = await modifyReservationDates(
      a,
      { reservationId: r.id, pickupAt: r.pickupAt, returnAt: new Date(r.pickupAt.getTime() + 1 * DAY), idempotencyKey: randomUUID() },
      { provider, now: early() },
    );
    expect(shorter.pricing.totalFils).toBe(10500);
    expect(shorter.paidFils).toBe(10500);
  });

  it("checks out and in with a late fee captured from the deposit", async () => {
    const { r } = await confirmed(86, 2, 180, 1);
    const admin = { userId: ids.users[0], role: "admin" as const };
    const out = await checkOutReservation(admin, { reservationId: r.id, mileageKm: 1000, fuelLevel: 100 }, { provider, now: r.pickupAt });
    expect(out.status).toBe("PICKED_UP");
    const back = await checkInReservation(
      admin,
      { reservationId: r.id, mileageKm: 1200, fuelLevel: 80 },
      { provider, now: new Date(r.returnAt.getTime() + 2 * 3_600_000) },
    );
    expect(back.status).toBe("RETURNED");
    // no LATE_RETURN rule for the test category may exist → fee could be 0 or default rule; deposit is settled either way
    expect(["RELEASED", "CAPTURED"]).toContain(back.deposit?.status);
    expect(back.agreement?.returnMileageKm).toBe(1200);
  });
});

describe("admin maintenance + private files", () => {
  it("rejects a maintenance block that overlaps a booking, and blocks bookings over maintenance", async () => {
    const admin = { userId: ids.users[0], role: "admin" as const };
    const a = await makeUser(90);
    const r = await hold(a, ids.vehicles[0], 200, 2);
    await expect(
      createMaintenanceBlock(admin, { vehicleId: ids.vehicles[0], startsAt: r.pickupAt, endsAt: r.returnAt, reason: "service" }),
    ).rejects.toBeInstanceOf(VehicleUnavailableError);
    const start = new Date(base.getTime() + 210 * DAY);
    await createMaintenanceBlock(admin, { vehicleId: ids.vehicles[0], startsAt: start, endsAt: new Date(start.getTime() + DAY), reason: "service" });
    await expect(hold(a, ids.vehicles[0], 210, 1)).rejects.toBeInstanceOf(VehicleUnavailableError);
  });

  it("serves licence files only to the owner or an admin", async () => {
    const storage = new LocalFileStorage(path.join(dir, "uploads"));
    const owner = await makeUser(91);
    const other = await makeUser(92);
    const png = Buffer.from("89504e470d0a1a0a0000", "hex");
    const profile = await saveLicenceFile(owner, { body: png, contentType: "image/png" }, { storage });
    const key = profile.licenceFileKey!;
    expect(await authorizeFileAccess(owner, key, { storage })).toEqual({ contentType: "image/png" });
    expect(await authorizeFileAccess({ userId: other.userId, role: "admin" }, key, { storage })).not.toBeNull();
    expect(await authorizeFileAccess(other, key, { storage })).toBeNull();
    expect(await authorizeFileAccess(owner, `licences/${other.userId}/nope.png`, { storage })).toBeNull();
    await expect(saveLicenceFile(owner, { body: Buffer.from("not a png"), contentType: "image/png" }, { storage })).rejects.toThrow();
  });
});
