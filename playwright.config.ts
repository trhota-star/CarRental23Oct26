import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

// E2E runs on its own port against driveeasy_test (never driveeasy_dev).
// Port 3000 belongs to another project; the user's DriveEasy dev server is on 3200.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;

// Default: production build + `next start` (also covers the `pnpm build` gate).
// `next dev` allows only one dev server per directory, so E2E_SERVER=dev only
// works when nobody else is running `pnpm dev` here.
const mode = process.env.E2E_SERVER === "dev" ? "dev" : "prod";
// The DB reset (drop, migrate from zero, seed) runs first, before the server or build
// touches the database. E2E_SKIP_DB_RESET=1 keeps existing data.
// E2E_SKIP_SEED=1 resets + migrates without seeding.
const reset =
  process.env.E2E_SKIP_DB_RESET === "1"
    ? ""
    : `pnpm test:db:reset${process.env.E2E_SKIP_SEED === "1" ? " --no-seed" : ""} && `;
const command =
  reset + (mode === "dev" ? `pnpm exec next dev --port ${PORT}` : `pnpm exec next build && pnpm exec next start --port ${PORT}`);

const serverEnv: Record<string, string> = {
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
  APP_URL: BASE_URL,
  BETTER_AUTH_URL: BASE_URL,
  PAYMENT_PROVIDER: "fake",
  PAYMENT_WEBHOOK_URL: `${BASE_URL}/api/webhooks/payments`,
  FAKE_PAYMENTS_STATE_FILE: ".local/fake-payments.e2e.json",
  STORAGE_PROVIDER: "local",
  LOCAL_UPLOADS_DIR: "storage/uploads-e2e",
  SCHEDULER_PROVIDER: "local",
};

export default defineConfig({
  testDir: "./tests/e2e",
  // Shared DB: keep workers modest; specs create their own users/data.
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,
  reporter: [["list"], ["json", { outputFile: "test-results/e2e-results.json" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "desktop-firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "desktop-webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-pixel7", use: { ...devices["Pixel 7"] } },
    { name: "mobile-iphone14", use: { ...devices["iPhone 14"] } },
  ],
  webServer: {
    command,
    url: BASE_URL,
    env: serverEnv,
    // Never silently reuse a server that might be pointed at driveeasy_dev.
    reuseExistingServer: process.env.E2E_REUSE_SERVER === "1",
    timeout: 600_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
