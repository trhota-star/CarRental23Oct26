// Playwright auth helpers. Users are created per test (unique emails) so specs
// can run in parallel against the shared driveeasy_test database.

import { randomUUID } from "node:crypto";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { Client } from "pg";

export const PASSWORD = "Passw0rd-qa-1";

export type TestUser = { name: string; email: string; password: string };

export function newUser(prefix = "qa"): TestUser {
  const id = randomUUID().slice(0, 8);
  return { name: `QA ${prefix} ${id}`, email: `${prefix}-${id}@example.test`, password: PASSWORD };
}

/** Registers through the real /register form. Ends signed in (autoSignIn). */
export async function registerViaUi(page: Page, user: TestUser = newUser()): Promise<TestUser> {
  await page.goto("/register");
  await page.getByLabel("Full name").fill(user.name);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByLabel("Confirm password").fill(user.password);
  await page.getByRole("button", { name: "Create account" }).click();
  // first sign-up on a cold server (scrypt + server action) can take several seconds
  await expect(page).not.toHaveURL(/\/register/, { timeout: 20_000 });
  return user;
}

export async function loginViaUi(page: Page, user: TestUser): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

/**
 * Fast path: sign up via the better-auth HTTP API. Cookies land in the
 * request context (use `page.request` so the page shares the session).
 */
export async function signUpViaApi(request: APIRequestContext, user: TestUser = newUser()): Promise<TestUser> {
  const res = await request.post("/api/auth/sign-up/email", {
    data: { name: user.name, email: user.email, password: user.password },
  });
  expect(res.ok(), `sign-up ${res.status()} ${await res.text()}`).toBe(true);
  return user;
}

export async function signInViaApi(request: APIRequestContext, user: TestUser): Promise<void> {
  // better-auth's CSRF check rejects cookie-bearing requests without an Origin (403),
  // and sign-up has already set a session cookie — send one like a browser would.
  const origin = `http://localhost:${process.env.E2E_PORT ?? 3100}`;
  const res = await request.post("/api/auth/sign-in/email", {
    data: { email: user.email, password: user.password },
    headers: { Origin: origin },
  });
  expect(res.ok(), `sign-in ${res.status()} ${await res.text()}`).toBe(true);
}

/** Promotes a user to admin directly in driveeasy_test (users cannot set their own role). */
export async function makeAdmin(email: string): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url?.includes("_test")) throw new Error("TEST_DATABASE_URL must point at driveeasy_test");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const r = await client.query(`update users set role = 'admin' where email = $1`, [email.toLowerCase()]);
    expect(r.rowCount).toBe(1);
  } finally {
    await client.end();
  }
}

/** Signs up a new admin via the API and promotes them. Re-sign-in refreshes the session's role. */
export async function adminSession(page: Page): Promise<TestUser> {
  const user = await signUpViaApi(page.request, newUser("admin"));
  await makeAdmin(user.email);
  await signInViaApi(page.request, user);
  return user;
}
