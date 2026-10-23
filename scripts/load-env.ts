import { existsSync } from "node:fs";

/** Loads .env.local for scripts run outside Next.js. Existing vars win. */
export function loadLocalEnv(file = ".env.local"): void {
  if (existsSync(file)) process.loadEnvFile(file);
}
