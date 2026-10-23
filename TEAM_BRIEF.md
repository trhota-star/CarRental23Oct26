# DriveEasy — Team Brief

Instructions for the DriveEasy agent team (lead + App, Database Engine, QA).
Read this first, then `AGENTS.md`, then the code in `src/server/`.

## Goal

A production-ready car rental web app for Vercel, built **local-first**:

- **Phase A (this run):** build everything and pass every test against local
  services. Write the cloud adapters as well, but don't connect them.
- **Phase B (blocked):** provision Neon, Blob and Stripe, then deploy to
  Vercel. **Do not create or log in to any cloud account.** The owner will
  supply links and keys later. Until then the project is **not complete**.

## What already exists (don't redo)

| Area | State |
|---|---|
| Next.js 16.4 + React 19.3, TS, App Router, Tailwind 4, ESLint | scaffolded, `src/` layout |
| PostgreSQL 18.6 local, **port 5433**, user `driveeasy` | `driveeasy_dev`, `driveeasy_test`, both with `btree_gist` |
| Drizzle ORM 0.45 + drizzle-kit 0.31 + `pg` | `drizzle.config.ts`, `src/server/db/` (schema empty) |
| Zod 4, better-auth 1.7, qrcode | installed, not configured |
| Vitest 5, Playwright 1.64 (Chromium/Firefox/WebKit) | configs + smoke tests pass |
| Payments interface + fake provider | `src/server/payments/` — charge, cancel, refund, deposit hold/release/capture, signed + duplicate webhooks |
| Private file storage interface + local store | `src/server/storage/` — `storage/uploads/`, never under `public/` |
| Job runner + `release-expired-holds` | `src/server/jobs/` — `HoldStore` is a stub until bookings exist |
| Settings | `.env.local` (real local values), `.env.example` (all vars) |

Commands: `pnpm dev | test | test:e2e | typecheck | lint | db:check | db:generate | db:migrate | job <name> | fake-payments`.

Read `node_modules/next/dist/docs/` before writing Next.js code; this version differs from older training data.

## Hard rules (everyone)

1. Run locally only. No cloud sign-ups, no deploys, no secrets in browser code.
   Server-only modules import `server-only`.
2. Every cloud service sits behind its interface and is picked by a setting:
   `PAYMENT_PROVIDER=fake|stripe`, `STORAGE_PROVIDER=local|vercel-blob`,
   `SCHEDULER_PROVIDER=local|vercel-cron`. App code never imports a concrete provider.
3. Money is integer **fils** (AED minor units). Never use floats. Timestamps are
   UTC `timestamptz`; display them in the branch's IANA time zone.
4. No permanent mock data and no placeholder buttons. Every screen reads from and
   writes to the real database. Demo content comes only from the seed script.
5. Input is validated with Zod at every server boundary. Authorisation is checked
   on the server for every query (owner or admin).
6. Structured JSON server logs (`src/server/log.ts`). Every page needs loading,
   empty and error states.
7. Small commits with clear messages. Before handing off, run `pnpm typecheck && pnpm lint && pnpm test`.

## File ownership (avoids edit conflicts)

| Agent | Owns | Must ask the owner before touching |
|---|---|---|
| **Database Engine** | `src/server/db/**`, `drizzle/**`, `src/server/reservations/**` (transaction, pricing, holds), `src/server/payments/**`, `src/server/storage/**`, `src/server/jobs/**`, `scripts/seed.ts`, `src/app/api/**` (webhooks, cron) | — |
| **App** | `src/app/**` except `src/app/api/**`, `src/components/**`, `src/server/auth/**`, Server Actions for UI | db schema, pricing logic |
| **QA** | `tests/**`, `playwright.config.ts`, `vitest.config.mts`, `docs/qa-report.md` | everything else (report bugs; don't fix) |
| **Lead** | `README.md`, `vercel.json`, `.env.example`, this file | — |

The Database Engine agent publishes **typed server functions** (e.g.
`searchAvailability`, `createReservationHold`, `quotePrice`,
`confirmReservation`, `cancelReservation`). The App agent calls those functions
and does not write raw SQL for business rules.

## Agent 1: App

Pages: home, search results, vehicle details (with availability calendar),
branches, date/time selection, extras, checkout, pick-up voucher (reference + QR),
my rentals (view, modify dates, cancel per policy), profile (driver details +
licence upload), login/register, and admin (branches, fleet, pricing,
reservations, check-out, check-in, damage reports).

- Search filters: pick-up branch, return branch, dates and times, category,
  transmission, seats, fuel type, price.
- Before payment, the price breakdown shows: daily rate × days, extras, one-way
  fee, VAT, security deposit and total. All of it comes from `quotePrice` on the
  server; the client never calculates prices.
- Collect driver details and a licence upload before confirming.
- Auth: better-auth email + password with the Drizzle adapter. Roles are
  `customer` and `admin`. Admin routes are guarded on the server.
- Responsive and accessible. Design for mobile first, and check desktop as well.

## Agent 2: Database Engine

**Tables (Drizzle migrations):** users, driver_profiles, branches,
vehicle_categories, vehicles, vehicle_features, vehicle_feature_map,
pricing_rules, extras, reservations, reservation_extras, payments, deposits,
rental_agreements, damage_reports, maintenance_blocks, audit_logs. better-auth
also needs session/account/verification tables, and its user table must be
`users`.

**Rules**
- UUID primary keys. Foreign keys with deliberate cascade rules. CHECK
  constraints (e.g. amounts ≥ 0, fuel 0–100, valid ranges) and indexes on all
  lookup and foreign-key columns.
- Unique: vehicle plate, VIN, branch code.
- `reservations.period` and `maintenance_blocks.period` are `tstzrange`, `[)`
  half-open, so back-to-back bookings don't overlap.
- Exclusion constraint: `EXCLUDE USING gist (vehicle_id WITH =, period WITH &&)`
  where the status is active (PENDING with an unexpired hold, CONFIRMED,
  PICKED_UP). Maintenance must also block reservations. Use one shared
  `vehicle_bookings` occupancy table, or a trigger, so a **single** constraint
  covers both. Document which approach you chose.
- Enums: vehicle `AVAILABLE|RESERVED|ON_RENT|MAINTENANCE|RETIRED`; reservation
  `PENDING|CONFIRMED|PICKED_UP|RETURNED|CANCELLED|EXPIRED|REFUNDED`. Payment and
  deposit statuses are separate enums.
- `rental_agreements` records mileage and fuel level at pick-up and return.

**Reservation transaction:** BEGIN → `SELECT … FOR UPDATE` on the vehicle → check
for overlap with reservations and maintenance → server-side price quote → insert
PENDING with `hold_expires_at` → COMMIT. Confirm only after a verified payment
**and** an authorised deposit (via webhook or verified provider response). A
unique idempotency key on reservation and payment creation means retries can
never create duplicates. A unique processed-webhook-event-id table makes
duplicate webhooks no-ops. If the exclusion constraint fires, map it to a clean
"no longer available" error.

**Expired holds:** `POST /api/cron/release-expired-holds`. It requires
`Authorization: Bearer $CRON_SECRET`, is idempotent and safe to run in parallel
(`FOR UPDATE SKIP LOCKED`), sets the reservation to EXPIRED, and releases the
deposit. Replace the stub `HoldStore` in `src/server/jobs/index.ts`.
`pnpm job release-expired-holds` must keep working locally.

**Cloud adapters (written, not connected):** `StripePaymentProvider` (PaymentIntents;
deposits use `capture_method: manual`, released by cancel), `VercelBlobStorage`
(licences are never given a public URL and are served only through an authorised
route handler), and `vercel.json` cron entry. These are configured by settings
alone. Unit-test them with mocked SDK clients only; make no network calls.

**Seed:** `pnpm db:seed` loads sample branches (e.g. Dubai, Abu Dhabi, Sharjah with
time zone `Asia/Dubai`), categories, about 20 vehicles, extras, pricing rules
(including one-way fees and 5% VAT) and future reservations. It must be
idempotent.

## Agent 3: QA

Write automated tests (Vitest against `driveeasy_test`, Playwright for flows)
and record results in `docs/qa-report.md`.

- Auth: register, login, logout; customer vs admin authorisation.
- Search, branch selection, date ranges, every filter, availability calendar.
- Full rental: search → quote → hold → payment → voucher → check-out → check-in.
- **Concurrency:** two sessions reserve the same vehicle for overlapping dates at
  the same moment, and exactly one succeeds. Run it repeatedly, at least 20 times.
- Back-to-back rentals (one ends exactly when the next starts) both succeed.
- Hold expiry and release, including repeated and parallel runs of the cleanup.
- Pricing: daily rates, extras, one-way fee, VAT, late-return charge, deposit.
- Payments with the fake provider: success, failure, cancel, retry (same
  idempotency key), refund, deposit release and capture, and duplicate webhook
  delivery.
- Isolation: a user can't see another user's reservations, vouchers or licence
  files (by URL guessing as well).
- Admin permissions: fleet, pricing, check-in, damage reports.
- Migrations: drop and recreate `driveeasy_test`, apply all migrations from
  zero, then seed.
- `pnpm build && pnpm start` production build. Desktop and mobile viewports.
- Send each bug to the owning agent and **retest after the fix**.

## Definition of done

**Phase A (local), all required:**
- [ ] Migrations apply cleanly to an empty database; seed runs twice without error.
- [ ] Concurrent overlapping-reservation test passes (exactly one winner, every run).
- [ ] Payment and deposit flows pass with the fake provider, including duplicate webhooks.
- [ ] All Vitest and Playwright suites green; `pnpm build` succeeds.
- [ ] README covers local setup, env vars, migrations, testing and Vercel deployment steps.

**Phase B (cloud), blocked on owner credentials:**
- [ ] Neon via Vercel Marketplace (pooled `DATABASE_URL` for the app, direct URL for migrations).
- [ ] Separate Preview and Production envs; secrets only in Vercel env settings.
- [ ] Migrations run safely on deploy; Stripe test keys and webhook secret set; cron protected.
- [ ] Deployed app passes the end-to-end suite.

Only the lead marks the project complete, and only after Phase B.
