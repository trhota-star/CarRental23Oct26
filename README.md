# DriveEasy — Car Rental Web Application

DriveEasy is a local-first car rental web application built for the UAE market (Dubai, Abu Dhabi, Sharjah) using Next.js 16 (App Router), React 19, TypeScript, PostgreSQL (with `btree_gist` exclusion constraints), Drizzle ORM, better-auth, and Tailwind CSS.

---

## Features

- **Fleet Search & Availability**: Real-time lookup with pickup/return branch selection, dynamic calendar, date-time range checks, and multi-faceted filtering (transmission, fuel type, seats, price).
- **Zero-Overlap Bookings**: Backed by a PostgreSQL `EXCLUDE USING gist (vehicle_id WITH =, period WITH &&)` constraint over reservations and maintenance blocks.
- **Accurate Pricing Engine**: Dynamic daily rates, duration discounts, extras (GPS, child seats, roof racks), one-way fees, 5% UAE VAT, security deposit holds, and late return penalties (all stored in integer **fils**).
- **Hold & Release Lifecycle**: 15-minute idempotent reservation holds with background job sweeper (`release-expired-holds`) using `FOR UPDATE SKIP LOCKED`.
- **Payment & Security Deposits**: Pluggable provider architecture (`FakePaymentProvider` for local dev/testing; `StripePaymentProvider` with PaymentIntents and manual authorization capture for production).
- **Pick-up Voucher**: Printable and mobile-friendly vouchers with staff-scannable QR codes.
- **Admin Management Console**: Dedicated portal for fleet status, branches, pricing rules, rental agreements (check-out / check-in with odometer and fuel tracking), and damage reporting.
- **Private Document Storage**: Secure storage adapter for driving licences and damage photos with role-based access control.

---

## Local Setup

### 1. Prerequisites
- Node.js 20+
- pnpm 9+
- PostgreSQL 16+ running locally on port **5433** with the `btree_gist` extension enabled

### 2. Environment Configuration
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```

Key environment variables:
- `DATABASE_URL`: `postgresql://driveeasy:driveeasy@localhost:5433/driveeasy_dev`
- `TEST_DATABASE_URL`: `postgresql://driveeasy:driveeasy@localhost:5433/driveeasy_test`
- `BETTER_AUTH_SECRET`: Random 32+ char secret string
- `BETTER_AUTH_URL`: `http://localhost:3200`
- `PAYMENT_PROVIDER`: `fake` (or `stripe` in production)
- `STORAGE_PROVIDER`: `local` (or `vercel-blob` in production)

### 3. Database Migration & Seed
Run migrations and load sample data (branches, vehicles, pricing rules, demo accounts):
```bash
pnpm db:migrate
pnpm db:seed
```

### 4. Run the Development Server
```bash
pnpm dev
```
Open **[http://localhost:3200](http://localhost:3200)** in your browser.

---

## Demo Credentials

| Role | Email | Password |
|---|---|---|
| **Admin** | `admin@driveeasy.local` | `DriveEasyAdmin!2026` |
| **Customer** | `customer@driveeasy.local` | `DriveEasyDemo!2026` |
| **Customer** | `omar@driveeasy.local` | `DriveEasyDemo!2026` |

---

## Testing

DriveEasy includes a complete test harness spanning unit, integration, and E2E suites:

- **All Vitest tests** (149 tests across 19 suites):
  ```bash
  pnpm test
  ```
- **Unit tests only**:
  ```bash
  pnpm test:unit
  ```
- **Integration tests against test database**:
  ```bash
  pnpm test:integration
  ```
- **Concurrency & Overlap Verification**:
  Runs 25+ simultaneous overlapping booking attempts across isolated connections to verify that exactly one reservation wins.
- **Playwright E2E**:
  ```bash
  pnpm test:e2e
  ```

---

## Background Tasks

- **Release Expired Holds**:
  ```bash
  pnpm jobs:release-expired-holds
  ```
  Also exposed via secure cron HTTP endpoint: `POST /api/cron/release-expired-holds` with `Authorization: Bearer $CRON_SECRET`.

---

## Deployment to Vercel (Phase B)

1. Provision a Neon PostgreSQL database and copy the connection string.
2. Configure environment variables in the Vercel project settings:
   - `DATABASE_URL` (pooled connection for Next.js)
   - `DIRECT_URL` (direct connection for migrations)
   - `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`
   - `PAYMENT_PROVIDER=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
   - `STORAGE_PROVIDER=vercel-blob`, `BLOB_READ_WRITE_TOKEN`
   - `CRON_SECRET`
3. Configure `vercel.json` cron to invoke `/api/cron/release-expired-holds` every 5 minutes.
4. Deploy using standard Next.js build:
   ```bash
   pnpm build
   ```

