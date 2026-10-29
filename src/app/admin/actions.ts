"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { actionError, readImageUpload, type ActionState } from "@/app/_lib/action-result";
import {
  cancelMaintenanceBlock,
  cancelReservation,
  checkInReservation,
  checkOutReservation,
  createBranch,
  createCategory,
  createDamageReport,
  createExtra,
  createMaintenanceBlock,
  createPricingRule,
  createVehicle,
  getVehicle,
  setVehicleStatus,
  updateBranch,
  updateCategory,
  updateDamageReport,
  updateExtra,
  updatePricingRule,
  updateVehicle,
  uploadDamagePhoto,
} from "@/app/_lib/server-api";
import { parseAedToFils, zonedToUtc } from "@/lib/format";
import { getCurrentUser, toActor } from "@/server/auth/session";

class FormInputError extends Error {}

type Actor = { userId: string; role: "customer" | "admin" };

/** Runs an admin mutation: re-checks the session and role, maps errors, refreshes the page. */
async function asAdmin(event: string, fn: (actor: Actor) => Promise<string | void>): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin");
  if (user.role !== "admin") return { error: "Admins only.", code: "FORBIDDEN" };
  let message: string | void;
  try {
    message = await fn(toActor(user));
  } catch (error) {
    if (error instanceof FormInputError) return { error: error.message, code: "VALIDATION" };
    return actionError(event, error);
  }
  refresh();
  return { ok: true, message: message || "Saved." };
}

// ---- form helpers ---------------------------------------------------------

const s = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v.trim() : "";
};
const opt = (f: FormData, k: string) => s(f, k) || undefined;
const nullable = (f: FormData, k: string) => s(f, k) || null;
const bool = (f: FormData, k: string) => f.get(k) === "on" || f.get(k) === "true";
const int = (f: FormData, k: string) => {
  const v = s(f, k);
  return v === "" ? undefined : Number(v);
};

function fils(f: FormData, k: string, label: string): number | undefined {
  const v = s(f, k);
  if (v === "") return undefined;
  const n = parseAedToFils(v);
  if (n === null) throw new FormInputError(`${label}: enter an amount like 150 or 150.50`);
  return n;
}

// ---- branches -------------------------------------------------------------

export async function saveBranchAction(_p: ActionState, f: FormData): Promise<ActionState> {
  return wrap("app.admin.branch_save", async (actor) => {
    const input = {
      code: s(f, "code"),
      name: s(f, "name"),
      city: s(f, "city"),
      address: s(f, "address"),
      phone: nullable(f, "phone"),
      timezone: s(f, "timezone") || "Asia/Dubai",
      openingHours: nullable(f, "openingHours"),
      isActive: bool(f, "isActive"),
    };
    const id = opt(f, "id");
    if (id) {
      await updateBranch(actor, { id, ...input });
      return `Branch ${input.code} updated.`;
    }
    await createBranch(actor, input);
    return `Branch ${input.code} created.`;
  });
}

// ---- categories -----------------------------------------------------------

export async function saveCategoryAction(_p: ActionState, f: FormData): Promise<ActionState> {
  return wrap("app.admin.category_save", async (actor) => {
    const input = {
      code: s(f, "code"),
      name: s(f, "name"),
      description: nullable(f, "description"),
      sortOrder: int(f, "sortOrder") ?? 0,
    };
    const id = opt(f, "id");
    if (id) await updateCategory(actor, { id, ...input });
    else await createCategory(actor, input);
    return `Category ${input.name} saved.`;
  });
}

// ---- vehicles -------------------------------------------------------------

export async function saveVehicleAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = opt(f, "id");
  let createdId: string | undefined;
  const result = await wrap("app.admin.vehicle_save", async (actor) => {
    const input = {
      branchId: s(f, "branchId"),
      categoryId: s(f, "categoryId"),
      make: s(f, "make"),
      model: s(f, "model"),
      year: int(f, "year") ?? NaN,
      plate: s(f, "plate"),
      vin: s(f, "vin"),
      transmission: s(f, "transmission") as "AUTOMATIC" | "MANUAL",
      fuelType: s(f, "fuelType") as "PETROL" | "DIESEL" | "HYBRID" | "ELECTRIC",
      seats: int(f, "seats") ?? NaN,
      doors: int(f, "doors"),
      luggage: int(f, "luggage"),
      color: nullable(f, "color"),
      mileageKm: int(f, "mileageKm"),
      fuelLevel: int(f, "fuelLevel"),
      featureIds: f.getAll("featureIds").filter((v): v is string => typeof v === "string"),
    };
    if (id) {
      await updateVehicle(actor, { id, ...input });
      return `${input.make} ${input.model} updated.`;
    }
    const v = await createVehicle(actor, input);
    createdId = v.id;
    return `${input.make} ${input.model} added to the fleet.`;
  });
  if (createdId) redirect(`/admin/fleet/${createdId}?created=1`);
  return result;
}

const vehicleStatusSchema = z.object({
  vehicleId: z.uuid(),
  status: z.enum(["AVAILABLE", "MAINTENANCE", "RETIRED"]),
});

export async function setVehicleStatusAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const parsed = vehicleStatusSchema.safeParse({ vehicleId: s(f, "vehicleId"), status: s(f, "status") });
  if (!parsed.success) return { error: "Choose a valid status." };
  return wrap("app.admin.vehicle_status", async (actor) => {
    await setVehicleStatus(actor, parsed.data);
    return `Status set to ${parsed.data.status.toLowerCase()}.`;
  });
}

export async function createMaintenanceAction(_p: ActionState, f: FormData): Promise<ActionState> {
  return wrap("app.admin.maintenance_create", async (actor) => {
    const vehicle = await getVehicle(s(f, "vehicleId"));
    const tz = vehicle.branch.timezone;
    const startsAt = zonedToUtc(s(f, "startDate"), s(f, "startTime"), tz);
    const endsAt = zonedToUtc(s(f, "endDate"), s(f, "endTime"), tz);
    if (!startsAt || !endsAt) throw new FormInputError("Choose valid start and end dates.");
    await createMaintenanceBlock(actor, { vehicleId: vehicle.id, startsAt, endsAt, reason: s(f, "reason") });
    return "Maintenance block added. The car is hidden from search for that period.";
  });
}

export async function cancelMaintenanceAction(_p: ActionState, f: FormData): Promise<ActionState> {
  return wrap("app.admin.maintenance_cancel", async (actor) => {
    await cancelMaintenanceBlock(actor, s(f, "id"));
    return "Maintenance block cancelled.";
  });
}

// ---- extras & pricing -----------------------------------------------------

export async function saveExtraAction(_p: ActionState, f: FormData): Promise<ActionState> {
  return wrap("app.admin.extra_save", async (actor) => {
    const input = {
      code: s(f, "code"),
      name: s(f, "name"),
      description: nullable(f, "description"),
      chargeType: s(f, "chargeType") as "PER_DAY" | "PER_RENTAL",
      priceFils: fils(f, "price", "Price") ?? NaN,
      maxQuantity: int(f, "maxQuantity") ?? 1,
      isActive: bool(f, "isActive"),
    };
    const id = opt(f, "id");
    if (id) await updateExtra(actor, { id, ...input });
    else await createExtra(actor, input);
    return `Extra ${input.name} saved.`;
  });
}

function percentToBps(v: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(v.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

export async function savePricingRuleAction(_p: ActionState, f: FormData): Promise<ActionState> {
  return wrap("app.admin.pricing_save", async (actor) => {
    const kind = s(f, "kind") as "DAILY_RATE" | "ONE_WAY_FEE" | "VAT" | "DEPOSIT" | "LATE_RETURN";
    const rate = s(f, "ratePercent");
    const rateBps = rate ? percentToBps(rate) : null;
    if (rate && rateBps === null) throw new FormInputError("Rate: enter a percentage like 5 or 5.25");
    const input = {
      kind,
      name: s(f, "name"),
      categoryId: nullable(f, "categoryId"),
      fromBranchId: nullable(f, "fromBranchId"),
      toBranchId: nullable(f, "toBranchId"),
      minDays: int(f, "minDays") ?? 1,
      amountFils: fils(f, "amount", "Amount") ?? null,
      rateBps,
      graceMinutes: int(f, "graceMinutes") ?? 0,
      priority: int(f, "priority") ?? 0,
      isActive: bool(f, "isActive"),
    };
    const id = opt(f, "id");
    if (id) await updatePricingRule(actor, { id, ...input });
    else await createPricingRule(actor, input);
    return `Pricing rule "${input.name}" saved. New quotes use it immediately.`;
  });
}

// ---- reservations: check-out / check-in / cancel ----------------------------

export async function checkOutAction(_p: ActionState, f: FormData): Promise<ActionState> {
  return wrap("app.admin.check_out", async (actor) => {
    await checkOutReservation(actor, {
      reservationId: s(f, "reservationId"),
      mileageKm: int(f, "mileageKm") ?? NaN,
      fuelLevel: int(f, "fuelLevel") ?? NaN,
      notes: opt(f, "notes"),
    });
    return "Checked out. The car is now on rent.";
  });
}

async function uploadPhotos(actor: Actor, f: FormData, field: string): Promise<string[]> {
  const files = f.getAll(field).filter((v) => v instanceof File && v.size > 0);
  if (files.length > 6) throw new FormInputError("Upload at most 6 photos at a time.");
  const keys: string[] = [];
  for (const file of files) {
    const up = await readImageUpload(file, { required: true });
    if (!up.ok) throw new FormInputError(`Photo "${(file as File).name}": ${up.error}`);
    if (!up.body) continue;
    const { key } = await uploadDamagePhoto(actor, { body: up.body, contentType: up.contentType });
    keys.push(key);
  }
  return keys;
}

export async function checkInAction(_p: ActionState, f: FormData): Promise<ActionState> {
  return wrap("app.admin.check_in", async (actor) => {
    const hasDamage = bool(f, "hasDamage");
    const photoKeys = hasDamage ? await uploadPhotos(actor, f, "photos") : [];
    const severity = s(f, "severity") as "MINOR" | "MODERATE" | "MAJOR";
    await checkInReservation(actor, {
      reservationId: s(f, "reservationId"),
      mileageKm: int(f, "mileageKm") ?? NaN,
      fuelLevel: int(f, "fuelLevel") ?? NaN,
      returnBranchId: opt(f, "returnBranchId"),
      notes: opt(f, "notes"),
      damage: hasDamage
        ? {
            severity,
            description: s(f, "damageDescription"),
            chargeFils: fils(f, "damageCharge", "Damage charge") ?? 0,
            repairCostFils: fils(f, "repairCost", "Repair cost"),
            photoKeys,
          }
        : undefined,
    });
    return "Checked in. Charges were taken from the deposit and the rest released.";
  });
}

export async function adminCancelAction(_p: ActionState, f: FormData): Promise<ActionState> {
  return wrap("app.admin.cancel", async (actor) => {
    await cancelReservation(actor, { reservationId: s(f, "reservationId"), reason: opt(f, "reason") });
    return "Booking cancelled per policy.";
  });
}

// ---- damage reports ---------------------------------------------------------

export async function createDamageAction(_p: ActionState, f: FormData): Promise<ActionState> {
  return wrap("app.admin.damage_create", async (actor) => {
    const photoKeys = await uploadPhotos(actor, f, "photos");
    await createDamageReport(actor, {
      vehicleId: s(f, "vehicleId"),
      reservationId: opt(f, "reservationId"),
      severity: s(f, "severity") as "MINOR" | "MODERATE" | "MAJOR",
      description: s(f, "description"),
      repairCostFils: fils(f, "repairCost", "Repair cost"),
      photoKeys,
    });
    return "Damage report filed.";
  });
}

export async function updateDamageAction(_p: ActionState, f: FormData): Promise<ActionState> {
  return wrap("app.admin.damage_update", async (actor) => {
    const newPhotos = await uploadPhotos(actor, f, "photos");
    const existing = f.getAll("existingPhotoKeys").filter((v): v is string => typeof v === "string");
    await updateDamageReport(actor, {
      id: s(f, "id"),
      status: (opt(f, "status") as "OPEN" | "CHARGED" | "RESOLVED" | undefined) ?? undefined,
      repairCostFils: fils(f, "repairCost", "Repair cost") ?? null,
      photoKeys: newPhotos.length ? [...existing, ...newPhotos] : undefined,
    });
    return "Damage report updated.";
  });
}

// ---- shared wrapper -----------------------------------------------------------

function wrap(event: string, fn: (actor: Actor) => Promise<string | void>): Promise<ActionState> {
  return asAdmin(event, fn);
}
