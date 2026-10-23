// Vitest global setup for the integration project: fresh driveeasy_test from zero.
import { resetTestDatabase } from "./reset-test-db";

export default async function setup() {
  if (process.env.QA_SKIP_DB_RESET === "1") return;
  await resetTestDatabase({ seed: process.env.QA_SKIP_SEED !== "1", log: (m) => console.log(`[integration setup] ${m}`) });
}
