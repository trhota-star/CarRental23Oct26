# DriveEasy QA Report

Owner: QA agent. Updated: 2026-10-23 (in progress; the DB and App agents are still building).

## How to run

| Command | What it does |
|---|---|
| `pnpm test` | All Vitest projects (unit + integration) |
| `pnpm test:unit` | Pure unit tests (no DB) |
| `pnpm test:integration` | Drops and recreates `driveeasy_test`, applies all migrations from zero, seeds, then runs DB tests one file at a time |
| `pnpm test:db:reset [--no-seed]` | Just the reset/migrate/seed step |
| `pnpm test:e2e` | Playwright: reset + migrate + seed `driveeasy_test`, then `next build` + `next start` on port 3100 with `DATABASE_URL=TEST_DATABASE_URL`. Projects: desktop-chromium/firefox/webkit, mobile-pixel7, mobile-iphone14 |
| `pnpm test:e2e:desktop`, `pnpm test:e2e:mobile` | Subsets |

Switches: `QA_SKIP_SEED=1` / `QA_SKIP_DB_RESET=1` (Vitest), `E2E_SKIP_SEED=1`, `E2E_SKIP_DB_RESET=1`, `E2E_SERVER=dev` (only if no other `next dev` runs in this folder), `E2E_REUSE_SERVER=1`.

Safety: the reset refuses any database whose name does not end in `_test`. Port 3000 belongs to another project; the user's dev server runs on 3200; E2E uses 3100.

## Status by area

| Area | Test file(s) | Status |
|---|---|---|
| Harness (QA-1) | `tests/setup/reset-test-db.ts`, `vitest.config.mts`, `playwright.config.ts`, `tests/e2e/helpers/auth.ts` | Done |
| Migrations from zero (QA-7) | `tests/integration/migrations.test.ts` | PASS |
| Exclusion constraint: back-to-back, 1-min overlap, maintenance, cancel frees slot, date moves | `tests/integration/overlap-constraint.test.ts` | PASS |
| Concurrency, DB level (2 pools, 25 runs) | `tests/integration/overlap-constraint.test.ts` | PASS (25/25 exactly one winner) |
| Concurrency, `createReservationHold` | pending | Not yet testable (function not landed) |
| Pricing engine (hand-computed fils) | `tests/unit/pricing.test.ts` | PASS |
| `quotePrice` against DB / seed | pending | Not yet testable |
| Availability / search / calendar | pending | Not yet testable |
| Hold expiry, `pnpm job`, cron route | `tests/e2e/api-cron.spec.ts` (HTTP) | Not yet testable (route not built) |
| Payments, deposits, webhooks | `tests/unit/fake-payments.test.ts` (provider only) | Provider PASS; orchestration not yet testable |
| Auth (register/login/logout, role escalation) | `tests/e2e/auth.spec.ts` | see latest run below |
| Authorization / isolation | pending | Not yet testable |
| Full rental E2E | pending | Not yet testable |
| Production build | via `pnpm test:e2e` webServer | see latest run below |

## Latest runs

(filled in below as runs complete)

## Bugs

See `TASKS.md` > Bugs.
