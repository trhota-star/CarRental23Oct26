# DriveEasy server API (Database Engine)

Owner: Database Engine agent. This page lists every typed server function the
App and QA agents may call. **App code never writes raw SQL for business rules.**

Status: every function listed here is ✅ implemented and covered by `src/server/**/*.test.ts`.

## Conventions

- **Imports.** App code imports the barrels, which start with `import "server-only"`:
  `@/server/catalog`, `@/server/pricing`, `@/server/reservations`, `@/server/customers`,
  `@/server/admin`. Scripts and Vitest import the inner modules without the marker:
  `@/server/catalog/queries`, `@/server/pricing/quote`, `@/server/pricing/engine`,
  `@/server/reservations/service`, `@/server/customers/service`, `@/server/admin/service`.
- **Actor.** Functions that act for someone take `actor: { userId: string; role: "customer" | "admin" }`
  as their first argument (`Actor` in `@/server/actor`). Build it **on the server** from the
  better-auth session. Functions check owner-or-admin or admin-only access themselves.
- **Validation.** Every input is parsed with Zod. A bad input throws `ValidationError`, and
  `details.fields` maps each field path to a message.
- **Errors** (`@/server/errors`) are `DomainError` subclasses with a stable `code`:
  `VALIDATION`, `NOT_FOUND`, `FORBIDDEN`, `VEHICLE_UNAVAILABLE`, `INVALID_STATE`,
  `IDEMPOTENCY_CONFLICT`, `PRICING`, `PAYMENT_FAILED`, `DRIVER_PROFILE_INCOMPLETE`, `POLICY`.
  Their `message` is safe to show to users. `isDomainError(e)` narrows the type.
- **Money** is integer **fils** (AED × 100). Format it with `formatAed(fils)`. Never do arithmetic on the client.
- **Time.** Pass instants as `Date` or ISO-8601 strings **with an offset** (`2030-01-01T10:00:00+04:00`
  or `…Z`). Convert branch-local form input with `zonedLocalToUtc("2030-01-01T10:00", branch.timezone)`.
  Display with `formatInZone(date, branch.timezone)` / `utcToZonedLocal`. All of these are in `@/server/time`.
- **Test hooks.** Mutating functions accept a last `opts?: { now?: Date; db?: Db }` argument.
  `now` overrides the clock (hold expiry tests). `db` is a Drizzle client: build one with
  `drizzle({ client: new Pool(...), schema })` from `@/server/db` to get independent pools.
  Payment functions also accept `opts.provider` (a `PaymentProvider`).
- **Logging.** `log.info/warn/error(event, fields)` from `@/server/log` writes one JSON line per event.

## Seed (`pnpm db:seed`, `pnpm db:seed:test`) ✅

The seed is idempotent and runs through the real reservation functions. It creates:
- 4 branches in `Asia/Dubai`: DXB (Dubai Airport T3), DXM (Dubai Marina), AUH (Abu Dhabi), SHJ (Sharjah).
- 5 categories (ECONOMY, COMPACT, SUV, LUXURY, VAN), 6 features and 20 vehicles. `image_url` is NULL.
- 6 extras and 31 pricing rules: tiered daily rates at 1, 7 and 30 days; 5% VAT; deposits; late fees; one-way fees.
- 1 maintenance block about 20 days out, on the DXB RAV4.
- 4 confirmed future reservations, paid with the fake provider.
- Driver profiles with a licence file for both customers.

| Role | Email | Password |
|---|---|---|
| admin | admin@driveeasy.local | DriveEasyAdmin!2026 |
| customer | customer@driveeasy.local | DriveEasyDemo!2026 |
| customer | omar@driveeasy.local | DriveEasyDemo!2026 |

Other scripts: `pnpm db:migrate` (dev, via drizzle-kit), `pnpm db:migrate:test` (test, via `scripts/migrate.ts`),
`pnpm job release-expired-holds`.

## Double-booking guard (DB-2): the chosen approach

We use a **shared occupancy table plus triggers**:

- `vehicle_bookings(vehicle_id, period tstzrange, reservation_id?, maintenance_block_id?, hold_expires_at)`.
  Exactly one of the two source ids is set (CHECK `num_nonnulls(...) = 1`).
- It has **one** constraint: `vehicle_bookings_no_overlap EXCLUDE USING gist (vehicle_id WITH =, period WITH &&)`
  (btree_gist). Periods are `[)`, so back-to-back bookings (one ends 10:00, the next starts 10:00) are allowed.
- `reservations.period` and `maintenance_blocks.period` are generated columns:
  `tstzrange(pickup_at, return_at, '[)')` and `tstzrange(starts_at, ends_at, '[)')`.
- The `AFTER INSERT OR UPDATE` triggers `reservations_sync_booking` and `maintenance_blocks_sync_booking`
  upsert the row while a reservation is `PENDING|CONFIRMED|PICKED_UP` (or the block is not cancelled).
  Otherwise they delete it. Deletes cascade through the FKs. A conflict raises **23P01** inside the same
  statement and transaction, and the reservation functions map it to `VehicleUnavailableError`.
- The SQL lives in the hand-written migration `drizzle/0001_vehicle_bookings_exclusion.sql`.
  Drizzle can't express EXCLUDE or triggers. **Never write `vehicle_bookings` from application code.**
- **Expired holds.** A `PENDING` reservation keeps its booking row until it is moved to `EXPIRED`.
  Read paths (`searchAvailability`, `getVehicleCalendar`) ignore rows with `hold_expires_at <= now`.
  `createReservationHold` locks the vehicle (`FOR UPDATE`) and then marks stale overlapping PENDING
  holds on that vehicle `EXPIRED` in the same transaction, before it inserts. An expired hold therefore
  never blocks a new booking, even if the cron has not run yet.
- Maintenance blocks are `maintenance_blocks` rows. Creating one that overlaps an active booking fails
  with `VehicleUnavailableError`.

## Reservation lifecycle

`PENDING` (hold, default 15 min, `RESERVATION_HOLD_MINUTES`)
→ `CONFIRMED` (rental payment succeeded **and** deposit HELD)
→ `PICKED_UP` (check-out) → `RETURNED` (check-in).

Side exits are `EXPIRED` (hold ran out; cron or inline), `CANCELLED` (customer or admin) and
`REFUNDED` (admin full refund after cancellation).

Vehicle status: `AVAILABLE`, `ON_RENT` (between check-out and check-in), `MAINTENANCE` and `RETIRED`
(both hidden from search), and `RESERVED` (not used by the engine; time-ranged bookings are in `vehicle_bookings`).

---

## `@/server/catalog` ✅

```ts
listBranches(opts?: { includeInactive?: boolean }): Promise<Branch[]>
getBranch(id: string): Promise<Branch>                                  // NotFound
listCategories(): Promise<VehicleCategory[]>
listExtras(opts?: { includeInactive?: boolean }): Promise<Extra[]>
listFeatures(): Promise<VehicleFeature[]>
getVehicle(id: string): Promise<VehicleDetails>                          // + branch, category, features
listVehicles(f?: { branchId?; categoryId?; status? }): Promise<VehicleDetails[]>
```

## `@/server/pricing` ✅

```ts
quotePrice(input: {
  vehicleId: string; pickupBranchId: string; returnBranchId: string;
  pickupAt: Date | string; returnAt: Date | string;
  extras?: { extraId: string; quantity: number }[];
}): Promise<Quote>
// Quote = { currency:"AED", rentalDays, dailyRateFils, baseFils, extras: QuoteExtraLine[], extrasFils,
//           oneWayFeeFils, subtotalFils, vatRateBps, vatFils, totalFils, depositFils,
//           lineItems: { kind:"BASE"|"EXTRA"|"ONE_WAY_FEE"|"VAT"; label; amountFils }[], appliedRuleIds }
// Throws PricingError (no rate / one-way not offered / bad extra quantity), ValidationError, NotFound.
formatAed(fils: number): string           // "AED 1,234.50"
computeLateFee({...}): LateFee            // pure; used by check-in
```

Pricing rules:
- **Rental days.** Every started 24 h counts, minimum 1.
- **Daily rate.** The DAILY_RATE rule for the category with the highest `min_days` ≤ days, then the highest priority.
  Rules with `valid_from`/`valid_to` apply only to pick-ups inside `[from, to)`.
- **Extras.** `PER_DAY` = price × quantity × days. `PER_RENTAL` = price × quantity.
- **One-way fee** (only when the return branch differs). Most specific rule wins: exact from/to,
  then from-only, then to-only, then any. If no rule matches, the quote throws `PricingError`.
- **VAT.** `rate_bps` applied to the subtotal (base + extras + one-way), rounded half up.
  `total = subtotal + VAT`. The **deposit** is separate: it is held, not charged.
- **Late return.** Free within `grace_minutes` (seed: 59). After that, every started hour costs the LATE_RETURN
  amount, capped at the daily rate per 24 h block. VAT is added.

## `@/server/reservations`

### Availability ✅
```ts
searchAvailability(input: {
  pickupBranchId; returnBranchId; pickupAt; returnAt;
  categoryId?; transmission?: "AUTOMATIC"|"MANUAL"; fuelType?: "PETROL"|"DIESEL"|"HYBRID"|"ELECTRIC";
  minSeats?: number; minDailyRateFils?: number; maxDailyRateFils?: number;
  sort?: "price_asc"|"price_desc"|"name";
}, opts?: { now?: Date }): Promise<AvailableVehicle[]>   // VehicleDetails & { quote: Quote } (quote w/o extras)
// Vehicles currently based at the pick-up branch, not RETIRED/MAINTENANCE, with no live booking overlapping.

getVehicleCalendar({ vehicleId, from, to }, opts?): Promise<{
  vehicleId; from; to; busy: { start: string; end: string; kind: "RESERVED"|"MAINTENANCE" }[]
}>  // [start,end) clipped to the window, no customer data. Window ≤ 366 days.
```

### Hold ✅
```ts
createReservationHold(actor, {
  vehicleId; pickupBranchId; returnBranchId; pickupAt; returnAt;
  extras?: { extraId; quantity }[];
  idempotencyKey: string;          // 8–200 chars; generate once per booking attempt (e.g. crypto.randomUUID())
}, opts?): Promise<ReservationView>
```
- The same `(user, idempotencyKey)` with the same vehicle, branches and dates returns the original reservation.
  The same key with a different request throws `IdempotencyConflictError`.
- `VehicleUnavailableError` (code `VEHICLE_UNAVAILABLE`): the vehicle is taken, retired or in maintenance.
  This covers the overlap check and SQLSTATE 23P01.
- `ValidationError`: pick-up in the past, the vehicle is not at the pick-up branch, or the rental is over 90 days.

### Payment ✅
```ts
payForReservation(actor, {
  reservationId; paymentMethod: string;    // fake: "pm_fake_success" | "pm_fake_decline" | "pm_fake_cancel" | "pm_fake_pending"
  idempotencyKey: string;                  // per attempt; reuse it to retry the same attempt
}, opts?): Promise<{ outcome: PayOutcome; message: string; reservation: ReservationView }>
// PayOutcome = "CONFIRMED" | "ALREADY_CONFIRMED" | "PAYMENT_FAILED" | "PAYMENT_PENDING" | "DEPOSIT_FAILED" | "HOLD_EXPIRED"
```
- Throws `DriverProfileIncompleteError` if there is no profile, no licence file, the licence expires before
  the return date, or the driver is under 21. Throws `InvalidStateError` if the hold has expired or the
  reservation is not PENDING.
- The rental total is charged once. A retry after `DEPOSIT_FAILED` only retries the deposit.
  The deposit idempotency key is `${idempotencyKey}:deposit`.

```ts
confirmReservation(reservationId: string, opts?): Promise<ReservationView>   // system; no-op unless paid + deposit HELD
handlePaymentWebhook(rawBody: string, signature: string | null, opts?): Promise<{ status: "processed"|"duplicate"|"ignored"; eventId; type }>
```

### Reading reservations ✅
```ts
getReservationForUser(actor, reservationId): Promise<ReservationView>           // owner or admin, else NotFound
getReservationByReference(actor, reference): Promise<ReservationView>           // voucher lookup, owner or admin
listReservationsForUser(actor, f?: { statuses?: ReservationStatus[]; limit?; offset? }): Promise<{ items; total }>
```
`ReservationView` = `{ id, reference, status, userId, customer{name,email}, vehicle{…, category}, pickupBranch, returnBranch,
pickupAt, returnAt, holdExpiresAt, pricing{… all fils, quote}, extras[], payments[], paidFils, deposit|null,
agreement|null, confirmedAt, cancelledAt, cancellationReason, createdAt }`.

### Cancel / modify (DB-8) ✅
```ts
previewCancellation(actor, reservationId, opts?): Promise<{ cancellable: boolean; reason?: string; refundFils: number; feeFils: number; policy: string }>
cancelReservation(actor, { reservationId; reason?: string }, opts?): Promise<ReservationView>   // idempotent
refundReservation(admin, reservationId, opts?): Promise<ReservationView>   // CANCELLED → REFUNDED, refunds what is still paid
computeCancellation({...}): CancellationPreview                              // pure policy function
previewModification(actor, { reservationId; pickupAt; returnAt }, opts?): Promise<{ available: boolean; quote: Quote; differenceFils: number }>
modifyReservationDates(actor, { reservationId; pickupAt; returnAt; paymentMethod?: string; idempotencyKey: string }, opts?): Promise<ReservationView>
```
Policy:
- PENDING: free cancellation. Any payment is voided or refunded, and the deposit is released.
- CONFIRMED, ≥ 48 h before pick-up: full refund.
- CONFIRMED, < 48 h before pick-up: fee of one day's rate plus VAT; the rest is refunded.
- After pick-up time, PICKED_UP or later: customers cannot cancel. Admins can cancel a no-show (no refund).
- Changing dates is allowed for PENDING/CONFIRMED before pick-up. The same vehicle is requoted.
  If the price goes up, the difference is charged (`paymentMethod` is required). If it goes down,
  the difference is refunded. `VehicleUnavailableError` if the new dates clash.

### Check-out / check-in / damage (DB-9) ✅ (admin only)
```ts
checkOutReservation(actor, { reservationId; mileageKm; fuelLevel /*0-100*/; notes? }, opts?): Promise<ReservationView>
checkInReservation(actor, {
  reservationId; mileageKm; fuelLevel; returnBranchId?; notes?;
  damage?: { severity: "MINOR"|"MODERATE"|"MAJOR"; description; chargeFils; repairCostFils?; photoKeys?: string[] };
}, opts?): Promise<ReservationView>   // late fee + damage captured from deposit (capped), rest released
previewCheckIn(actor, { reservationId; returnAt? }, opts?): Promise<{ lateFee: LateFee; depositFils }>
createDamageReport(actor, { vehicleId; reservationId?; severity; description; repairCostFils?; photoKeys? }): Promise<DamageReport>
updateDamageReport(actor, { id; status?: "OPEN"|"CHARGED"|"RESOLVED"; repairCostFils?; chargedFils? }): Promise<DamageReport>
listDamageReports(actor, f?: { vehicleId?; reservationId?; status? }): Promise<DamageReport[]>
```

### Expired holds (DB-10) ✅
```ts
releaseExpiredReservationHolds({ now?, db?, provider?, batchSize? }): Promise<{ expired; depositsReleased; paymentsRefunded; paymentsVoided; failed }>
// 1. PENDING + hold_expires_at <= now → EXPIRED (FOR UPDATE SKIP LOCKED, batches)
// 2. HELD deposits on EXPIRED/CANCELLED/REFUNDED reservations → released (row lock SKIP LOCKED, one tx per row)
// 3. payments on EXPIRED reservations: SUCCEEDED → refunded in full, PENDING → voided
// Idempotent; parallel runs never process the same row.
```
Routes:
- `POST /api/cron/release-expired-holds` and `GET /api/cron/release-expired-holds`. Both need
  `Authorization: Bearer ${CRON_SECRET}`.
- `pnpm job release-expired-holds`.

## `@/server/customers` ✅
```ts
getDriverProfile(actor, userId?): Promise<DriverProfile | null>         // own, or any (admin)
upsertDriverProfile(actor, { fullName; phone; dateOfBirth "YYYY-MM-DD"; nationality; licenceNumber; licenceCountry; licenceExpiry "YYYY-MM-DD" }): Promise<DriverProfile>
saveLicenceFile(actor, { body: Uint8Array; contentType: "image/jpeg"|"image/png"|"image/webp"|"application/pdf" }): Promise<DriverProfile>  // ≤ 5 MB
uploadDamagePhoto(admin, { body; contentType }): Promise<{ key; contentType }>   // pass key in damage photoKeys
getFileOwnership(key: string): Promise<{ ownerUserId: string | null; kind: "licence"|"damage" } | null>
authorizeFileAccess(actor, key: string): Promise<{ contentType: string } | null>   // null → respond 404
```
File keys are private storage keys, such as `licences/<userId>/<uuid>.png` and `damage/<reportId>/<uuid>.jpg`.
They are never public URLs. Stream them with `getFileStorage().get(key)` after `authorizeFileAccess`.

## `@/server/admin` ✅ (admin only; each write is audit-logged)
```ts
listAllReservations(actor, { statuses?; branchId?; vehicleId?; from?; to?; search?; limit?; offset? }): Promise<{ items: ReservationView[]; total }>
createBranch / updateBranch(actor, input): Promise<Branch>
createCategory / updateCategory(actor, input): Promise<VehicleCategory>
createVehicle / updateVehicle(actor, input): Promise<VehicleDetails>   // includes featureIds?
setVehicleStatus(actor, { vehicleId; status }): Promise<VehicleDetails>
createExtra / updateExtra(actor, input): Promise<Extra>
listPricingRules(actor): Promise<PricingRule[]>
createPricingRule / updatePricingRule(actor, input): Promise<PricingRule>
createMaintenanceBlock(actor, { vehicleId; startsAt; endsAt; reason }): Promise<MaintenanceBlock>  // VehicleUnavailable on clash
cancelMaintenanceBlock(actor, id): Promise<MaintenanceBlock>
listMaintenanceBlocks(actor, { vehicleId?; from?; to? }): Promise<MaintenanceBlock[]>
listAuditLogs(actor, { entityType?; entityId?; limit? }): Promise<AuditLog[]>
```

## HTTP routes (owned by DB)
- `POST /api/webhooks/payments`: reads the raw body and verifies it with `getPaymentProvider().verifyWebhook`.
  Responses: 400 for a bad signature, 500 on an internal error (the provider retries; dedup makes that safe),
  and 200 `{status: processed|duplicate|ignored}` otherwise. ✅
- `POST|GET /api/cron/release-expired-holds`: Bearer `CRON_SECRET`. Returns 401 without it and 200 with the
  result JSON. ✅

## Cloud adapters (DB-11): written and unit-tested with mocks, not connected

The adapters are chosen only through settings. App code always calls `getPaymentProvider()` / `getFileStorage()`.

| Setting | Values | Extra env |
|---|---|---|
| `PAYMENT_PROVIDER` | `fake` (default) or `stripe` | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| `STORAGE_PROVIDER` | `local` (default) or `vercel-blob` | `BLOB_READ_WRITE_TOKEN`, optional `BLOB_PREFIX` |

**`StripePaymentProvider`** (`src/server/payments/stripe.ts`)
- Rental charges are PaymentIntents confirmed server-side with `payment_method`.
- Deposits are PaymentIntents with `capture_method: "manual"`. They are released by cancelling the intent
  and captured with `amount_to_capture`, so partial capture works.
- `idempotencyKey` is passed as Stripe's `Idempotency-Key`. Refunds go through `refunds.create`.
- Webhooks are verified with `stripe.webhooks.constructEvent` on the raw body. They map to neutral events:
  - `payment_intent.succeeded` → `payment.succeeded` (deposit: `deposit.captured`)
  - `payment_intent.payment_failed` → `payment.failed` (deposit: `deposit.failed`)
  - `payment_intent.canceled` → `payment.canceled` (deposit: `deposit.released`)
  - `payment_intent.amount_capturable_updated` → `deposit.held`
  - `charge.refunded` → `payment.refunded`
- Other event types throw `PaymentError(IGNORED_WEBHOOK_EVENT)`, and the route answers 200 `{status:"ignored"}`.
- Card payments that need 3-D Secure (`requires_action`) map to `pending`. The App would need a client-side
  confirmation step for those. This is not built yet and belongs to Phase B.

**`VercelBlobStorage`** (`src/server/storage/vercel-blob.ts`)
- Every `put` uses `access: "private"` and `addRandomSuffix: false`. There is no public URL.
- Reads use `get(..., { access: "private" })` and stream only through the authorised file route.

**Vercel Cron** (the lead owns `vercel.json`). Suggested entry:
`{ "crons": [{ "path": "/api/cron/release-expired-holds", "schedule": "*/5 * * * *" }] }`.
Vercel sends `Authorization: Bearer $CRON_SECRET` automatically when `CRON_SECRET` is set.
