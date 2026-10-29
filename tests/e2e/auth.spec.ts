// QA-5 / QA-6: register, login, logout, and role escalation.
import { expect, test, type Page } from "@playwright/test";
import { loginViaUi, newUser, registerViaUi, signUpViaApi } from "./helpers/auth";

async function sessionOf(page: Page) {
  const res = await page.request.get("/api/auth/get-session");
  return (await res.json()) ?? null;
}

/** Desktop: <details> "Account menu" then "Sign out". Mobile: hamburger menu then "Sign out". */
async function signOut(page: Page) {
  // "Account menu" is screen-reader text inside the <summary>; click the summary itself.
  // The account area streams in after navigation, so wait for whichever trigger shows.
  const accountMenu = page.locator("summary", { hasText: "Account menu" });
  const mobileMenu = page.getByRole("button", { name: /menu/i });
  await accountMenu.or(mobileMenu).filter({ visible: true }).first().click();
  await page.getByRole("button", { name: "Sign out" }).filter({ visible: true }).first().click();
}

test.describe("auth", () => {
  test("register via UI signs the user in", async ({ page }) => {
    const user = await registerViaUi(page);
    const session = await sessionOf(page);
    expect(session?.user?.email).toBe(user.email);
  });

  test("register rejects a weak password and mismatched confirmation", async ({ page }) => {
    await page.goto("/register");
    const u = newUser();
    await page.getByLabel("Full name").fill(u.name);
    await page.getByLabel("Email").fill(u.email);
    await page.getByLabel("Password", { exact: true }).fill("short");
    await page.getByLabel("Confirm password").fill("different");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Use at least 8 characters.")).toBeVisible();
    await expect(page.getByText("Passwords don't match.")).toBeVisible();
    await expect(page).toHaveURL(/\/register/);
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
    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(page).toHaveURL(/\/register/);
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
    expect((await sessionOf(page))?.user?.email).toBe(user.email);
  });

  test("logout ends the session", async ({ page }) => {
    await registerViaUi(page);
    await page.goto("/");
    expect(await sessionOf(page)).not.toBeNull();
    await signOut(page);
    await expect.poll(() => sessionOf(page)).toBeNull();
  });

  test("users cannot make themselves admin at sign-up", async ({ request }) => {
    const u = newUser("escalate");
    await request.post("/api/auth/sign-up/email", { data: { ...u, role: "admin" } });
    const session = await (await request.get("/api/auth/get-session")).json();
    expect(session?.user?.role ?? "customer").toBe("customer");
  });
});
