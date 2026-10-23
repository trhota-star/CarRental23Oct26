import { existsSync } from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

// Tests always use the test database, never driveeasy_dev.
const testEnv = {
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
  PAYMENT_PROVIDER: "fake",
  // Webhooks are delivered by tests explicitly, not over HTTP.
  PAYMENT_WEBHOOK_URL: "",
  FAKE_PAYMENTS_DUPLICATE_WEBHOOKS: "false",
  FAKE_PAYMENTS_STATE_FILE: ".local/fake-payments.test.json",
  STORAGE_PROVIDER: "local",
  LOCAL_UPLOADS_DIR: "storage/uploads-test",
};

// `server-only` throws outside a React Server environment; stub it for Node tests.
const alias = { "server-only": path.resolve("tests/setup/server-only-stub.ts") };

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true, alias },
  test: {
    environment: "node",
    env: testEnv,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.{ts,tsx}", "tests/unit/**/*.test.{ts,tsx}"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.{ts,tsx}"],
          // Fresh driveeasy_test: drop, recreate, migrate from zero, seed.
          globalSetup: ["tests/setup/vitest-global-setup.ts"],
          // DB tests share one database: run files one at a time.
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
