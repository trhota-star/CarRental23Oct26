// Idempotent demo data. Safe to run repeatedly.
//   pnpm db:seed         → DATABASE_URL (driveeasy_dev)
//   pnpm db:seed:test    → TEST_DATABASE_URL (driveeasy_test)
//
// Catalog rows are upserted on their natural keys (codes, plates, emails) or on
// deterministic ids. Demo reservations go through the real reservation functions
// with fixed idempotency keys, so re-running never duplicates them.

import { createHash } from "node:crypto";
import { loadLocalEnv } from "./load-env";

loadLocalEnv();
if (process.argv.includes("--test")) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

export const SEED_USERS = {
  admin: { email: "admin@driveeasy.local", password: "DriveEasyAdmin!2026", name: "DriveEasy Admin", role: "admin" as const },
  customer: { email: "customer@driveeasy.local", password: "DriveEasyDemo!2026", name: "Layla Customer", role: "customer" as const },
  customer2: { email: "omar@driveeasy.local", password: "DriveEasyDemo!2026", name: "Omar Customer", role: "customer" as const },
};

/** Deterministic UUID (v5-shaped) from a name, for rows without a natural key. */
function seedId(name: string): string {
  const h = createHash("sha1").update(`driveeasy-seed:${name}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

async function main() {
  // Imported after env is set so getDb() sees the right DATABASE_URL.
  const { eq, sql } = await import("drizzle-orm");
  const { hashPassword } = await import("better-auth/crypto");
  const { getDb, closeDb } = await import("../src/server/db");
  const s = await import("../src/server/db/schema");
  const { getFileStorage } = await import("../src/server/storage");

  const db = getDb();
  const url = new URL(process.env.DATABASE_URL!);
  console.log(`Seeding ${url.pathname.slice(1)}…`);

  // ---- users (better-auth credential accounts) ----
  const userIds: Record<keyof typeof SEED_USERS, string> = { admin: "", customer: "", customer2: "" };
  for (const [key, u] of Object.entries(SEED_USERS) as [keyof typeof SEED_USERS, (typeof SEED_USERS)[keyof typeof SEED_USERS]][]) {
    const [row] = await db
      .insert(s.users)
      .values({ name: u.name, email: u.email, emailVerified: true, role: u.role })
      .onConflictDoUpdate({ target: s.users.email, set: { role: u.role, name: u.name } })
      .returning({ id: s.users.id });
    userIds[key] = row.id;
    const existing = await db.query.accounts.findFirst({
      where: (a, { and, eq }) => and(eq(a.userId, row.id), eq(a.providerId, "credential")),
    });
    if (!existing) {
      await db.insert(s.accounts).values({
        userId: row.id,
        accountId: row.id,
        providerId: "credential",
        password: await hashPassword(u.password),
      });
    }
  }

  // ---- branches ----
  const branchData = [
    { code: "DXB", name: "Dubai International Airport T3", city: "Dubai", address: "Arrivals Hall, Terminal 3, Dubai International Airport", phone: "+971 4 000 0001", openingHours: "Open 24 hours" },
    { code: "DXM", name: "Dubai Marina", city: "Dubai", address: "Marina Walk, Dubai Marina", phone: "+971 4 000 0002", openingHours: "Daily 08:00–22:00" },
    { code: "AUH", name: "Abu Dhabi Corniche", city: "Abu Dhabi", address: "Corniche Road West, Abu Dhabi", phone: "+971 2 000 0003", openingHours: "Daily 08:00–21:00" },
    { code: "SHJ", name: "Sharjah City Centre", city: "Sharjah", address: "Al Wahda Street, Sharjah", phone: "+971 6 000 0004", openingHours: "Sat–Thu 08:00–20:00" },
  ];
  const branchIds: Record<string, string> = {};
  for (const b of branchData) {
    const [row] = await db
      .insert(s.branches)
      .values({ ...b, timezone: "Asia/Dubai" })
      .onConflictDoUpdate({ target: s.branches.code, set: { ...b, timezone: "Asia/Dubai" } })
      .returning({ id: s.branches.id });
    branchIds[b.code] = row.id;
  }

  // ---- categories ----
  const categoryData = [
    { code: "ECONOMY", name: "Economy", description: "Small, fuel-efficient city cars", sortOrder: 1 },
    { code: "COMPACT", name: "Compact", description: "Comfortable sedans for longer trips", sortOrder: 2 },
    { code: "SUV", name: "SUV", description: "Space for families and luggage", sortOrder: 3 },
    { code: "LUXURY", name: "Luxury", description: "Premium sedans and coupés", sortOrder: 4 },
    { code: "VAN", name: "Van", description: "Seven seats and more", sortOrder: 5 },
  ];
  const categoryIds: Record<string, string> = {};
  for (const c of categoryData) {
    const [row] = await db
      .insert(s.vehicleCategories)
      .values(c)
      .onConflictDoUpdate({ target: s.vehicleCategories.code, set: c })
      .returning({ id: s.vehicleCategories.id });
    categoryIds[c.code] = row.id;
  }

  // ---- features ----
  const featureData = [
    { code: "BLUETOOTH", name: "Bluetooth" },
    { code: "CARPLAY", name: "Apple CarPlay / Android Auto" },
    { code: "REVERSE_CAMERA", name: "Reversing camera" },
    { code: "CRUISE", name: "Cruise control" },
    { code: "SUNROOF", name: "Sunroof" },
    { code: "AWD", name: "All-wheel drive" },
  ];
  const featureIds: Record<string, string> = {};
  for (const f of featureData) {
    const [row] = await db
      .insert(s.vehicleFeatures)
      .values(f)
      .onConflictDoUpdate({ target: s.vehicleFeatures.code, set: { name: f.name } })
      .returning({ id: s.vehicleFeatures.id });
    featureIds[f.code] = row.id;
  }

  // ---- vehicles (20) ----
  type V = [branch: string, cat: string, make: string, model: string, year: number, trans: "AUTOMATIC" | "MANUAL", fuel: "PETROL" | "DIESEL" | "HYBRID" | "ELECTRIC", seats: number, color: string, features: string[]];
  const vehicleData: V[] = [
    ["DXB", "ECONOMY", "Nissan", "Sunny", 2025, "AUTOMATIC", "PETROL", 5, "White", ["BLUETOOTH"]],
    ["DXB", "ECONOMY", "Toyota", "Yaris", 2025, "AUTOMATIC", "PETROL", 5, "Silver", ["BLUETOOTH", "CARPLAY"]],
    ["DXB", "COMPACT", "Toyota", "Corolla Hybrid", 2026, "AUTOMATIC", "HYBRID", 5, "Grey", ["BLUETOOTH", "CARPLAY", "REVERSE_CAMERA", "CRUISE"]],
    ["DXB", "SUV", "Toyota", "RAV4", 2025, "AUTOMATIC", "HYBRID", 5, "Blue", ["CARPLAY", "REVERSE_CAMERA", "AWD"]],
    ["DXB", "LUXURY", "Mercedes-Benz", "E 300", 2026, "AUTOMATIC", "PETROL", 5, "Black", ["CARPLAY", "REVERSE_CAMERA", "CRUISE", "SUNROOF"]],
    ["DXB", "VAN", "Kia", "Carnival", 2025, "AUTOMATIC", "PETROL", 8, "White", ["CARPLAY", "REVERSE_CAMERA"]],
    ["DXM", "ECONOMY", "Hyundai", "Accent", 2024, "MANUAL", "PETROL", 5, "Red", ["BLUETOOTH"]],
    ["DXM", "COMPACT", "Honda", "Civic", 2025, "AUTOMATIC", "PETROL", 5, "White", ["CARPLAY", "REVERSE_CAMERA"]],
    ["DXM", "SUV", "Nissan", "Patrol", 2025, "AUTOMATIC", "PETROL", 7, "Pearl", ["CARPLAY", "REVERSE_CAMERA", "AWD", "SUNROOF"]],
    ["DXM", "LUXURY", "BMW", "i5", 2026, "AUTOMATIC", "ELECTRIC", 5, "Grey", ["CARPLAY", "REVERSE_CAMERA", "CRUISE"]],
    ["DXM", "ECONOMY", "Kia", "Picanto", 2025, "AUTOMATIC", "PETROL", 4, "Yellow", ["BLUETOOTH"]],
    ["AUH", "ECONOMY", "Nissan", "Sunny", 2024, "MANUAL", "PETROL", 5, "Silver", ["BLUETOOTH"]],
    ["AUH", "COMPACT", "Hyundai", "Elantra", 2025, "AUTOMATIC", "PETROL", 5, "Blue", ["CARPLAY", "CRUISE"]],
    ["AUH", "SUV", "Mitsubishi", "Pajero", 2024, "AUTOMATIC", "DIESEL", 7, "White", ["REVERSE_CAMERA", "AWD"]],
    ["AUH", "SUV", "Tesla", "Model Y", 2026, "AUTOMATIC", "ELECTRIC", 5, "White", ["CARPLAY", "REVERSE_CAMERA", "AWD", "SUNROOF"]],
    ["AUH", "VAN", "Toyota", "Hiace", 2024, "MANUAL", "DIESEL", 12, "White", ["REVERSE_CAMERA"]],
    ["SHJ", "ECONOMY", "Toyota", "Yaris", 2024, "AUTOMATIC", "PETROL", 5, "Red", ["BLUETOOTH"]],
    ["SHJ", "COMPACT", "Kia", "K5", 2025, "AUTOMATIC", "PETROL", 5, "Black", ["CARPLAY", "REVERSE_CAMERA"]],
    ["SHJ", "SUV", "Hyundai", "Tucson", 2025, "AUTOMATIC", "HYBRID", 5, "Green", ["CARPLAY", "REVERSE_CAMERA"]],
    ["SHJ", "LUXURY", "Lexus", "ES 300h", 2025, "AUTOMATIC", "HYBRID", 5, "White", ["CARPLAY", "CRUISE", "SUNROOF"]],
  ];
  const vehicleIds: string[] = [];
  for (const [i, [branch, cat, make, model, year, trans, fuel, seats, color, features]] of vehicleData.entries()) {
    const n = i + 1;
    const plate = `${branch === "AUH" ? "AD" : branch === "SHJ" ? "SHJ" : "DXB"} ${String.fromCharCode(65 + (i % 20))} ${String(10000 + n * 137)}`;
    const values = {
      branchId: branchIds[branch],
      categoryId: categoryIds[cat],
      make,
      model,
      year,
      plate,
      vin: `JDE5EAS7${String(n).padStart(9, "0")}`,
      transmission: trans,
      fuelType: fuel,
      seats,
      doors: seats > 7 ? 5 : seats === 4 ? 4 : 4,
      luggage: cat === "VAN" ? 6 : cat === "SUV" ? 4 : cat === "ECONOMY" ? 2 : 3,
      color,
      mileageKm: 5000 + n * 1731,
      fuelLevel: 100,
    };
    const [row] = await db
      .insert(s.vehicles)
      .values(values)
      .onConflictDoUpdate({
        target: s.vehicles.plate,
        set: { make, model, year, transmission: trans, fuelType: fuel, seats, color, categoryId: values.categoryId },
      })
      .returning({ id: s.vehicles.id });
    vehicleIds.push(row.id);
    for (const f of features) {
      await db.insert(s.vehicleFeatureMap).values({ vehicleId: row.id, featureId: featureIds[f] }).onConflictDoNothing();
    }
  }

  // ---- extras ----
  const extraData = [
    { code: "GPS", name: "GPS navigation", description: "Portable sat-nav unit", chargeType: "PER_DAY" as const, priceFils: 2500, maxQuantity: 1 },
    { code: "CHILD_SEAT", name: "Child seat", description: "For children 9–18 kg", chargeType: "PER_DAY" as const, priceFils: 3000, maxQuantity: 3 },
    { code: "ADDITIONAL_DRIVER", name: "Additional driver", description: "Add a second named driver", chargeType: "PER_DAY" as const, priceFils: 2000, maxQuantity: 2 },
    { code: "FULL_INSURANCE", name: "Full insurance (zero excess)", description: "Reduces your damage liability to zero", chargeType: "PER_DAY" as const, priceFils: 5000, maxQuantity: 1 },
    { code: "WIFI", name: "Mobile Wi-Fi hotspot", description: "Unlimited 5G data", chargeType: "PER_DAY" as const, priceFils: 1500, maxQuantity: 1 },
    { code: "PREPAID_FUEL", name: "Pre-paid fuel", description: "Return the car at any fuel level", chargeType: "PER_RENTAL" as const, priceFils: 12000, maxQuantity: 1 },
  ];
  for (const e of extraData) {
    await db.insert(s.extras).values(e).onConflictDoUpdate({ target: s.extras.code, set: e });
  }

  // ---- pricing rules (deterministic ids) ----
  type RuleSeed = Omit<typeof s.pricingRules.$inferInsert, "id"> & { key: string };
  const rate = (cat: string, perDay: number, weekly: number, monthly: number): RuleSeed[] => [
    { key: `rate:${cat}:1`, kind: "DAILY_RATE", name: `${cat} daily rate`, categoryId: categoryIds[cat], minDays: 1, amountFils: perDay },
    { key: `rate:${cat}:7`, kind: "DAILY_RATE", name: `${cat} weekly rate (7+ days)`, categoryId: categoryIds[cat], minDays: 7, amountFils: weekly },
    { key: `rate:${cat}:30`, kind: "DAILY_RATE", name: `${cat} monthly rate (30+ days)`, categoryId: categoryIds[cat], minDays: 30, amountFils: monthly },
  ];
  const rules: RuleSeed[] = [
    ...rate("ECONOMY", 9900, 8900, 7500),
    ...rate("COMPACT", 13900, 12500, 10500),
    ...rate("SUV", 24900, 22500, 19000),
    ...rate("LUXURY", 59900, 54000, 46000),
    ...rate("VAN", 29900, 27000, 23000),
    { key: "vat", kind: "VAT", name: "UAE VAT 5%", rateBps: 500 },
    { key: "deposit:default", kind: "DEPOSIT", name: "Default security deposit", amountFils: 100000 },
    { key: "deposit:SUV", kind: "DEPOSIT", name: "SUV security deposit", categoryId: categoryIds.SUV, amountFils: 150000 },
    { key: "deposit:LUXURY", kind: "DEPOSIT", name: "Luxury security deposit", categoryId: categoryIds.LUXURY, amountFils: 300000 },
    { key: "deposit:VAN", kind: "DEPOSIT", name: "Van security deposit", categoryId: categoryIds.VAN, amountFils: 150000 },
    { key: "late:default", kind: "LATE_RETURN", name: "Late return (per started hour)", amountFils: 2500, graceMinutes: 59 },
    { key: "late:LUXURY", kind: "LATE_RETURN", name: "Luxury late return (per started hour)", categoryId: categoryIds.LUXURY, amountFils: 10000, graceMinutes: 59 },
    { key: "oneway:any", kind: "ONE_WAY_FEE", name: "One-way fee (same emirate group)", amountFils: 15000 },
    { key: "oneway:DXB-DXM", kind: "ONE_WAY_FEE", name: "One-way Dubai ↔ Dubai", fromBranchId: branchIds.DXB, toBranchId: branchIds.DXM, amountFils: 5000 },
    { key: "oneway:DXM-DXB", kind: "ONE_WAY_FEE", name: "One-way Dubai ↔ Dubai", fromBranchId: branchIds.DXM, toBranchId: branchIds.DXB, amountFils: 5000 },
    ...["DXB", "DXM", "SHJ"].flatMap((from): RuleSeed[] => [
      { key: `oneway:${from}-AUH`, kind: "ONE_WAY_FEE", name: `One-way ${from} → Abu Dhabi`, fromBranchId: branchIds[from], toBranchId: branchIds.AUH, amountFils: 25000 },
      { key: `oneway:AUH-${from}`, kind: "ONE_WAY_FEE", name: `One-way Abu Dhabi → ${from}`, fromBranchId: branchIds.AUH, toBranchId: branchIds[from], amountFils: 25000 },
    ]),
  ];
  for (const { key, ...r } of rules) {
    const id = seedId(key);
    const row = { categoryId: null, fromBranchId: null, toBranchId: null, minDays: 1, amountFils: null, rateBps: null, graceMinutes: 0, ...r };
    await db.insert(s.pricingRules).values({ id, ...row }).onConflictDoUpdate({ target: s.pricingRules.id, set: row });
  }

  // ---- driver profile + licence for the demo customers ----
  const storage = getFileStorage();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  for (const key of ["customer", "customer2"] as const) {
    const userId = userIds[key];
    const fileKey = `licences/${userId}/seed-licence.png`;
    if (!(await storage.exists(fileKey))) await storage.put(fileKey, png, "image/png");
    const profile = {
      fullName: SEED_USERS[key].name,
      phone: "+971 50 000 0000",
      dateOfBirth: "1990-05-14",
      nationality: "AE",
      licenceNumber: key === "customer" ? "DXB-1234567" : "DXB-7654321",
      licenceCountry: "AE",
      licenceExpiry: "2032-12-31",
      licenceFileKey: fileKey,
      licenceContentType: "image/png",
      licenceUploadedAt: new Date(),
    };
    await db
      .insert(s.driverProfiles)
      .values({ userId, ...profile })
      .onConflictDoUpdate({ target: s.driverProfiles.userId, set: profile });
  }

  // ---- maintenance block (deterministic) ----
  const maintenanceId = seedId("maintenance:1");
  const existingBlock = await db.query.maintenanceBlocks.findFirst({ where: eq(s.maintenanceBlocks.id, maintenanceId) });
  if (!existingBlock) {
    const start = startOfDayUtc(addDays(new Date(), 20));
    try {
      await db.insert(s.maintenanceBlocks).values({
        id: maintenanceId,
        vehicleId: vehicleIds[3],
        startsAt: start,
        endsAt: addDays(start, 2),
        reason: "Scheduled service (seed)",
        createdById: userIds.admin,
      });
    } catch (error) {
      console.warn(`  maintenance block skipped: ${(error as Error).message}`);
    }
  }

  // ---- demo reservations through the real functions ----
  const seeded = await seedReservations({ userIds, branchIds, vehicleIds });

  const counts = await db.execute(sql`
    select (select count(*) from branches) as branches, (select count(*) from vehicles) as vehicles,
           (select count(*) from extras) as extras, (select count(*) from pricing_rules) as pricing_rules,
           (select count(*) from reservations) as reservations, (select count(*) from vehicle_bookings) as bookings`);
  console.log("Seed complete:", counts.rows[0], `(${seeded} demo reservations ensured)`);
  console.log("Logins:");
  for (const u of Object.values(SEED_USERS)) console.log(`  ${u.role.padEnd(8)} ${u.email} / ${u.password}`);
  await closeDb();
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}
function startOfDayUtc(d: Date): Date {
  // 06:00 UTC = 10:00 Asia/Dubai
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 6, 0, 0));
}

async function seedReservations(ctx: { userIds: Record<string, string>; branchIds: Record<string, string>; vehicleIds: string[] }): Promise<number> {
  const { createReservationHold, payForReservation } = await import("../src/server/reservations/service");
  const { FAKE_PAYMENT_METHODS } = await import("../src/server/payments/fake");
  const customer = { userId: ctx.userIds.customer, role: "customer" as const };
  const customer2 = { userId: ctx.userIds.customer2, role: "customer" as const };
  const base = startOfDayUtc(addDays(new Date(), 7));
  const plans = [
    { actor: customer, key: "seed-res-1", vehicle: 0, from: "DXB", to: "DXB", startDay: 0, days: 3, extras: ["GPS"], pay: true },
    { actor: customer, key: "seed-res-2", vehicle: 3, from: "DXB", to: "AUH", startDay: 16, days: 4, extras: ["CHILD_SEAT"], pay: true },
    { actor: customer2, key: "seed-res-3", vehicle: 7, from: "DXM", to: "DXM", startDay: 2, days: 5, extras: [], pay: true },
    { actor: customer2, key: "seed-res-4", vehicle: 14, from: "AUH", to: "AUH", startDay: 5, days: 2, extras: [], pay: true },
  ];
  const { getDb } = await import("../src/server/db");
  const { extras } = await import("../src/server/db/schema");
  const allExtras = await getDb().select({ id: extras.id, code: extras.code }).from(extras);
  const extraId = (code: string) => allExtras.find((e) => e.code === code)!.id;
  let ensured = 0;
  for (const p of plans) {
    const pickupAt = addDays(base, p.startDay);
    try {
      const r = await createReservationHold(p.actor, {
        vehicleId: ctx.vehicleIds[p.vehicle],
        pickupBranchId: ctx.branchIds[p.from],
        returnBranchId: ctx.branchIds[p.to],
        pickupAt,
        returnAt: addDays(pickupAt, p.days),
        extras: p.extras.map((code) => ({ extraId: extraId(code), quantity: 1 })),
        idempotencyKey: p.key,
      });
      if (p.pay && r.status === "PENDING") {
        await payForReservation(p.actor, {
          reservationId: r.id,
          paymentMethod: FAKE_PAYMENT_METHODS.success,
          idempotencyKey: `${p.key}-pay`,
        });
      }
      ensured++;
    } catch (error) {
      console.warn(`  reservation ${p.key} skipped: ${(error as Error).message}`);
    }
  }
  return ensured;
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
