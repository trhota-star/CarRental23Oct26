// Check-out (pick-up), check-in (return) and damage reports (DB-9). Admin only.
//
// Check-in charges = late fee (incl. VAT) + damage charge. They are captured from the
// security deposit (capped at the hold); a zero charge releases the deposit.
// Fuel shortfall is recorded on the agreement but not charged automatically.

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { assertAdmin, type Actor } from "../actor";
import { audit } from "../audit";
import { getDb } from "../db";
import { branches, damageReports, rentalAgreements, reservations, vehicles } from "../db/schema";
import { InvalidStateError, NotFoundError, ValidationError } from "../errors";
import { log } from "../log";
import type { PaymentProvider } from "../payments/types";
import { computeLateFee, type LateFee } from "../pricing/engine";
import { loadPricingRules } from "../pricing/quote";
import { selectCategoryRule } from "../pricing/engine";
import { parseInput } from "../validation";
import type { MutationOptions } from "./hold";
import { settleReservationDeposit } from "./money";
import { loadReservationView, type ReservationView } from "./views";

type Opts = MutationOptions & { provider?: PaymentProvider };
export type DamageReport = typeof damageReports.$inferSelect;

const storageKey = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_\-./]*$/).max(300);

const checkOutSchema = z.object({
  reservationId: z.uuid(),
  mileageKm: z.number().int().min(0).max(2_000_000),
  fuelLevel: z.number().int().min(0).max(100),
  notes: z.string().trim().max(2000).optional(),
});

/** CONFIRMED → PICKED_UP. Creates the rental agreement and marks the vehicle ON_RENT. */
export async function checkOutReservation(actorInput: Actor, input: z.input<typeof checkOutSchema>, opts: Opts = {}): Promise<ReservationView> {
  const actor = assertAdmin(actorInput);
  const data = parseInput(checkOutSchema, input);
  const db = opts.db ?? getDb();
  const now = opts.now ?? new Date();
  await db.transaction(async (tx) => {
    const [r] = await tx.select().from(reservations).where(eq(reservations.id, data.reservationId)).for("update");
    if (!r) throw new NotFoundError("Reservation");
    if (r.status !== "CONFIRMED") throw new InvalidStateError(`Only confirmed bookings can be checked out (this one is ${r.status})`);
    const [v] = await tx.select().from(vehicles).where(eq(vehicles.id, r.vehicleId)).for("update");
    if (v.status === "ON_RENT") throw new InvalidStateError("This vehicle is still on rent. Check in the previous rental first.");
    if (data.mileageKm < v.mileageKm) {
      throw new ValidationError(`Mileage can't be lower than the recorded ${v.mileageKm} km`, { fields: { mileageKm: "Lower than recorded mileage" } });
    }
    await tx.insert(rentalAgreements).values({
      reservationId: r.id,
      pickedUpAt: now,
      pickupMileageKm: data.mileageKm,
      pickupFuelLevel: data.fuelLevel,
      pickupStaffId: actor.userId,
      pickupNotes: data.notes ?? null,
    });
    await tx.update(reservations).set({ status: "PICKED_UP" }).where(eq(reservations.id, r.id));
    await tx.update(vehicles).set({ status: "ON_RENT", mileageKm: data.mileageKm, fuelLevel: data.fuelLevel }).where(eq(vehicles.id, v.id));
    await audit(tx, { actorId: actor.userId, action: "reservation.checked_out", entityType: "reservation", entityId: r.id, data: { mileageKm: data.mileageKm, fuelLevel: data.fuelLevel } });
  });
  log.info("reservation.checked_out", { reservationId: data.reservationId });
  return (await loadReservationView(data.reservationId, db))!;
}

const damageInputSchema = z.object({
  severity: z.enum(["MINOR", "MODERATE", "MAJOR"]),
  description: z.string().trim().min(3).max(4000),
  chargeFils: z.number().int().min(0).max(100_000_000).default(0),
  repairCostFils: z.number().int().min(0).max(100_000_000).optional(),
  photoKeys: z.array(storageKey).max(20).default([]),
});

const checkInSchema = z.object({
  reservationId: z.uuid(),
  mileageKm: z.number().int().min(0).max(2_000_000),
  fuelLevel: z.number().int().min(0).max(100),
  returnBranchId: z.uuid().optional(),
  notes: z.string().trim().max(2000).optional(),
  damage: damageInputSchema.optional(),
});

async function lateFeeFor(r: typeof reservations.$inferSelect, categoryId: string, returnedAt: Date): Promise<LateFee> {
  const rule = selectCategoryRule(await loadPricingRules(), "LATE_RETURN", categoryId, r.pickupAt);
  return computeLateFee({
    scheduledReturnAt: r.returnAt,
    actualReturnAt: returnedAt,
    dailyRateFils: r.dailyRateFils,
    hourlyFils: rule?.amountFils ?? 0,
    graceMinutes: rule?.graceMinutes ?? 0,
    vatRateBps: r.vatRateBps,
  });
}

/** What check-in would charge if the car came back at `returnAt` (default now). */
export async function previewCheckIn(
  actorInput: Actor,
  input: { reservationId: string; returnAt?: Date | string },
  opts: Opts = {},
): Promise<{ lateFee: LateFee; depositFils: number }> {
  assertAdmin(actorInput);
  const id = parseInput(z.uuid(), input.reservationId);
  const db = opts.db ?? getDb();
  const [row] = await db
    .select({ r: reservations, categoryId: vehicles.categoryId })
    .from(reservations)
    .innerJoin(vehicles, eq(vehicles.id, reservations.vehicleId))
    .where(eq(reservations.id, id));
  if (!row) throw new NotFoundError("Reservation");
  const at = input.returnAt ? new Date(input.returnAt) : (opts.now ?? new Date());
  return { lateFee: await lateFeeFor(row.r, row.categoryId, at), depositFils: row.r.depositFils };
}

/**
 * PICKED_UP → RETURNED. Records mileage/fuel, computes the late fee, optionally files a
 * damage report, moves the vehicle to the return branch (AVAILABLE) and settles the deposit.
 */
export async function checkInReservation(actorInput: Actor, input: z.input<typeof checkInSchema>, opts: Opts = {}): Promise<ReservationView> {
  const actor = assertAdmin(actorInput);
  const data = parseInput(checkInSchema, input);
  const db = opts.db ?? getDb();
  const now = opts.now ?? new Date();

  const charges = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ r: reservations, categoryId: vehicles.categoryId })
      .from(reservations)
      .innerJoin(vehicles, eq(vehicles.id, reservations.vehicleId))
      .where(eq(reservations.id, data.reservationId))
      .for("update", { of: reservations });
    if (!row) throw new NotFoundError("Reservation");
    const r = row.r;
    if (r.status !== "PICKED_UP") throw new InvalidStateError(`Only picked-up bookings can be checked in (this one is ${r.status})`);
    const [agreement] = await tx.select().from(rentalAgreements).where(eq(rentalAgreements.reservationId, r.id)).for("update");
    if (!agreement) throw new InvalidStateError("No rental agreement found for this booking");
    if (data.mileageKm < agreement.pickupMileageKm) {
      throw new ValidationError(`Mileage can't be lower than the pick-up reading (${agreement.pickupMileageKm} km)`, { fields: { mileageKm: "Lower than pick-up mileage" } });
    }
    const returnBranchId = data.returnBranchId ?? r.returnBranchId;
    const [branch] = await tx.select({ id: branches.id }).from(branches).where(eq(branches.id, returnBranchId));
    if (!branch) throw new NotFoundError("Branch");

    const late = await lateFeeFor(r, row.categoryId, now);
    const damageCharge = data.damage?.chargeFils ?? 0;
    if (data.damage) {
      await tx.insert(damageReports).values({
        vehicleId: r.vehicleId,
        reservationId: r.id,
        reportedById: actor.userId,
        severity: data.damage.severity,
        description: data.damage.description,
        photoKeys: data.damage.photoKeys,
        repairCostFils: data.damage.repairCostFils ?? null,
        chargedFils: damageCharge,
        status: damageCharge > 0 ? "CHARGED" : "OPEN",
      });
    }
    const total = late.totalFils + damageCharge;
    await tx
      .update(rentalAgreements)
      .set({
        returnedAt: now,
        returnBranchId,
        returnMileageKm: data.mileageKm,
        returnFuelLevel: data.fuelLevel,
        returnStaffId: actor.userId,
        returnNotes: data.notes ?? null,
        lateMinutes: late.lateMinutes,
        lateFeeFils: late.totalFils,
        damageChargeFils: damageCharge,
        depositCapturedFils: Math.min(total, r.depositFils),
      })
      .where(eq(rentalAgreements.id, agreement.id));
    await tx.update(reservations).set({ status: "RETURNED" }).where(eq(reservations.id, r.id));
    await tx
      .update(vehicles)
      .set({ status: "AVAILABLE", branchId: returnBranchId, mileageKm: data.mileageKm, fuelLevel: data.fuelLevel })
      .where(eq(vehicles.id, r.vehicleId));
    await audit(tx, {
      actorId: actor.userId,
      action: "reservation.checked_in",
      entityType: "reservation",
      entityId: r.id,
      data: { lateFeeFils: late.totalFils, damageChargeFils: damageCharge, mileageKm: data.mileageKm },
    });
    return total;
  });

  try {
    const captured = await settleReservationDeposit(data.reservationId, charges, { db, provider: opts.provider, now });
    if (captured < charges) log.warn("reservation.check_in.uncovered_charges", { reservationId: data.reservationId, chargesFils: charges, capturedFils: captured });
  } catch (error) {
    log.error("reservation.check_in.deposit_settle_failed", { reservationId: data.reservationId, error });
  }
  log.info("reservation.checked_in", { reservationId: data.reservationId, chargesFils: charges });
  return (await loadReservationView(data.reservationId, db))!;
}

const createDamageSchema = damageInputSchema.omit({ chargeFils: true }).extend({
  vehicleId: z.uuid(),
  reservationId: z.uuid().optional(),
});

export async function createDamageReport(actorInput: Actor, input: z.input<typeof createDamageSchema>, opts: Opts = {}): Promise<DamageReport> {
  const actor = assertAdmin(actorInput);
  const data = parseInput(createDamageSchema, input);
  const db = opts.db ?? getDb();
  const [v] = await db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.id, data.vehicleId));
  if (!v) throw new NotFoundError("Vehicle");
  if (data.reservationId) {
    const [r] = await db.select({ vehicleId: reservations.vehicleId }).from(reservations).where(eq(reservations.id, data.reservationId));
    if (!r) throw new NotFoundError("Reservation");
    if (r.vehicleId !== data.vehicleId) throw new ValidationError("That booking is for a different vehicle");
  }
  const [row] = await db
    .insert(damageReports)
    .values({
      vehicleId: data.vehicleId,
      reservationId: data.reservationId ?? null,
      reportedById: actor.userId,
      severity: data.severity,
      description: data.description,
      photoKeys: data.photoKeys,
      repairCostFils: data.repairCostFils ?? null,
    })
    .returning();
  await audit(db, { actorId: actor.userId, action: "damage_report.created", entityType: "damage_report", entityId: row.id });
  return row;
}

const updateDamageSchema = z.object({
  id: z.uuid(),
  status: z.enum(["OPEN", "CHARGED", "RESOLVED"]).optional(),
  repairCostFils: z.number().int().min(0).max(100_000_000).nullable().optional(),
  description: z.string().trim().min(3).max(4000).optional(),
  photoKeys: z.array(storageKey).max(20).optional(),
});

export async function updateDamageReport(actorInput: Actor, input: z.input<typeof updateDamageSchema>, opts: Opts = {}): Promise<DamageReport> {
  const actor = assertAdmin(actorInput);
  const { id, ...patch } = parseInput(updateDamageSchema, input);
  const db = opts.db ?? getDb();
  const [row] = await db
    .update(damageReports)
    .set({ ...patch, resolvedAt: patch.status === "RESOLVED" ? (opts.now ?? new Date()) : undefined })
    .where(eq(damageReports.id, id))
    .returning();
  if (!row) throw new NotFoundError("Damage report");
  await audit(db, { actorId: actor.userId, action: "damage_report.updated", entityType: "damage_report", entityId: id, data: patch });
  return row;
}

const listDamageSchema = z.object({
  vehicleId: z.uuid().optional(),
  reservationId: z.uuid().optional(),
  status: z.enum(["OPEN", "CHARGED", "RESOLVED"]).optional(),
});

export async function listDamageReports(actorInput: Actor, filter: z.input<typeof listDamageSchema> = {}, opts: Opts = {}): Promise<DamageReport[]> {
  assertAdmin(actorInput);
  const f = parseInput(listDamageSchema, filter);
  return (opts.db ?? getDb())
    .select()
    .from(damageReports)
    .where(
      and(
        f.vehicleId ? eq(damageReports.vehicleId, f.vehicleId) : undefined,
        f.reservationId ? eq(damageReports.reservationId, f.reservationId) : undefined,
        f.status ? eq(damageReports.status, f.status) : undefined,
      ),
    )
    .orderBy(desc(damageReports.createdAt));
}
