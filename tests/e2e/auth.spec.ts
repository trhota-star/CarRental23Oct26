// QA-5 / QA-6: register, login, logout, and route protection.
import { expect, test } from "@playwright/test";
import { loginViaUi, newUser, registerViaUi, signUpViaApi } from "./helpers/auth";

test.describe("auth", () => {
  test("register via UI signs the user in", async ({ page }) => {
    const user = await registerViaUi(page);
    await page.goto("/");
    await expect(page.getByText(user.name.split(" ")[0], { exact: false }).first()).toBeVisible();
  });

  test("register rejects a weak password and mismatched confirmation", async ({ page }) => {
    await page.goto("/register");
    const u = newUser();
    await page.getByLabel("Full name").fill(u.name);
    await page.getByLabel("Email").fill(u.email);
    await page.getByLabel("Password", { exact: true }).fill("short");
    await page.getByLabel("Confirm password").fill("different");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/register/);
    await expect(page.getByText("Use at least 8 characters.")).toBeVisible();
    await expect(page.getByText("Passwords don't match.")).toBeVisible();
  });

  test("duplicate email is rejected", async ({ page }) => {
    const user = await signUpViaApi(page.request);
    await page.context().clearCookies();
    await page.goto("/register");
    await page.getByLabel("Full name").fill(user.name);
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(user.password);
    await page.getByLabel("Confirm password").fill(user.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/register/);
    await expect(page.getByRole("alert").first()).toBeVisible();
  });

  test("login with wrong password shows an error; correct password signs in", async ({ page }) => {
    const user = await signUpViaApi(page.request);
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill("WrongPassw0rd");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("That email and password don't match an account.")).toBeVisible();
    await loginViaUi(page, user);
  });

  test("logout ends the session", async ({ page }) => {
    await registerViaUi(page);
    const before = await page.request.get("/api/auth/get-session");
    expect(await before.json()).not.toBeNull();
    // Logout lives in the account menu (desktop) or the mobile nav.
    const menu = page.getByRole("button", { name: /account|menu/i }).first();
    if (await menu.isVisible()) await menu.click();
    await page.getByRole("button", { name: /sign out|log out/i }).first().click();
    await expect
      .poll(async () => (await (await page.request.get("/api/auth/get-session")).json()) ?? null)
      .toBeNull();
  });

  test("users cannot make themselves admin at sign-up", async ({ request }) => {
    const u = newUser("escalate");
    await request.post("/api/auth/sign-up/email", { data: { ...u, role: "admin" } });
    const session = await (await request.get("/api/auth/get-session")).json();
    expect(session?.user?.role ?? "customer").toBe("customer");
  });
});
