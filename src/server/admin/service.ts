// Admin-only CRUD for branches, categories, fleet, extras, pricing rules,
// maintenance blocks, plus reservation search and audit log. Every write is audit-logged.

import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { assertAdmin, type Actor } from "../actor";
import { audit } from "../audit";
import { getVehicle, type VehicleDetails } from "../catalog/queries";
import { getDb, type Db } from "../db";
import {
  auditLogs,
  branches,
  extras,
  maintenanceBlocks,
  pricingRules,
  vehicleCategories,
  vehicleFeatureMap,
  vehicles,
  type ReservationStatus,
} from "../db/schema";
import {
  NotFoundError,
  PG_EXCLUSION_VIOLATION,
  PG_UNIQUE_VIOLATION,
  pgConstraint,
  pgErrorCode,
  ValidationError,
  VehicleUnavailableError,
} from "../errors";
import { loadReservationViews, type ReservationView } from "../reservations/views";
import { checkRange, instant, parseInput } from "../validation";

type Opts = { db?: Db; now?: Date };
export type Branch = typeof branches.$inferSelect;
export type VehicleCategory = typeof vehicleCategories.$inferSelect;
export type Extra = typeof extras.$inferSelect;
export type PricingRule = typeof pricingRules.$inferSelect;
export type MaintenanceBlock = typeof maintenanceBlocks.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;

/** Maps unique violations to a field-level ValidationError. */
async function guardUnique<T>(fn: () => Promise<T>, fields: Record<string, string>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) {
      const c = pgConstraint(error) ?? "";
      const field = Object.keys(fields).find((f) => c.includes(fields[f])) ?? "_";
      throw new ValidationError("That value is already in use", { fields: { [field]: "Already in use" } });
    }
    throw error;
  }
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Reservations & audit
// ---------------------------------------------------------------------------

const adminListSchema = z.object({
  statuses: z.array(z.enum(["PENDING", "CONFIRMED", "PICKED_UP", "RETURNED", "CANCELLED", "EXPIRED", "REFUNDED"])).optional(),
  branchId: z.uuid().optional(),
  vehicleId: z.uuid().optional(),
  from: instant.optional(),
  to: instant.optional(),
  search: z.string().trim().max(100).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

export async function listAllReservations(
  actorInput: Actor,
  filter: z.input<typeof adminListSchema> = {},
  opts: Opts = {},
): Promise<{ items: ReservationView[]; total: number }> {
  assertAdmin(actorInput);
  const f = parseInput(adminListSchema, filter);
  return loadReservationViews({ ...f, statuses: f.statuses as ReservationStatus[] | undefined, search: f.search || undefined }, opts.db ?? getDb());
}

export async function listAuditLogs(
  actorInput: Actor,
  filter: { entityType?: string; entityId?: string; limit?: number } = {},
  opts: Opts = {},
): Promise<AuditLog[]> {
  assertAdmin(actorInput);
  const f = parseInput(
    z.object({ entityType: z.string().max(50).optional(), entityId: z.uuid().optional(), limit: z.number().int().min(1).max(500).default(100) }),
    filter,
  );
  return (opts.db ?? getDb())
    .select()
    .from(auditLogs)
    .where(and(f.entityType ? eq(auditLogs.entityType, f.entityType) : undefined, f.entityId ? eq(auditLogs.entityId, f.entityId) : undefined))
    .orderBy(desc(auditLogs.createdAt))
    .limit(f.limit);
}

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------

const branchSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,10}$/, "2–10 letters or digits"),
  name: z.string().trim().min(2).max(120),
  city: z.string().trim().min(2).max(80),
  address: z.string().trim().min(3).max(300),
  phone: z.string().trim().max(40).nullable().optional(),
  timezone: z.string().trim().refine(isValidTimeZone, "Unknown time zone").default("Asia/Dubai"),
  openingHours: z.string().trim().max(200).nullable().optional(),
  isActive: z.boolean().default(true),
});

export async function createBranch(actorInput: Actor, input: z.input<typeof branchSchema>, opts: Opts = {}): Promise<Branch> {
  const actor = assertAdmin(actorInput);
  const data = parseInput(branchSchema, input);
  const db = opts.db ?? getDb();
  const [row] = await guardUnique(() => db.insert(branches).values(data).returning(), { code: "code" });
  await audit(db, { actorId: actor.userId, action: "branch.created", entityType: "branch", entityId: row.id, data });
  return row;
}

export async function updateBranch(actorInput: Actor, input: { id: string } & Partial<z.input<typeof branchSchema>>, opts: Opts = {}): Promise<Branch> {
  const actor = assertAdmin(actorInput);
  const { id, ...patch } = parseInput(branchSchema.partial().extend({ id: z.uuid() }), input);
  const db = opts.db ?? getDb();
  const [row] = await guardUnique(() => db.update(branches).set(patch).where(eq(branches.id, id)).returning(), { code: "code" });
  if (!row) throw new NotFoundError("Branch");
  await audit(db, { actorId: actor.userId, action: "branch.updated", entityType: "branch", entityId: id, data: patch });
  return row;
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const categorySchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,20}$/, "2–20 letters, digits or _"),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});

export async function createCategory(actorInput: Actor, input: z.input<typeof categorySchema>, opts: Opts = {}): Promise<VehicleCategory> {
  const actor = assertAdmin(actorInput);
  const data = parseInput(categorySchema, input);
  const db = opts.db ?? getDb();
  const [row] = await guardUnique(() => db.insert(vehicleCategories).values(data).returning(), { code: "code" });
  await audit(db, { actorId: actor.userId, action: "category.created", entityType: "vehicle_category", entityId: row.id, data });
  return row;
}

export async function updateCategory(actorInput: Actor, input: { id: string } & Partial<z.input<typeof categorySchema>>, opts: Opts = {}): Promise<VehicleCategory> {
  const actor = assertAdmin(actorInput);
  const { id, ...patch } = parseInput(categorySchema.partial().extend({ id: z.uuid() }), input);
  const db = opts.db ?? getDb();
  const [row] = await guardUnique(() => db.update(vehicleCategories).set(patch).where(eq(vehicleCategories.id, id)).returning(), { code: "code" });
  if (!row) throw new NotFoundError("Category");
  await audit(db, { actorId: actor.userId, action: "category.updated", entityType: "vehicle_category", entityId: id, data: patch });
  return row;
}

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

const vehicleSchema = z.object({
  branchId: z.uuid(),
  categoryId: z.uuid(),
  make: z.string().trim().min(1).max(60),
  model: z.string().trim().min(1).max(60),
  year: z.number().int().min(1990).max(2100),
  plate: z.string().trim().toUpperCase().min(2).max(20),
  vin: z.string().trim().toUpperCase().regex(/^[A-HJ-NPR-Z0-9]{17}$/, "17 characters, no I, O or Q"),
  transmission: z.enum(["AUTOMATIC", "MANUAL"]),
  fuelType: z.enum(["PETROL", "DIESEL", "HYBRID", "ELECTRIC"]),
  seats: z.number().int().min(1).max(15),
  doors: z.number().int().min(2).max(6).default(4),
  luggage: z.number().int().min(0).max(10).default(2),
  color: z.string().trim().max(40).nullable().optional(),
  mileageKm: z.number().int().min(0).max(2_000_000).default(0),
  fuelLevel: z.number().int().min(0).max(100).default(100),
  status: z.enum(["AVAILABLE", "RESERVED", "ON_RENT", "MAINTENANCE", "RETIRED"]).default("AVAILABLE"),
  imageUrl: z.string().trim().max(500).regex(/^\/[A-Za-z0-9_\-./]+$/, "Use a local path under /public").nullable().optional(),
  featureIds: z.array(z.uuid()).max(50).optional(),
});

async function setFeatures(db: Db, vehicleId: string, featureIds: string[] | undefined) {
  if (!featureIds) return;
  await db.transaction(async (tx) => {
    await tx.delete(vehicleFeatureMap).where(eq(vehicleFeatureMap.vehicleId, vehicleId));
    if (featureIds.length) await tx.insert(vehicleFeatureMap).values([...new Set(featureIds)].map((featureId) => ({ vehicleId, featureId })));
  });
}

export async function createVehicle(actorInput: Actor, input: z.input<typeof vehicleSchema>, opts: Opts = {}): Promise<VehicleDetails> {
  const actor = assertAdmin(actorInput);
  const { featureIds, ...data } = parseInput(vehicleSchema, input);
  const db = opts.db ?? getDb();
  const [row] = await guardUnique(() => db.insert(vehicles).values(data).returning({ id: vehicles.id }), { plate: "plate", vin: "vin" });
  await setFeatures(db, row.id, featureIds);
  await audit(db, { actorId: actor.userId, action: "vehicle.created", entityType: "vehicle", entityId: row.id, data: { plate: data.plate } });
  return getVehicle(row.id);
}

export async function updateVehicle(actorInput: Actor, input: { id: string } & Partial<z.input<typeof vehicleSchema>>, opts: Opts = {}): Promise<VehicleDetails> {
  const actor = assertAdmin(actorInput);
  const { id, featureIds, ...patch } = parseInput(vehicleSchema.partial().extend({ id: z.uuid() }), input);
  const db = opts.db ?? getDb();
  if (Object.keys(patch).length) {
    const [row] = await guardUnique(() => db.update(vehicles).set(patch).where(eq(vehicles.id, id)).returning({ id: vehicles.id }), {
      plate: "plate",
      vin: "vin",
    });
    if (!row) throw new NotFoundError("Vehicle");
  }
  await setFeatures(db, id, featureIds);
  await audit(db, { actorId: actor.userId, action: "vehicle.updated", entityType: "vehicle", entityId: id, data: { ...patch, featureIds } });
  return getVehicle(id);
}

export async function setVehicleStatus(
  actorInput: Actor,
  input: { vehicleId: string; status: "AVAILABLE" | "RESERVED" | "ON_RENT" | "MAINTENANCE" | "RETIRED" },
  opts: Opts = {},
): Promise<VehicleDetails> {
  return updateVehicle(actorInput, { id: input.vehicleId, status: input.status }, opts);
}

// ---------------------------------------------------------------------------
// Extras
// ---------------------------------------------------------------------------

const extraSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,30}$/),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).nullable().optional(),
  chargeType: z.enum(["PER_DAY", "PER_RENTAL"]),
  priceFils: z.number().int().min(0).max(10_000_000),
  maxQuantity: z.number().int().min(1).max(10).default(1),
  isActive: z.boolean().default(true),
});

export async function createExtra(actorInput: Actor, input: z.input<typeof extraSchema>, opts: Opts = {}): Promise<Extra> {
  const actor = assertAdmin(actorInput);
  const data = parseInput(extraSchema, input);
  const db = opts.db ?? getDb();
  const [row] = await guardUnique(() => db.insert(extras).values(data).returning(), { code: "code" });
  await audit(db, { actorId: actor.userId, action: "extra.created", entityType: "extra", entityId: row.id, data });
  return row;
}

export async function updateExtra(actorInput: Actor, input: { id: string } & Partial<z.input<typeof extraSchema>>, opts: Opts = {}): Promise<Extra> {
  const actor = assertAdmin(actorInput);
  const { id, ...patch } = parseInput(extraSchema.partial().extend({ id: z.uuid() }), input);
  const db = opts.db ?? getDb();
  const [row] = await guardUnique(() => db.update(extras).set(patch).where(eq(extras.id, id)).returning(), { code: "code" });
  if (!row) throw new NotFoundError("Extra");
  await audit(db, { actorId: actor.userId, action: "extra.updated", entityType: "extra", entityId: id, data: patch });
  return row;
}

// ---------------------------------------------------------------------------
// Pricing rules
// ---------------------------------------------------------------------------

const pricingRuleBase = z.object({
  kind: z.enum(["DAILY_RATE", "ONE_WAY_FEE", "VAT", "DEPOSIT", "LATE_RETURN"]),
  name: z.string().trim().min(2).max(120),
  categoryId: z.uuid().nullable().optional(),
  fromBranchId: z.uuid().nullable().optional(),
  toBranchId: z.uuid().nullable().optional(),
  minDays: z.number().int().min(1).max(365).default(1),
  amountFils: z.number().int().min(0).max(100_000_000).nullable().optional(),
  rateBps: z.number().int().min(0).max(10000).nullable().optional(),
  graceMinutes: z.number().int().min(0).max(1440).default(0),
  priority: z.number().int().min(-1000).max(1000).default(0),
  validFrom: instant.nullable().optional(),
  validTo: instant.nullable().optional(),
  isActive: z.boolean().default(true),
});
const pricingRuleSchema = pricingRuleBase
  .superRefine((v, ctx) => {
    if (v.kind === "DAILY_RATE" && (!v.categoryId || v.amountFils == null)) ctx.addIssue({ code: "custom", path: ["amountFils"], message: "Daily rates need a category and an amount" });
    if (v.kind === "VAT" && v.rateBps == null) ctx.addIssue({ code: "custom", path: ["rateBps"], message: "VAT needs a rate" });
    if (v.kind !== "VAT" && v.kind !== "DAILY_RATE" && v.amountFils == null) ctx.addIssue({ code: "custom", path: ["amountFils"], message: "Amount is required" });
  })
  .superRefine(checkRange("validFrom", "validTo", 100 * 365 * 86_400_000, { order: "End must be after start", tooLong: "Too long" }));

export async function listPricingRules(actorInput: Actor, opts: Opts = {}): Promise<PricingRule[]> {
  assertAdmin(actorInput);
  return (opts.db ?? getDb()).select().from(pricingRules).orderBy(pricingRules.kind, desc(pricingRules.isActive), pricingRules.name);
}

export async function createPricingRule(actorInput: Actor, input: z.input<typeof pricingRuleSchema>, opts: Opts = {}): Promise<PricingRule> {
  const actor = assertAdmin(actorInput);
  const data = parseInput(pricingRuleSchema, input);
  const db = opts.db ?? getDb();
  const [row] = await db.insert(pricingRules).values(data).returning();
  await audit(db, { actorId: actor.userId, action: "pricing_rule.created", entityType: "pricing_rule", entityId: row.id, data });
  return row;
}

/** Partial update; the merged rule is re-validated. Deactivate with { isActive: false }. */
export async function updatePricingRule(actorInput: Actor, input: { id: string } & Partial<z.input<typeof pricingRuleBase>>, opts: Opts = {}): Promise<PricingRule> {
  const actor = assertAdmin(actorInput);
  const id = parseInput(z.uuid(), input.id);
  const db = opts.db ?? getDb();
  const [current] = await db.select().from(pricingRules).where(eq(pricingRules.id, id));
  if (!current) throw new NotFoundError("Pricing rule");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id: _id, createdAt, updatedAt, ...rest } = current;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id: _ignored, ...patch } = input;
  const data = parseInput(pricingRuleSchema, { ...rest, ...patch });
  const [row] = await db.update(pricingRules).set(data).where(eq(pricingRules.id, id)).returning();
  await audit(db, { actorId: actor.userId, action: "pricing_rule.updated", entityType: "pricing_rule", entityId: id, data: patch });
  return row;
}

// ---------------------------------------------------------------------------
// Maintenance blocks
// ---------------------------------------------------------------------------

const maintenanceSchema = z
  .object({ vehicleId: z.uuid(), startsAt: instant, endsAt: instant, reason: z.string().trim().min(3).max(500) })
  .superRefine(checkRange("startsAt", "endsAt", 366 * 86_400_000, { order: "End must be after start", tooLong: "At most one year" }));

/** Blocks a vehicle. Throws VehicleUnavailableError if it overlaps an active booking or block. */
export async function createMaintenanceBlock(actorInput: Actor, input: z.input<typeof maintenanceSchema>, opts: Opts = {}): Promise<MaintenanceBlock> {
  const actor = assertAdmin(actorInput);
  const data = parseInput(maintenanceSchema, input);
  const db = opts.db ?? getDb();
  try {
    return await db.transaction(async (tx) => {
      const [v] = await tx.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.id, data.vehicleId)).for("update");
      if (!v) throw new NotFoundError("Vehicle");
      const [row] = await tx.insert(maintenanceBlocks).values({ ...data, createdById: actor.userId }).returning();
      await audit(tx, { actorId: actor.userId, action: "maintenance.created", entityType: "maintenance_block", entityId: row.id, data });
      return row;
    });
  } catch (error) {
    if (pgErrorCode(error) === PG_EXCLUSION_VIOLATION) {
      throw new VehicleUnavailableError("This period overlaps an existing booking or maintenance block");
    }
    throw error;
  }
}

export async function cancelMaintenanceBlock(actorInput: Actor, id: string, opts: Opts = {}): Promise<MaintenanceBlock> {
  const actor = assertAdmin(actorInput);
  const blockId = parseInput(z.uuid(), id);
  const db = opts.db ?? getDb();
  const [row] = await db
    .update(maintenanceBlocks)
    .set({ cancelledAt: opts.now ?? new Date() })
    .where(and(eq(maintenanceBlocks.id, blockId), sql`${maintenanceBlocks.cancelledAt} is null`))
    .returning();
  if (!row) {
    const [existing] = await db.select().from(maintenanceBlocks).where(eq(maintenanceBlocks.id, blockId));
    if (!existing) throw new NotFoundError("Maintenance block");
    return existing;
  }
  await audit(db, { actorId: actor.userId, action: "maintenance.cancelled", entityType: "maintenance_block", entityId: blockId });
  return row;
}

export async function listMaintenanceBlocks(
  actorInput: Actor,
  filter: { vehicleId?: string; from?: Date | string; to?: Date | string; includeCancelled?: boolean } = {},
  opts: Opts = {},
): Promise<MaintenanceBlock[]> {
  assertAdmin(actorInput);
  const f = parseInput(
    z.object({ vehicleId: z.uuid().optional(), from: instant.optional(), to: instant.optional(), includeCancelled: z.boolean().default(false) }),
    filter,
  );
  return (opts.db ?? getDb())
    .select()
    .from(maintenanceBlocks)
    .where(
      and(
        f.vehicleId ? eq(maintenanceBlocks.vehicleId, f.vehicleId) : undefined,
        f.from ? sql`${maintenanceBlocks.endsAt} > ${f.from.toISOString()}::timestamptz` : undefined,
        f.to ? sql`${maintenanceBlocks.startsAt} < ${f.to.toISOString()}::timestamptz` : undefined,
        f.includeCancelled ? undefined : sql`${maintenanceBlocks.cancelledAt} is null`,
      ),
    )
    .orderBy(maintenanceBlocks.startsAt);
}
