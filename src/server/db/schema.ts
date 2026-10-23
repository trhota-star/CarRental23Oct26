// DriveEasy database schema (Drizzle). Generate migrations with `pnpm db:generate`.
//
// Conventions
// - UUID primary keys (gen_random_uuid()).
// - timestamptz everywhere, stored in UTC.
// - Money is integer fils (AED minor units) in `*_fils` integer columns.
// - Rental periods are tstzrange '[)' (half-open) so back-to-back bookings never overlap.
// - ONE exclusion constraint on `vehicle_bookings` (vehicle_id WITH =, period WITH &&)
//   covers active reservations AND maintenance blocks. Rows in `vehicle_bookings`
//   are maintained by triggers on `reservations` and `maintenance_blocks`
//   (see drizzle/0001_*.sql and docs/server-api.md).
//
// Drizzle cannot express EXCLUDE constraints or triggers; they live in the
// hand-written custom migration that follows the generated one.

import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Custom types
// ---------------------------------------------------------------------------

/** PostgreSQL tstzrange. Read as the raw range literal, e.g. ["2026-01-01 10:00:00+00","2026-01-03 10:00:00+00"). */
export const tstzrange = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tstzrange";
  },
});

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () =>
  ts("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const userRole = pgEnum("user_role", ["customer", "admin"]);
export const vehicleStatus = pgEnum("vehicle_status", ["AVAILABLE", "RESERVED", "ON_RENT", "MAINTENANCE", "RETIRED"]);
export const reservationStatus = pgEnum("reservation_status", [
  "PENDING",
  "CONFIRMED",
  "PICKED_UP",
  "RETURNED",
  "CANCELLED",
  "EXPIRED",
  "REFUNDED",
]);
export const paymentStatus = pgEnum("payment_status", [
  "PENDING",
  "SUCCEEDED",
  "FAILED",
  "CANCELED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
]);
export const depositStatus = pgEnum("deposit_status", ["PENDING", "HELD", "FAILED", "RELEASED", "CAPTURED"]);
export const transmission = pgEnum("transmission", ["AUTOMATIC", "MANUAL"]);
export const fuelType = pgEnum("fuel_type", ["PETROL", "DIESEL", "HYBRID", "ELECTRIC"]);
export const extraChargeType = pgEnum("extra_charge_type", ["PER_DAY", "PER_RENTAL"]);
export const pricingRuleKind = pgEnum("pricing_rule_kind", ["DAILY_RATE", "ONE_WAY_FEE", "VAT", "DEPOSIT", "LATE_RETURN"]);
export const damageSeverity = pgEnum("damage_severity", ["MINOR", "MODERATE", "MAJOR"]);
export const damageStatus = pgEnum("damage_status", ["OPEN", "CHARGED", "RESOLVED"]);

export const RESERVATION_STATUSES = reservationStatus.enumValues;
export const VEHICLE_STATUSES = vehicleStatus.enumValues;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];
export type UserRole = (typeof userRole.enumValues)[number];

// ---------------------------------------------------------------------------
// better-auth tables (user table is `users`). App sets advanced.database.generateId = "uuid".
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: userRole("role").notNull().default("customer"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: ts("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: ts("access_token_expires_at"),
    refreshTokenExpiresAt: ts("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("accounts_user_id_idx").on(t.userId)],
);

export const verifications = pgTable(
  "verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: ts("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

/** Pass to drizzleAdapter(db, { provider: "pg", schema: authSchema }). */
export const authSchema = { user: users, session: sessions, account: accounts, verification: verifications };

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export const driverProfiles = pgTable(
  "driver_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    phone: text("phone").notNull(),
    dateOfBirth: date("date_of_birth", { mode: "string" }).notNull(),
    nationality: text("nationality").notNull(),
    licenceNumber: text("licence_number").notNull(),
    licenceCountry: text("licence_country").notNull(),
    licenceExpiry: date("licence_expiry", { mode: "string" }).notNull(),
    /** Private storage key (never a public URL). */
    licenceFileKey: text("licence_file_key"),
    licenceContentType: text("licence_content_type"),
    licenceUploadedAt: ts("licence_uploaded_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("driver_profiles_licence_after_birth", sql`${t.licenceExpiry} > ${t.dateOfBirth}`),
    check("driver_profiles_phone_len", sql`length(${t.phone}) between 5 and 32`),
  ],
);

// ---------------------------------------------------------------------------
// Branches & fleet
// ---------------------------------------------------------------------------

export const branches = pgTable(
  "branches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    city: text("city").notNull(),
    address: text("address").notNull(),
    phone: text("phone"),
    /** IANA time zone, e.g. Asia/Dubai. Display times in this zone. */
    timezone: text("timezone").notNull().default("Asia/Dubai"),
    /** Free-form opening hours shown to customers, e.g. "Daily 08:00–22:00". */
    openingHours: text("opening_hours"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("branches_code_format", sql`${t.code} ~ '^[A-Z0-9]{2,10}$'`),
    check("branches_timezone_nonempty", sql`length(${t.timezone}) > 0`),
  ],
);

export const vehicleCategories = pgTable(
  "vehicle_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("vehicle_categories_code_format", sql`${t.code} ~ '^[A-Z0-9_]{2,20}$'`)],
);

export const vehicles = pgTable(
  "vehicles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Branch the vehicle is currently based at (pick-up location). */
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => vehicleCategories.id, { onDelete: "restrict" }),
    make: text("make").notNull(),
    model: text("model").notNull(),
    year: integer("year").notNull(),
    plate: text("plate").notNull().unique(),
    vin: text("vin").notNull().unique(),
    transmission: transmission("transmission").notNull(),
    fuelType: fuelType("fuel_type").notNull(),
    seats: integer("seats").notNull(),
    doors: integer("doors").notNull().default(4),
    luggage: integer("luggage").notNull().default(2),
    color: text("color"),
    mileageKm: integer("mileage_km").notNull().default(0),
    fuelLevel: integer("fuel_level").notNull().default(100),
    status: vehicleStatus("status").notNull().default("AVAILABLE"),
    /** Public marketing photo (not private data). */
    imageUrl: text("image_url"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("vehicles_branch_id_idx").on(t.branchId),
    index("vehicles_category_id_idx").on(t.categoryId),
    index("vehicles_status_idx").on(t.status),
    check("vehicles_year_range", sql`${t.year} between 1990 and 2100`),
    check("vehicles_seats_range", sql`${t.seats} between 1 and 15`),
    check("vehicles_doors_range", sql`${t.doors} between 2 and 6`),
    check("vehicles_luggage_range", sql`${t.luggage} between 0 and 10`),
    check("vehicles_mileage_nonneg", sql`${t.mileageKm} >= 0`),
    check("vehicles_fuel_range", sql`${t.fuelLevel} between 0 and 100`),
    check("vehicles_vin_format", sql`${t.vin} ~ '^[A-HJ-NPR-Z0-9]{17}$'`),
  ],
);

export const vehicleFeatures = pgTable("vehicle_features", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const vehicleFeatureMap = pgTable(
  "vehicle_feature_map",
  {
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    featureId: uuid("feature_id")
      .notNull()
      .references(() => vehicleFeatures.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.vehicleId, t.featureId] }), index("vehicle_feature_map_feature_id_idx").on(t.featureId)],
);

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

/**
 * One table for all price inputs, discriminated by `kind`:
 * - DAILY_RATE  category_id, min_days, amount_fils (per day). The rule with the highest
 *               min_days ≤ rental days wins (tiered weekly/monthly rates).
 * - ONE_WAY_FEE from_branch_id/to_branch_id (null = any), amount_fils.
 * - VAT         rate_bps (500 = 5%).
 * - DEPOSIT     category_id (null = default), amount_fils.
 * - LATE_RETURN category_id (null = default), amount_fils per started hour, grace_minutes.
 * valid_from/valid_to (optional) restrict a rule to pick-ups in [from, to).
 */
export const pricingRules = pgTable(
  "pricing_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: pricingRuleKind("kind").notNull(),
    name: text("name").notNull(),
    categoryId: uuid("category_id").references(() => vehicleCategories.id, { onDelete: "cascade" }),
    fromBranchId: uuid("from_branch_id").references(() => branches.id, { onDelete: "cascade" }),
    toBranchId: uuid("to_branch_id").references(() => branches.id, { onDelete: "cascade" }),
    minDays: integer("min_days").notNull().default(1),
    amountFils: integer("amount_fils"),
    rateBps: integer("rate_bps"),
    graceMinutes: integer("grace_minutes").notNull().default(0),
    priority: integer("priority").notNull().default(0),
    validFrom: ts("valid_from"),
    validTo: ts("valid_to"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("pricing_rules_kind_idx").on(t.kind, t.isActive),
    index("pricing_rules_category_id_idx").on(t.categoryId),
    index("pricing_rules_from_branch_id_idx").on(t.fromBranchId),
    index("pricing_rules_to_branch_id_idx").on(t.toBranchId),
    check("pricing_rules_amount_nonneg", sql`${t.amountFils} is null or ${t.amountFils} >= 0`),
    check("pricing_rules_rate_range", sql`${t.rateBps} is null or ${t.rateBps} between 0 and 10000`),
    check("pricing_rules_min_days", sql`${t.minDays} >= 1`),
    check("pricing_rules_grace_nonneg", sql`${t.graceMinutes} >= 0`),
    check("pricing_rules_valid_range", sql`${t.validFrom} is null or ${t.validTo} is null or ${t.validTo} > ${t.validFrom}`),
    check(
      "pricing_rules_kind_fields",
      sql`case ${t.kind}
        when 'DAILY_RATE' then ${t.categoryId} is not null and ${t.amountFils} is not null
        when 'VAT' then ${t.rateBps} is not null
        else ${t.amountFils} is not null end`,
    ),
  ],
);

export const extras = pgTable(
  "extras",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    chargeType: extraChargeType("charge_type").notNull(),
    priceFils: integer("price_fils").notNull(),
    maxQuantity: integer("max_quantity").notNull().default(1),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("extras_price_nonneg", sql`${t.priceFils} >= 0`),
    check("extras_max_quantity", sql`${t.maxQuantity} between 1 and 10`),
  ],
);

// ---------------------------------------------------------------------------
// Reservations
// ---------------------------------------------------------------------------

export const reservations = pgTable(
  "reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Human-friendly voucher reference, e.g. DE-7KQ2M9XA. */
    reference: text("reference").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "restrict" }),
    pickupBranchId: uuid("pickup_branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    returnBranchId: uuid("return_branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    pickupAt: ts("pickup_at").notNull(),
    returnAt: ts("return_at").notNull(),
    /** Generated: tstzrange(pickup_at, return_at, '[)'). */
    period: tstzrange("period")
      .notNull()
      .generatedAlwaysAs(sql`tstzrange(pickup_at, return_at, '[)')`),
    status: reservationStatus("status").notNull().default("PENDING"),
    holdExpiresAt: ts("hold_expires_at"),
    idempotencyKey: text("idempotency_key").notNull(),
    // Price snapshot from the server-side quote (fils).
    currency: text("currency").notNull().default("AED"),
    rentalDays: integer("rental_days").notNull(),
    dailyRateFils: integer("daily_rate_fils").notNull(),
    baseFils: integer("base_fils").notNull(),
    extrasFils: integer("extras_fils").notNull(),
    oneWayFeeFils: integer("one_way_fee_fils").notNull(),
    subtotalFils: integer("subtotal_fils").notNull(),
    vatRateBps: integer("vat_rate_bps").notNull(),
    vatFils: integer("vat_fils").notNull(),
    totalFils: integer("total_fils").notNull(),
    depositFils: integer("deposit_fils").notNull(),
    quote: jsonb("quote").notNull(),
    confirmedAt: ts("confirmed_at"),
    cancelledAt: ts("cancelled_at"),
    cancellationReason: text("cancellation_reason"),
    expiredAt: ts("expired_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("reservations_user_idempotency_key").on(t.userId, t.idempotencyKey),
    index("reservations_user_id_idx").on(t.userId),
    index("reservations_vehicle_id_idx").on(t.vehicleId),
    index("reservations_pickup_branch_id_idx").on(t.pickupBranchId),
    index("reservations_return_branch_id_idx").on(t.returnBranchId),
    index("reservations_status_idx").on(t.status),
    index("reservations_pending_hold_idx")
      .on(t.holdExpiresAt)
      .where(sql`status = 'PENDING'`),
    index("reservations_pickup_at_idx").on(t.pickupAt),
    check("reservations_period_valid", sql`${t.returnAt} > ${t.pickupAt}`),
    check("reservations_pending_has_hold", sql`${t.status} <> 'PENDING' or ${t.holdExpiresAt} is not null`),
    check(
      "reservations_money_nonneg",
      sql`${t.dailyRateFils} >= 0 and ${t.baseFils} >= 0 and ${t.extrasFils} >= 0 and ${t.oneWayFeeFils} >= 0
        and ${t.subtotalFils} >= 0 and ${t.vatFils} >= 0 and ${t.totalFils} >= 0 and ${t.depositFils} >= 0`,
    ),
    check("reservations_total_sum", sql`${t.totalFils} = ${t.subtotalFils} + ${t.vatFils}`),
    check("reservations_days_pos", sql`${t.rentalDays} >= 1`),
    check("reservations_vat_range", sql`${t.vatRateBps} between 0 and 10000`),
  ],
);

export const reservationExtras = pgTable(
  "reservation_extras",
  {
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "cascade" }),
    extraId: uuid("extra_id")
      .notNull()
      .references(() => extras.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    unitPriceFils: integer("unit_price_fils").notNull(),
    chargeType: extraChargeType("charge_type").notNull(),
    totalFils: integer("total_fils").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.reservationId, t.extraId] }),
    index("reservation_extras_extra_id_idx").on(t.extraId),
    check("reservation_extras_quantity", sql`${t.quantity} >= 1`),
    check("reservation_extras_money", sql`${t.unitPriceFils} >= 0 and ${t.totalFils} >= 0`),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "restrict" }),
    provider: text("provider").notNull(),
    providerPaymentId: text("provider_payment_id").unique(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    /** RENTAL = booking charge; ADJUSTMENT = extra charge on date change. */
    purpose: text("purpose").notNull().default("RENTAL"),
    amountFils: integer("amount_fils").notNull(),
    amountRefundedFils: integer("amount_refunded_fils").notNull().default(0),
    currency: text("currency").notNull().default("AED"),
    status: paymentStatus("status").notNull().default("PENDING"),
    failureReason: text("failure_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("payments_reservation_id_idx").on(t.reservationId),
    check("payments_amount_pos", sql`${t.amountFils} > 0`),
    check("payments_refund_range", sql`${t.amountRefundedFils} between 0 and ${t.amountFils}`),
    check("payments_purpose", sql`${t.purpose} in ('RENTAL', 'ADJUSTMENT')`),
  ],
);

export const deposits = pgTable(
  "deposits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "restrict" }),
    provider: text("provider").notNull(),
    providerHoldId: text("provider_hold_id").unique(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    amountFils: integer("amount_fils").notNull(),
    amountCapturedFils: integer("amount_captured_fils").notNull().default(0),
    currency: text("currency").notNull().default("AED"),
    status: depositStatus("status").notNull().default("PENDING"),
    failureReason: text("failure_reason"),
    releasedAt: ts("released_at"),
    capturedAt: ts("captured_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("deposits_reservation_id_idx").on(t.reservationId),
    index("deposits_status_idx").on(t.status),
    check("deposits_amount_nonneg", sql`${t.amountFils} >= 0`),
    check("deposits_capture_range", sql`${t.amountCapturedFils} between 0 and ${t.amountFils}`),
  ],
);

/** Webhook event ids already processed; the unique key makes duplicate deliveries no-ops. */
export const processedWebhookEvents = pgTable(
  "processed_webhook_events",
  {
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    processedAt: ts("processed_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.eventId] })],
);

export const rentalAgreements = pgTable(
  "rental_agreements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reservationId: uuid("reservation_id")
      .notNull()
      .unique()
      .references(() => reservations.id, { onDelete: "restrict" }),
    pickedUpAt: ts("picked_up_at").notNull(),
    pickupMileageKm: integer("pickup_mileage_km").notNull(),
    pickupFuelLevel: integer("pickup_fuel_level").notNull(),
    pickupStaffId: uuid("pickup_staff_id").references(() => users.id, { onDelete: "set null" }),
    pickupNotes: text("pickup_notes"),
    returnedAt: ts("returned_at"),
    returnBranchId: uuid("return_branch_id").references(() => branches.id, { onDelete: "restrict" }),
    returnMileageKm: integer("return_mileage_km"),
    returnFuelLevel: integer("return_fuel_level"),
    returnStaffId: uuid("return_staff_id").references(() => users.id, { onDelete: "set null" }),
    returnNotes: text("return_notes"),
    lateMinutes: integer("late_minutes").notNull().default(0),
    lateFeeFils: integer("late_fee_fils").notNull().default(0),
    damageChargeFils: integer("damage_charge_fils").notNull().default(0),
    depositCapturedFils: integer("deposit_captured_fils").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("rental_agreements_pickup_staff_id_idx").on(t.pickupStaffId),
    index("rental_agreements_return_staff_id_idx").on(t.returnStaffId),
    index("rental_agreements_return_branch_id_idx").on(t.returnBranchId),
    check("rental_agreements_pickup_fuel", sql`${t.pickupFuelLevel} between 0 and 100`),
    check("rental_agreements_return_fuel", sql`${t.returnFuelLevel} is null or ${t.returnFuelLevel} between 0 and 100`),
    check("rental_agreements_pickup_mileage", sql`${t.pickupMileageKm} >= 0`),
    check(
      "rental_agreements_return_mileage",
      sql`${t.returnMileageKm} is null or ${t.returnMileageKm} >= ${t.pickupMileageKm}`,
    ),
    check("rental_agreements_return_after_pickup", sql`${t.returnedAt} is null or ${t.returnedAt} >= ${t.pickedUpAt}`),
    check(
      "rental_agreements_money",
      sql`${t.lateMinutes} >= 0 and ${t.lateFeeFils} >= 0 and ${t.damageChargeFils} >= 0 and ${t.depositCapturedFils} >= 0`,
    ),
  ],
);

export const damageReports = pgTable(
  "damage_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "restrict" }),
    reservationId: uuid("reservation_id").references(() => reservations.id, { onDelete: "set null" }),
    reportedById: uuid("reported_by_id").references(() => users.id, { onDelete: "set null" }),
    severity: damageSeverity("severity").notNull(),
    status: damageStatus("status").notNull().default("OPEN"),
    description: text("description").notNull(),
    /** Private storage keys for photos. */
    photoKeys: text("photo_keys").array().notNull().default(sql`'{}'::text[]`),
    repairCostFils: integer("repair_cost_fils"),
    chargedFils: integer("charged_fils").notNull().default(0),
    resolvedAt: ts("resolved_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("damage_reports_vehicle_id_idx").on(t.vehicleId),
    index("damage_reports_reservation_id_idx").on(t.reservationId),
    index("damage_reports_reported_by_id_idx").on(t.reportedById),
    check("damage_reports_money", sql`(${t.repairCostFils} is null or ${t.repairCostFils} >= 0) and ${t.chargedFils} >= 0`),
  ],
);

export const maintenanceBlocks = pgTable(
  "maintenance_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at").notNull(),
    /** Generated: tstzrange(starts_at, ends_at, '[)'). */
    period: tstzrange("period")
      .notNull()
      .generatedAlwaysAs(sql`tstzrange(starts_at, ends_at, '[)')`),
    reason: text("reason").notNull(),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    cancelledAt: ts("cancelled_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("maintenance_blocks_vehicle_id_idx").on(t.vehicleId),
    index("maintenance_blocks_created_by_id_idx").on(t.createdById),
    check("maintenance_blocks_period_valid", sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

/**
 * Occupancy table. One row per ACTIVE reservation (PENDING/CONFIRMED/PICKED_UP) or
 * active maintenance block. Maintained ONLY by database triggers — never write
 * to it from application code. Carries the single exclusion constraint
 * `vehicle_bookings_no_overlap` (added in the custom migration).
 * `hold_expires_at` mirrors PENDING holds so availability can ignore stale holds.
 */
export const vehicleBookings = pgTable(
  "vehicle_bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    period: tstzrange("period").notNull(),
    reservationId: uuid("reservation_id")
      .unique()
      .references(() => reservations.id, { onDelete: "cascade" }),
    maintenanceBlockId: uuid("maintenance_block_id")
      .unique()
      .references(() => maintenanceBlocks.id, { onDelete: "cascade" }),
    holdExpiresAt: ts("hold_expires_at"),
  },
  (t) => [
    index("vehicle_bookings_vehicle_id_idx").on(t.vehicleId),
    check("vehicle_bookings_one_source", sql`num_nonnulls(${t.reservationId}, ${t.maintenanceBlockId}) = 1`),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    data: jsonb("data").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_logs_actor_id_idx").on(t.actorId),
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
    index("audit_logs_created_at_idx").on(t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Relations (for db.query.* helpers)
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ one, many }) => ({
  driverProfile: one(driverProfiles, { fields: [users.id], references: [driverProfiles.userId] }),
  reservations: many(reservations),
}));
export const driverProfilesRelations = relations(driverProfiles, ({ one }) => ({
  user: one(users, { fields: [driverProfiles.userId], references: [users.id] }),
}));
export const branchesRelations = relations(branches, ({ many }) => ({ vehicles: many(vehicles) }));
export const vehicleCategoriesRelations = relations(vehicleCategories, ({ many }) => ({ vehicles: many(vehicles) }));
export const vehiclesRelations = relations(vehicles, ({ one, many }) => ({
  branch: one(branches, { fields: [vehicles.branchId], references: [branches.id] }),
  category: one(vehicleCategories, { fields: [vehicles.categoryId], references: [vehicleCategories.id] }),
  features: many(vehicleFeatureMap),
  reservations: many(reservations),
  maintenanceBlocks: many(maintenanceBlocks),
}));
export const vehicleFeatureMapRelations = relations(vehicleFeatureMap, ({ one }) => ({
  vehicle: one(vehicles, { fields: [vehicleFeatureMap.vehicleId], references: [vehicles.id] }),
  feature: one(vehicleFeatures, { fields: [vehicleFeatureMap.featureId], references: [vehicleFeatures.id] }),
}));
export const reservationsRelations = relations(reservations, ({ one, many }) => ({
  user: one(users, { fields: [reservations.userId], references: [users.id] }),
  vehicle: one(vehicles, { fields: [reservations.vehicleId], references: [vehicles.id] }),
  pickupBranch: one(branches, { fields: [reservations.pickupBranchId], references: [branches.id], relationName: "pickup" }),
  returnBranch: one(branches, { fields: [reservations.returnBranchId], references: [branches.id], relationName: "return" }),
  extras: many(reservationExtras),
  payments: many(payments),
  deposits: many(deposits),
  agreement: one(rentalAgreements, { fields: [reservations.id], references: [rentalAgreements.reservationId] }),
  damageReports: many(damageReports),
}));
export const reservationExtrasRelations = relations(reservationExtras, ({ one }) => ({
  reservation: one(reservations, { fields: [reservationExtras.reservationId], references: [reservations.id] }),
  extra: one(extras, { fields: [reservationExtras.extraId], references: [extras.id] }),
}));
export const paymentsRelations = relations(payments, ({ one }) => ({
  reservation: one(reservations, { fields: [payments.reservationId], references: [reservations.id] }),
}));
export const depositsRelations = relations(deposits, ({ one }) => ({
  reservation: one(reservations, { fields: [deposits.reservationId], references: [reservations.id] }),
}));
export const rentalAgreementsRelations = relations(rentalAgreements, ({ one }) => ({
  reservation: one(reservations, { fields: [rentalAgreements.reservationId], references: [reservations.id] }),
}));
export const damageReportsRelations = relations(damageReports, ({ one }) => ({
  vehicle: one(vehicles, { fields: [damageReports.vehicleId], references: [vehicles.id] }),
  reservation: one(reservations, { fields: [damageReports.reservationId], references: [reservations.id] }),
}));
export const maintenanceBlocksRelations = relations(maintenanceBlocks, ({ one }) => ({
  vehicle: one(vehicles, { fields: [maintenanceBlocks.vehicleId], references: [vehicles.id] }),
}));
