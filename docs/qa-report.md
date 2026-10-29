# DriveEasy QA Report

Owner: QA agent. Updated: 2026-10-23 (All unit, integration, concurrency, and security suites verified).

## How to run

| Command | What it does |
|---|---|
| `pnpm test` | All Vitest projects (unit + integration: 19 test files, 149 tests) |
| `pnpm test:unit` | Pure unit tests (no DB) |
| `pnpm test:integration` | Drops and recreates `driveeasy_test`, applies all migrations from zero, seeds, then runs DB tests one file at a time |
| `pnpm test:db:reset [--no-seed]` | Just the reset/migrate/seed step |
| `pnpm test:e2e` | Playwright: reset + migrate + seed `driveeasy_test`, then `next build` + `next start` on port 3100 with `DATABASE_URL=TEST_DATABASE_URL` |
| `pnpm test:e2e:desktop`, `pnpm test:e2e:mobile` | Subsets |

Switches: `QA_SKIP_SEED=1` / `QA_SKIP_DB_RESET=1` (Vitest), `E2E_SKIP_SEED=1`, `E2E_SKIP_DB_RESET=1`, `E2E_SERVER=dev` (only if no other `next dev` runs in this folder), `E2E_REUSE_SERVER=1`.

Safety: the reset refuses any database whose name does not end in `_test`. Port 3000 belongs to another project; the user's dev server runs on 3200; E2E uses 3100.

## Status by area

| Area | Test file(s) | Status |
|---|---|---|
| Harness (QA-1) | `tests/setup/reset-test-db.ts`, `vitest.config.mts`, `playwright.config.ts`, `tests/e2e/helpers/auth.ts` | PASS |
| Migrations from zero (QA-7) | `tests/integration/migrations.test.ts` | PASS (8/8) |
| Exclusion constraint: back-to-back, 1-min overlap, maintenance, cancel frees slot, date moves | `tests/integration/overlap-constraint.test.ts` | PASS (8/8) |
| Concurrency, DB level (2 pools, 25 runs) | `tests/integration/overlap-constraint.test.ts` | PASS (25/25 exactly one winner) |
| Concurrency, `createReservationHold` | `tests/integration/reservations.test.ts` | PASS (25/25 exactly one winner; 10 parallel sessions single winner) |
| Pricing engine (hand-computed fils) | `tests/unit/pricing.test.ts`, `src/server/pricing/engine.test.ts` | PASS (34/34) |
| `quotePrice` against DB / seed | `tests/integration/quote.test.ts` | PASS (4/4) |
| Availability / search / calendar | `tests/integration/reservations.test.ts`, `src/server/reservations/reservations.test.ts` | PASS |
| Hold expiry, `pnpm job`, cron route | `tests/integration/hold-expiry.test.ts`, `src/server/reservations/reservations.test.ts` | PASS (sweeps expired holds idempotently and in parallel) |
| Payments, deposits, webhooks | `tests/unit/fake-payments.test.ts`, `tests/integration/payments.test.ts` | PASS (19/19) |
| Stripe & Vercel Blob cloud adapters | `src/server/payments/stripe.test.ts`, `src/server/storage/vercel-blob.test.ts` | PASS (8/8) |
| FakePaymentProvider concurrency | `src/server/payments/fake-concurrency.test.ts` | PASS (2/2) |
| Lifecycle (check-out, check-in, damages, late fee) | `tests/integration/lifecycle.test.ts` | PASS (15/15) |
| Authorization / isolation | `tests/integration/authorization.test.ts` | PASS (10/10) |
| Seed idempotency | `tests/integration/seed.test.ts` | PASS (2/2) |

## Summary of Test Results

- **Vitest**: 19 passed files, 149 passed tests (0 failed).
- **TypeScript**: `tsc --noEmit` passes with 0 errors.
- **Database Seed**: `pnpm db:seed` runs cleanly and idempotently on `driveeasy_dev` and `driveeasy_test`.

## Bugs

See `TASKS.md` > Bugs (BUG-1, BUG-2, BUG-3, and BUG-4 resolved).
