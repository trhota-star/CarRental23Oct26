# DriveEasy — Shared Task List

Each agent updates the status of its own tasks here. Status values: `todo`,
`doing`, `done`, `blocked (reason)`. Add new tasks at the bottom of your section.
Bugs go under **Bugs**, tagged with the owning agent.

Team rules for this run (in addition to TEAM_BRIEF.md):
- **Do not run `git commit`/`git add`.** The lead commits at milestones.
- **Do not add dependencies.** Ask the lead (SendMessage to `main`). Already
  installed: server-only, stripe, @vercel/blob, date-fns, @date-fns/tz, lucide-react.
- Edit only files you own (see TEAM_BRIEF.md). For anything else, message the owner.
- Use `driveeasy_test` for automated tests. Only the Database Engine agent resets `driveeasy_dev`.

## Database Engine (DB)
- [x] DB-1 Schema for all 17 tables + better-auth tables, enums, constraints, indexes
- [x] DB-2 Single exclusion constraint covering reservations + maintenance blocks
- [x] DB-3 Migrations generated; apply cleanly to an empty database
- [x] DB-4 Pricing engine `quotePrice` (daily rate rules, extras, one-way fee, VAT, deposit, late-return charge)
- [x] DB-5 Availability: `searchAvailability`, `getVehicleCalendar`
- [x] DB-6 Reservation transaction `createReservationHold` (lock, overlap check, hold, idempotency)
- [ ] (doing) DB-7 Payment + deposit orchestration, `confirmReservation`, webhook route with dedup
- [ ] DB-8 Modify dates / cancel per policy (refunds, deposit release)
- [ ] DB-9 Check-out / check-in (rental agreement, mileage, fuel, late fee, damage reports)
- [ ] DB-10 Cron route + real `HoldStore` (idempotent, SKIP LOCKED)
- [ ] DB-11 Stripe + Vercel Blob adapters (unit-tested with mocks, not connected)
- [x] DB-12 Idempotent seed `pnpm db:seed`
- [ ] (doing) DB-13 Publish the function list in `docs/server-api.md` for App and QA

## App
- [x] APP-1 better-auth setup (email/password, roles), login/register/logout, route guards — done (needs seed to verify admin login)
- [x] APP-2 Layout, navigation, design system, loading/empty/error states — done
- [ ] APP-3 Home + search form, search results with filters — doing (home + branches live; search page wired to searchAvailability)
- [ ] APP-4 Vehicle details + availability calendar, branches page
- [ ] APP-5 Booking flow: dates, extras, price breakdown, driver details, licence upload, checkout
- [ ] APP-6 Pick-up voucher with QR code
- [ ] APP-7 My rentals: view, modify dates, cancel; profile
- [ ] APP-8 Admin: branches, fleet, pricing, reservations, check-out, check-in, damage reports
- [ ] APP-9 Private licence/damage file route (owner + admin only)

## QA
- [x] QA-1 Test harness: reset test DB, migrate, seed; Playwright auth helpers — done (tests/setup/reset-test-db.ts, vitest projects unit+integration, playwright on :3100 vs driveeasy_test; seed hooked in once scripts/seed.ts exists)
- [ ] QA-2 Unit/integration: pricing, availability, back-to-back, hold expiry, cron idempotency — doing (pricing engine + DB-level back-to-back/maintenance done; waiting on quotePrice/searchAvailability/holds)
- [ ] QA-3 Concurrency: overlapping reservations from two sessions (≥20 runs, exactly one wins) — doing (DB-constraint level passes 25/25; waiting on createReservationHold)
- [ ] QA-4 Payments: success, failure, cancel, retry, refund, deposit release, duplicate webhooks
- [ ] QA-5 Authorization: cross-user isolation, admin permissions
- [ ] QA-6 E2E: register → search → book → pay → voucher → check-out → check-in
- [ ] QA-7 Migrations on a clean database; production build; desktop + mobile layouts — doing (migrations from zero pass)
- [ ] QA-8 `docs/qa-report.md`

## Bugs
<!-- - [ ] BUG-1 [DB] description — found by QA — status -->
