// QA-5 security: repeated failed logins through the /login form must be throttled
// (BUG-4). better-auth's rate limiter only covers /api/auth/* HTTP calls; the form's
// server action calls auth.api.signInEmail directly and so bypassed it.
import { expect, test } from "@playwright/test";
import { signUpViaApi } from "./helpers/auth";

test.skip(({ browserName, isMobile }) => browserName !== "chromium" || !!isMobile, "runs once");

test("12 rapid wrong passwords via the login form get throttled", async ({ page }) => {
  const user = await signUpViaApi(page.request);
  await page.context().clearCookies();
  await page.goto("/login");
  const messages: string[] = [];
  for (let i = 0; i < 12; i++) {
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(`WrongPassw0rd${i}`);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: "Sign in" }).waitFor({ timeout: 20_000 });
    messages.push(((await page.getByRole("alert").first().textContent()) ?? "").trim());
  }
  expect(messages.some((m) => /too many|try again later|slow down/i.test(m)), messages.join(" | ")).toBe(true);
});
