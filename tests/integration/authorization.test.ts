// QA-5: cross-user isolation and admin-only operations at the server-function level.
// HTTP/page-level isolation (URL guessing) is in tests/e2e/isolation.spec.ts.

import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/server/db";
import { DomainError } from "@/server/errors";
import { LocalFileStorage } from "@/server/storage/local";
import { createUser, futureAt, addDays, newPool } from "./helpers/db";
import { createPricedFleet, drizzleFor } from "./helpers/fleet";
import { fakeProvider, holdFor, pay, readyCustomer } from "./helpers/booking";
import { loadFns } from "./helpers/pending";

const reads = await loadFns(["@/server/reservations/service"], [
  "getReservationForUser",
  "getReservationByReference",
  "listReservationsForUser",
] as const);
const adminOnly = await loadFns(["@/server/reservations/service"], [
  "checkOutReservation",
  "checkInReservation",
  "previewCheckIn",
  "createDamageReport",
  "updateDamageReport",
  "listDamageReports",
  "refundReservation",
] as const);
const files = await loadFns(["@/server/customers/service"], ["authorizeFileAccess", "getDriverProfile", "saveLicenceFile"] as const);
const admin2 = await loadFns(["@/server/admin/service"], [
  "listAllReservations",
  "createBranch",
  "updateVehicle",
  "setVehicleStatus",
  "createPricingRule",
  "updatePricingRule",
  "createMaintenanceBlock",
  "listAuditLogs",
] as const);

const pool = newPool(4);
const db = drizzleFor(pool);
type A = { userId: string; role: "customer" | "admin" };
let alice: A, bob: A, admin: A;
let aliceRes: { id: string; reference: string };

beforeAll(async () => {
  alice = await readyCustomer(pool);
  bob = await readyCustomer(pool);
  admin = { userId: (await createUser(pool, "admin")).id, role: "admin" };
  const f = await createPricedFleet(pool);
  const r = await holdFor(db, alice, f, 400);
  await pay(db, fakeProvider(), alice, r.id);
  aliceRes = { id: r.id, reference: r.reference };
});
afterAll(async () => {
  await pool.end();
  await closeDb();
});

const code = (e: unknown) => (e instanceof DomainError ? e.code : `non-domain: ${String(e)}`);
const denied = (c: string) => expect(["FORBIDDEN", "NOT_FOUND"]).toContain(c);

describe.skipIf(!reads.ready)(`reservation reads${reads.ready ? "" : ` (missing: ${reads.missing})`}`, () => {
  const { getReservationForUser, getReservationByReference, listReservationsForUser } = reads.fns;

  it("owner and admin can read; another customer gets NOT_FOUND (no existence leak)", async () => {
    expect((await getReservationForUser(alice, aliceRes.id, { db })).id).toBe(aliceRes.id);
    expect((await getReservationForUser(admin, aliceRes.id, { db })).id).toBe(aliceRes.id);
    const byBob = await getReservationForUser(bob, aliceRes.id, { db }).catch((e) => e);
    const missing = await getReservationForUser(bob, randomUUID(), { db }).catch((e) => e);
    expect(code(byBob)).toBe("NOT_FOUND");
    expect(code(missing)).toBe("NOT_FOUND");
    expect(byBob.message).toBe(missing.message);
  });

  it("voucher lookup by reference: owner/admin only, case-insensitive, malformed refs rejected", async () => {
    expect((await getReservationByReference(alice, aliceRes.reference.toLowerCase(), { db })).id).toBe(aliceRes.id);
    expect((await getReservationByReference(admin, aliceRes.reference, { db })).id).toBe(aliceRes.id);
    expect(code(await getReservationByReference(bob, aliceRes.reference, { db }).catch((e) => e))).toBe("NOT_FOUND");
    for (const bad of ["DE-%", "' or 1=1 --", "DE-AAAAAAA_", ""]) {
      expect(["VALIDATION", "NOT_FOUND"]).toContain(code(await getReservationByReference(bob, bad, { db }).catch((e) => e)));
    }
  });

  it("listReservationsForUser only returns the caller's own bookings", async () => {
    const mine = await listReservationsForUser(alice, {}, { db });
    expect(mine.items.map((r: { id: string }) => r.id)).toContain(aliceRes.id);
    const bobs = await listReservationsForUser(bob, {}, { db });
    expect(bobs.items.every((r: { userId: string }) => r.userId === bob.userId)).toBe(true);
    expect(bobs.items.map((r: { id: string }) => r.id)).not.toContain(aliceRes.id);
  });

  it("forged or missing actors are rejected", async () => {
    for (const actor of [null, {}, { userId: "x", role: "customer" }, { userId: alice.userId, role: "superuser" }]) {
      expect(code(await getReservationForUser(actor as never, aliceRes.id, { db }).catch((e) => e))).toBe("FORBIDDEN");
    }
  });
});

describe.skipIf(!adminOnly.ready)(`admin-only reservation operations${adminOnly.ready ? "" : ` (missing: ${adminOnly.missing})`}`, () => {
  it("customers are FORBIDDEN from desk, damage and refund operations", async () => {
    const f = adminOnly.fns;
    const vehicleId = (await pool.query(`select vehicle_id from reservations where id = $1`, [aliceRes.id])).rows[0].vehicle_id;
    const calls: [string, () => Promise<unknown>][] = [
      ["checkOut", () => f.checkOutReservation(alice, { reservationId: aliceRes.id, mileageKm: 1, fuelLevel: 50 }, { db })],
      ["checkIn", () => f.checkInReservation(alice, { reservationId: aliceRes.id, mileageKm: 2, fuelLevel: 50 }, { db })],
      ["previewCheckIn", () => f.previewCheckIn(alice, { reservationId: aliceRes.id }, { db })],
      ["createDamage", () => f.createDamageReport(alice, { vehicleId, severity: "MINOR", description: "x" }, { db })],
      ["updateDamage", () => f.updateDamageReport(alice, { id: randomUUID(), status: "RESOLVED" }, { db })],
      ["listDamage", () => f.listDamageReports(alice, {}, { db })],
      ["refund", () => f.refundReservation(alice, aliceRes.id, { db })],
    ];
    for (const [name, call] of calls) {
      const c = code(await call().catch((e) => e));
      // refund answers NOT_FOUND to non-admins (no existence leak); the rest FORBIDDEN
      if (name === "refund") denied(c);
      else expect(c, name).toBe("FORBIDDEN");
    }
    const st = (await pool.query(`select status from reservations where id = $1`, [aliceRes.id])).rows[0].status;
    expect(st).toBe("CONFIRMED");
  });
});

describe.skipIf(!files.ready)(`private files${files.ready ? "" : ` (missing: ${files.missing})`}`, () => {
  const { authorizeFileAccess, getDriverProfile, saveLicenceFile } = files.fns;
  const storage = new LocalFileStorage(mkdtempSync(path.join(tmpdir(), "qa-files-")));
  let aliceKey = "";

  beforeAll(async () => {
    // 1x1 PNG
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
    const profile = await saveLicenceFile(alice, { body: new Uint8Array(png), contentType: "image/png" }, { db, storage });
    aliceKey = profile.licenceFileKey;
    expect(aliceKey).toMatch(new RegExp(`^licences/${alice.userId}/`));
    expect(aliceKey).not.toMatch(/^https?:|^\/|public/);
  });

  it("licence file: owner and admin allowed; another customer denied (null → 404)", async () => {
    expect(await authorizeFileAccess(alice, aliceKey, { db, storage })).toMatchObject({ contentType: "image/png" });
    expect(await authorizeFileAccess(admin, aliceKey, { db, storage })).not.toBeNull();
    expect(await authorizeFileAccess(bob, aliceKey, { db, storage })).toBeNull();
    expect(await authorizeFileAccess(null as never, aliceKey, { db, storage })).toBeNull();
  });

  it("guessed, traversal and unknown keys are denied", async () => {
    for (const key of [
      `licences/${alice.userId}/other.png`,
      `licences/${bob.userId}/../${alice.userId}/${path.basename(aliceKey)}`,
      `../storage/uploads/${aliceKey}`,
      `/${aliceKey}`,
      `licences/${randomUUID()}/front.png`,
      "",
    ]) {
      const r = await authorizeFileAccess(bob, key, { db, storage }).catch(() => null);
      expect(r, key).toBeNull();
    }
  });

  it("uploads are validated: type and 5 MB limit", async () => {
    expect(code(await saveLicenceFile(bob, { body: new Uint8Array([1, 2, 3]), contentType: "text/html" }, { db, storage }).catch((e) => e))).toBe("VALIDATION");
    expect(code(await saveLicenceFile(bob, { body: new Uint8Array(5 * 1024 * 1024 + 1), contentType: "image/png" }, { db, storage }).catch((e) => e))).toBe("VALIDATION");
  });

  it("driver profile: a customer cannot read someone else's", async () => {
    const other = await getDriverProfile(bob, alice.userId).catch((e) => e);
    if (other instanceof DomainError) denied(other.code);
    else expect(other?.userId ?? bob.userId).toBe(bob.userId); // ignores userId and returns own
    expect((await getDriverProfile(admin, alice.userId))?.licenceFileKey).toBe(aliceKey);
  });
});

describe.skipIf(!admin2.ready)(`admin service${admin2.ready ? "" : ` (missing: ${admin2.missing})`}`, () => {
  it("customers are FORBIDDEN from fleet, pricing, maintenance, reservations list and audit logs", async () => {
    const f = admin2.fns;
    const vehicleId = (await pool.query(`select vehicle_id from reservations where id = $1`, [aliceRes.id])).rows[0].vehicle_id;
    const start = futureAt(500);
    const calls: [string, () => Promise<unknown>][] = [
      ["listAllReservations", () => f.listAllReservations(alice, {})],
      ["createBranch", () => f.createBranch(alice, { code: "QAX1", name: "x", city: "Dubai", address: "x", timezone: "Asia/Dubai" })],
      ["updateVehicle", () => f.updateVehicle(alice, { id: vehicleId, color: "Pink" })],
      ["setVehicleStatus", () => f.setVehicleStatus(alice, { vehicleId, status: "RETIRED" })],
      ["createPricingRule", () => f.createPricingRule(alice, { kind: "VAT", name: "x", rateBps: 0 })],
      ["updatePricingRule", () => f.updatePricingRule(alice, { id: randomUUID(), amountFils: 1 })],
      ["createMaintenanceBlock", () => f.createMaintenanceBlock(alice, { vehicleId, startsAt: start, endsAt: addDays(start, 1), reason: "x" })],
      ["listAuditLogs", () => f.listAuditLogs(alice, {})],
    ];
    for (const [name, call] of calls) expect(code(await call().catch((e) => e)), name).toBe("FORBIDDEN");
    const v = (await pool.query(`select status from vehicles where id = $1`, [vehicleId])).rows[0];
    expect(v.status).not.toBe("RETIRED");
  });
});
