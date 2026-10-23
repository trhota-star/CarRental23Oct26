// Read models for reservations (what the UI renders).

import { alias } from "drizzle-orm/pg-core";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { getDb, type Executor } from "../db";
import {
  branches,
  deposits,
  extras,
  payments,
  rentalAgreements,
  reservationExtras,
  reservations,
  users,
  vehicleCategories,
  vehicles,
  type ReservationStatus,
} from "../db/schema";
import type { Quote } from "../pricing/engine";

const pickupBranch = alias(branches, "pickup_branch");
const returnBranch = alias(branches, "return_branch");

export type BranchSummary = { id: string; code: string; name: string; city: string; address: string; timezone: string };

export type ReservationView = {
  id: string;
  reference: string;
  status: ReservationStatus;
  userId: string;
  customer: { name: string; email: string };
  vehicle: {
    id: string;
    make: string;
    model: string;
    year: number;
    plate: string;
    color: string | null;
    transmission: string;
    fuelType: string;
    seats: number;
    category: { id: string; code: string; name: string };
  };
  pickupBranch: BranchSummary;
  returnBranch: BranchSummary;
  pickupAt: Date;
  returnAt: Date;
  holdExpiresAt: Date | null;
  pricing: {
    currency: string;
    rentalDays: number;
    dailyRateFils: number;
    baseFils: number;
    extrasFils: number;
    oneWayFeeFils: number;
    subtotalFils: number;
    vatRateBps: number;
    vatFils: number;
    totalFils: number;
    depositFils: number;
    quote: Quote;
  };
  extras: { extraId: string; code: string; name: string; chargeType: string; quantity: number; unitPriceFils: number; totalFils: number }[];
  payments: {
    id: string;
    purpose: string;
    status: string;
    amountFils: number;
    amountRefundedFils: number;
    failureReason: string | null;
    createdAt: Date;
  }[];
  /** Total paid minus refunds, over succeeded payments. */
  paidFils: number;
  deposit: { id: string; status: string; amountFils: number; amountCapturedFils: number; failureReason: string | null } | null;
  agreement: typeof rentalAgreements.$inferSelect | null;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  createdAt: Date;
};

function baseQuery(db: Executor) {
  return db
    .select({
      r: reservations,
      customer: { name: users.name, email: users.email },
      vehicle: {
        id: vehicles.id,
        make: vehicles.make,
        model: vehicles.model,
        year: vehicles.year,
        plate: vehicles.plate,
        color: vehicles.color,
        transmission: vehicles.transmission,
        fuelType: vehicles.fuelType,
        seats: vehicles.seats,
      },
      category: { id: vehicleCategories.id, code: vehicleCategories.code, name: vehicleCategories.name },
      pickupBranch: {
        id: pickupBranch.id,
        code: pickupBranch.code,
        name: pickupBranch.name,
        city: pickupBranch.city,
        address: pickupBranch.address,
        timezone: pickupBranch.timezone,
      },
      returnBranch: {
        id: returnBranch.id,
        code: returnBranch.code,
        name: returnBranch.name,
        city: returnBranch.city,
        address: returnBranch.address,
        timezone: returnBranch.timezone,
      },
    })
    .from(reservations)
    .innerJoin(users, eq(users.id, reservations.userId))
    .innerJoin(vehicles, eq(vehicles.id, reservations.vehicleId))
    .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
    .innerJoin(pickupBranch, eq(pickupBranch.id, reservations.pickupBranchId))
    .innerJoin(returnBranch, eq(returnBranch.id, reservations.returnBranchId))
    .$dynamic();
}

type BaseRow = Awaited<ReturnType<ReturnType<typeof baseQuery>["execute"]>>[number];

async function hydrate(db: Executor, rows: BaseRow[]): Promise<ReservationView[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.r.id);
  const [extraRows, paymentRows, depositRows, agreementRows] = await Promise.all([
    db
      .select({ re: reservationExtras, code: extras.code, name: extras.name })
      .from(reservationExtras)
      .innerJoin(extras, eq(extras.id, reservationExtras.extraId))
      .where(inArray(reservationExtras.reservationId, ids))
      .orderBy(asc(extras.name)),
    db.select().from(payments).where(inArray(payments.reservationId, ids)).orderBy(asc(payments.createdAt)),
    db.select().from(deposits).where(inArray(deposits.reservationId, ids)).orderBy(desc(deposits.createdAt)),
    db.select().from(rentalAgreements).where(inArray(rentalAgreements.reservationId, ids)),
  ]);
  return rows.map(({ r, customer, vehicle, category, pickupBranch, returnBranch }) => {
    const pays = paymentRows.filter((p) => p.reservationId === r.id);
    const paidFils = pays
      .filter((p) => p.status === "SUCCEEDED" || p.status === "PARTIALLY_REFUNDED" || p.status === "REFUNDED")
      .reduce((sum, p) => sum + p.amountFils - p.amountRefundedFils, 0);
    // Prefer the live deposit (HELD/CAPTURED/RELEASED) over failed attempts.
    const deps = depositRows.filter((d) => d.reservationId === r.id);
    const dep = deps.find((d) => d.status !== "FAILED" && d.status !== "PENDING") ?? deps[0] ?? null;
    return {
      id: r.id,
      reference: r.reference,
      status: r.status,
      userId: r.userId,
      customer,
      vehicle: { ...vehicle, category },
      pickupBranch,
      returnBranch,
      pickupAt: r.pickupAt,
      returnAt: r.returnAt,
      holdExpiresAt: r.holdExpiresAt,
      pricing: {
        currency: r.currency,
        rentalDays: r.rentalDays,
        dailyRateFils: r.dailyRateFils,
        baseFils: r.baseFils,
        extrasFils: r.extrasFils,
        oneWayFeeFils: r.oneWayFeeFils,
        subtotalFils: r.subtotalFils,
        vatRateBps: r.vatRateBps,
        vatFils: r.vatFils,
        totalFils: r.totalFils,
        depositFils: r.depositFils,
        quote: r.quote as Quote,
      },
      extras: extraRows
        .filter((e) => e.re.reservationId === r.id)
        .map((e) => ({
          extraId: e.re.extraId,
          code: e.code,
          name: e.name,
          chargeType: e.re.chargeType,
          quantity: e.re.quantity,
          unitPriceFils: e.re.unitPriceFils,
          totalFils: e.re.totalFils,
        })),
      payments: pays.map((p) => ({
        id: p.id,
        purpose: p.purpose,
        status: p.status,
        amountFils: p.amountFils,
        amountRefundedFils: p.amountRefundedFils,
        failureReason: p.failureReason,
        createdAt: p.createdAt,
      })),
      paidFils,
      deposit: dep
        ? { id: dep.id, status: dep.status, amountFils: dep.amountFils, amountCapturedFils: dep.amountCapturedFils, failureReason: dep.failureReason }
        : null,
      agreement: agreementRows.find((a) => a.reservationId === r.id) ?? null,
      confirmedAt: r.confirmedAt,
      cancelledAt: r.cancelledAt,
      cancellationReason: r.cancellationReason,
      createdAt: r.createdAt,
    };
  });
}

export async function loadReservationView(id: string, db: Executor = getDb()): Promise<ReservationView | null> {
  const rows = await baseQuery(db).where(eq(reservations.id, id));
  return (await hydrate(db, rows))[0] ?? null;
}

export async function loadReservationViewByReference(reference: string, db: Executor = getDb()): Promise<ReservationView | null> {
  const rows = await baseQuery(db).where(eq(reservations.reference, reference.toUpperCase()));
  return (await hydrate(db, rows))[0] ?? null;
}

export async function loadReservationViews(
  filter: {
    userId?: string;
    statuses?: ReservationStatus[];
    branchId?: string;
    vehicleId?: string;
    from?: Date;
    to?: Date;
    search?: string;
    limit: number;
    offset: number;
  },
  db: Executor = getDb(),
): Promise<{ items: ReservationView[]; total: number }> {
  const where = and(
    filter.userId ? eq(reservations.userId, filter.userId) : undefined,
    filter.statuses?.length ? inArray(reservations.status, filter.statuses) : undefined,
    filter.branchId ? or(eq(reservations.pickupBranchId, filter.branchId), eq(reservations.returnBranchId, filter.branchId)) : undefined,
    filter.vehicleId ? eq(reservations.vehicleId, filter.vehicleId) : undefined,
    filter.from ? sql`${reservations.returnAt} > ${filter.from.toISOString()}::timestamptz` : undefined,
    filter.to ? sql`${reservations.pickupAt} < ${filter.to.toISOString()}::timestamptz` : undefined,
    filter.search
      ? or(
          ilike(reservations.reference, `%${escapeLike(filter.search)}%`),
          ilike(users.email, `%${escapeLike(filter.search)}%`),
          ilike(users.name, `%${escapeLike(filter.search)}%`),
          ilike(vehicles.plate, `%${escapeLike(filter.search)}%`),
        )
      : undefined,
  );
  const rows = await baseQuery(db).where(where).orderBy(desc(reservations.pickupAt)).limit(filter.limit).offset(filter.offset);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(reservations)
    .innerJoin(users, eq(users.id, reservations.userId))
    .innerJoin(vehicles, eq(vehicles.id, reservations.vehicleId))
    .where(where);
  return { items: await hydrate(db, rows), total: count };
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}
