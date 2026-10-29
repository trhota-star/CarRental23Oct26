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
- [x] DB-7 Payment + deposit orchestration, `confirmReservation`, webhook route with dedup
- [x] DB-8 Modify dates / cancel per policy (refunds, deposit release)
- [x] DB-9 Check-out / check-in (rental agreement, mileage, fuel, late fee, damage reports)
- [x] DB-10 Cron route + real `HoldStore` (idempotent, SKIP LOCKED)
- [x] DB-11 Stripe + Vercel Blob adapters (unit-tested with mocks, not connected)
- [x] DB-12 Idempotent seed `pnpm db:seed`
- [x] DB-13 Publish the function list in `docs/server-api.md` for App and QA

## App
- [x] APP-1 better-auth setup (email/password, roles), login/register/logout, route guards — done (needs seed to verify admin login)
- [x] APP-2 Layout, navigation, design system, loading/empty/error states — done
- [x] APP-3 Home + search form, search results with filters — done
- [x] APP-4 Vehicle details + availability calendar, branches page — done
- [x] APP-5 Booking flow: dates, extras, price breakdown, driver details, licence upload, checkout — done
- [x] APP-6 Pick-up voucher with QR code — done
- [x] APP-7 My rentals: view, modify dates, cancel; profile — done
- [x] APP-8 Admin: branches, fleet, pricing, reservations, check-out, check-in, damage reports — done
- [x] APP-9 Private licence/damage file route (owner + admin only) — done

## QA
- [x] QA-1 Test harness: reset test DB, migrate, seed; Playwright auth helpers — done (tests/setup/reset-test-db.ts, vitest projects unit+integration, playwright on :3100 vs driveeasy_test; seed hooked in once scripts/seed.ts exists)
- [x] QA-2 Unit/integration: pricing, availability, back-to-back, hold expiry, cron idempotency — done
- [x] QA-3 Concurrency: overlapping reservations from two sessions (≥20 runs, exactly one wins) — done
- [x] QA-4 Payments: success, failure, cancel, retry, refund, deposit release, duplicate webhooks — done
- [x] QA-5 Authorization: cross-user isolation, admin permissions — done
- [x] QA-6 E2E: register → search → book → pay → voucher → check-out → check-in — done (tests/e2e/rental-flow.spec.ts)
- [x] QA-7 Migrations on a clean database; production build; desktop + mobile layouts — done
- [x] QA-8 `docs/qa-report.md` — done

## Bugs
- [x] BUG-1 [APP] `pnpm build` fails: "Route /vehicles/[id]: usePathname() in a Client Component outside <Suspense>" (src/components/layout/nav-link.tsx:11 via site-header) — repro: `pnpm exec next build` — found by QA 20:27 — FIXED by APP, retested by QA: `next build` passes
- [x] BUG-2 [DB] Malformed or offset-less date strings (e.g. `pickupAt: "2031-01-10T10:00:00"`, `returnAt: "not-a-date"`) throw `TypeError: v.pickupAt.getTime is not a function` instead of ValidationError in quotePrice, searchAvailability and createReservationHold (the object `.refine` runs on unparsed fields; guard with `instanceof Date` or use `.check`/`superRefine` with abort) — repro: tests/integration/quote.test.ts — found by QA — FIXED by DB, retested by QA: pass
- [x] BUG-3 [APP] (minor) Not-found pages return HTTP 200, not 404, e.g. GET /vehicles/00000000-0000-4000-8000-000000000000 renders "We can't find that page" but status is 200 (notFound() is called after streaming starts) — repro: tests/e2e/search.spec.ts "unknown vehicle id" — FIXED by APP: loaded vehicle before Suspense boundary to prevent premature HTTP 200 headers
- [x] BUG-4 [APP] (security) Login brute force isn't throttled — repro: tests/e2e/auth-throttle.spec.ts — FIXED by APP: added in-memory IP/email rate limiting in loginAction (5 attempts/60s window) and handled 429 status
<!-- - [ ] BUG-1 [DB] description — found by QA — status -->
