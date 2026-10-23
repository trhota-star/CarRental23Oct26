// Booking helpers: driver profile, per-test fake payment provider, hold → pay.

import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Pool } from "pg";
import { FAKE_PAYMENT_METHODS, FakePaymentProvider } from "@/server/payments/fake";
import type { Db } from "@/server/db";
import { createReservationHold, payForReservation } from "@/server/reservations/service";
import { addDays, createUser, futureAt } from "./db";
import type { PricedFleet } from "./fleet";

export { FAKE_PAYMENT_METHODS };

/** Isolated fake provider (own state file, no HTTP webhook delivery). */
export function fakeProvider(): FakePaymentProvider {
  const dir = mkdtempSync(path.join(tmpdir(), "qa-pay-"));
  return new FakePaymentProvider({ stateFile: path.join(dir, "state.json"), webhookSecret: "qa-webhook-secret" });
}

export async function addDriverProfile(pool: Pool, userId: string, opts: { licence?: boolean; dob?: string; expiry?: string } = {}) {
  await pool.query(
    `insert into driver_profiles (user_id, full_name, phone, date_of_birth, nationality, licence_number, licence_country,
       licence_expiry, licence_file_key, licence_content_type, licence_uploaded_at)
     values ($1, 'QA Driver', '+971500000000', $2, 'AE', $3, 'AE', $4, $5, $6, $7)`,
    [
      userId,
      opts.dob ?? "1990-01-01",
      `L-${randomUUID().slice(0, 8)}`,
      opts.expiry ?? "2040-01-01",
      opts.licence === false ? null : `licences/${userId}/front.jpg`,
      opts.licence === false ? null : "image/jpeg",
      opts.licence === false ? null : new Date(),
    ],
  );
}

/** A customer with a complete driver profile. */
export async function readyCustomer(pool: Pool) {
  const u = await createUser(pool);
  await addDriverProfile(pool, u.id);
  return { userId: u.id, role: "customer" as const, email: u.email };
}

export async function holdFor(
  db: Db,
  actor: { userId: string; role: "customer" | "admin" },
  f: PricedFleet,
  dayOffset: number,
  days = 2,
  opts: { now?: Date } = {},
) {
  const start = futureAt(dayOffset);
  return createReservationHold(
    actor,
    {
      vehicleId: f.vehicle.id,
      pickupBranchId: f.branchA.id,
      returnBranchId: f.branchA.id,
      pickupAt: start,
      returnAt: addDays(start, days),
      extras: [],
      idempotencyKey: `qa-${randomUUID()}`,
    },
    { db, now: opts.now },
  );
}

export async function pay(
  db: Db,
  provider: FakePaymentProvider,
  actor: { userId: string; role: "customer" | "admin" },
  reservationId: string,
  paymentMethod: string = FAKE_PAYMENT_METHODS.success,
  idempotencyKey = `qa-pay-${randomUUID()}`,
) {
  return payForReservation(actor, { reservationId, paymentMethod, idempotencyKey }, { db, provider });
}
