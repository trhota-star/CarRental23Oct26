// Read-only catalog queries: branches, categories, extras, features, vehicles.
// Public data (no actor needed). Admin CRUD lives in ../admin.

import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Executor } from "../db";
import { branches, extras, vehicleCategories, vehicleFeatureMap, vehicleFeatures, vehicles } from "../db/schema";
import { NotFoundError } from "../errors";
import { parseInput, uuid } from "../validation";

export type Branch = typeof branches.$inferSelect;
export type VehicleCategory = typeof vehicleCategories.$inferSelect;
export type Extra = typeof extras.$inferSelect;
export type VehicleFeature = { id: string; code: string; name: string };

export type VehicleDetails = typeof vehicles.$inferSelect & {
  branch: Pick<Branch, "id" | "code" | "name" | "city" | "timezone">;
  category: Pick<VehicleCategory, "id" | "code" | "name">;
  features: VehicleFeature[];
};

export async function listBranches(opts: { includeInactive?: boolean } = {}): Promise<Branch[]> {
  const db = getDb();
  return db
    .select()
    .from(branches)
    .where(opts.includeInactive ? undefined : eq(branches.isActive, true))
    .orderBy(asc(branches.city), asc(branches.name));
}

export async function getBranch(id: string): Promise<Branch> {
  const branchId = parseInput(uuid, id);
  const [row] = await getDb().select().from(branches).where(eq(branches.id, branchId));
  if (!row) throw new NotFoundError("Branch");
  return row;
}

export async function listCategories(): Promise<VehicleCategory[]> {
  return getDb().select().from(vehicleCategories).orderBy(asc(vehicleCategories.sortOrder), asc(vehicleCategories.name));
}

export async function listExtras(opts: { includeInactive?: boolean } = {}): Promise<Extra[]> {
  return getDb()
    .select()
    .from(extras)
    .where(opts.includeInactive ? undefined : eq(extras.isActive, true))
    .orderBy(asc(extras.name));
}

export async function listFeatures(): Promise<VehicleFeature[]> {
  return getDb()
    .select({ id: vehicleFeatures.id, code: vehicleFeatures.code, name: vehicleFeatures.name })
    .from(vehicleFeatures)
    .orderBy(asc(vehicleFeatures.name));
}

/** Features for many vehicles at once. */
export async function featuresByVehicle(ids: string[], db: Executor = getDb()): Promise<Map<string, VehicleFeature[]>> {
  const map = new Map<string, VehicleFeature[]>();
  if (ids.length === 0) return map;
  const rows = await db
    .select({ vehicleId: vehicleFeatureMap.vehicleId, id: vehicleFeatures.id, code: vehicleFeatures.code, name: vehicleFeatures.name })
    .from(vehicleFeatureMap)
    .innerJoin(vehicleFeatures, eq(vehicleFeatures.id, vehicleFeatureMap.featureId))
    .where(inArray(vehicleFeatureMap.vehicleId, ids))
    .orderBy(asc(vehicleFeatures.name));
  for (const r of rows) {
    const list = map.get(r.vehicleId) ?? [];
    list.push({ id: r.id, code: r.code, name: r.name });
    map.set(r.vehicleId, list);
  }
  return map;
}

/** Vehicle with branch, category and features. Throws NotFound. */
export async function getVehicle(id: string): Promise<VehicleDetails> {
  const vehicleId = parseInput(uuid, id);
  const db = getDb();
  const [row] = await db
    .select({
      v: vehicles,
      branch: { id: branches.id, code: branches.code, name: branches.name, city: branches.city, timezone: branches.timezone },
      category: { id: vehicleCategories.id, code: vehicleCategories.code, name: vehicleCategories.name },
    })
    .from(vehicles)
    .innerJoin(branches, eq(branches.id, vehicles.branchId))
    .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
    .where(eq(vehicles.id, vehicleId));
  if (!row) throw new NotFoundError("Vehicle");
  const features = (await featuresByVehicle([vehicleId], db)).get(vehicleId) ?? [];
  return { ...row.v, branch: row.branch, category: row.category, features };
}

const listVehiclesSchema = z.object({
  branchId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  status: z.enum(["AVAILABLE", "RESERVED", "ON_RENT", "MAINTENANCE", "RETIRED"]).optional(),
});

/** Fleet listing (no availability check). Used by admin and branch pages. */
export async function listVehicles(input: z.input<typeof listVehiclesSchema> = {}): Promise<VehicleDetails[]> {
  const f = parseInput(listVehiclesSchema, input);
  const db = getDb();
  const rows = await db
    .select({
      v: vehicles,
      branch: { id: branches.id, code: branches.code, name: branches.name, city: branches.city, timezone: branches.timezone },
      category: { id: vehicleCategories.id, code: vehicleCategories.code, name: vehicleCategories.name },
    })
    .from(vehicles)
    .innerJoin(branches, eq(branches.id, vehicles.branchId))
    .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
    .where(
      and(
        f.branchId ? eq(vehicles.branchId, f.branchId) : undefined,
        f.categoryId ? eq(vehicles.categoryId, f.categoryId) : undefined,
        f.status ? eq(vehicles.status, f.status) : undefined,
      ),
    )
    .orderBy(asc(branches.code), asc(vehicleCategories.sortOrder), asc(vehicles.make), asc(vehicles.model));
  const features = await featuresByVehicle(rows.map((r) => r.v.id), db);
  return rows.map((r) => ({ ...r.v, branch: r.branch, category: r.category, features: features.get(r.v.id) ?? [] }));
}
