import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { requireEnv } from "../config";
import { getDb } from "../db";
import { authSchema } from "../db/schema";

function createAuth() {
  return betterAuth({
    appName: "DriveEasy",
    baseURL: requireEnv("BETTER_AUTH_URL"),
    secret: requireEnv("BETTER_AUTH_SECRET"),
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: authSchema,
    }),
    user: {
      additionalFields: {
        // Users can never set their own role; admins are promoted by the seed or an existing admin.
        role: { type: "string", required: false, defaultValue: "customer", input: false },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
    },
    advanced: {
      database: { generateId: "uuid" },
    },
    // nextCookies must be last: it writes Set-Cookie from Server Actions.
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { __driveEasyAuth?: Auth };

/** Lazily-built better-auth instance (avoids touching env/DB at import time during builds). */
export function getAuth(): Auth {
  globalForAuth.__driveEasyAuth ??= createAuth();
  return globalForAuth.__driveEasyAuth;
}
