// QA-6: Full rental lifecycle E2E:
// register → search → book → checkout (licence upload) → pay → voucher (QR) → admin check-out → admin check-in
import { expect, test } from "@playwright/test";
import { branchByCode, dateIn } from "./helpers/db";
import { adminSession, newUser, registerViaUi } from "./helpers/auth";

test.describe("full rental lifecycle", () => {
  test("register → search → book → pay → voucher → check-out → check-in", async ({ page, browser }) => {
    // 1. Register a new customer
    const user = await registerViaUi(page, newUser("flow"));

    // 2. Search for available cars ~140 days out (offset per parallel worker so
    // concurrent projects don't race for the same car and dates)
    const offset = 140 + test.info().parallelIndex * 5;
    const branch = await branchByCode("DXB");
    const qs = new URLSearchParams({
      pickupBranchId: branch.id,
      returnBranchId: branch.id,
      pickupDate: dateIn(offset),
      pickupTime: "10:00",
      returnDate: dateIn(offset + 3),
      returnTime: "10:00",
    });
    await page.goto(`/search?${qs.toString()}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("cars available");

    // 3. Select a vehicle (a different one per parallel worker: admin check-out below
    // is refused while the same car is still on rent from another worker's run)
    const firstVehicleCard = page.locator("article h2 a").nth(test.info().parallelIndex);
    await firstVehicleCard.click();
    await expect(page).toHaveURL(/\/vehicles\/[0-9a-f-]{36}\?/);

    // 4. Proceed to extras & pricing
    const reserveButton = page.getByRole("link", { name: /reserve|continue to extras/i }).first();
    await reserveButton.click();
    await expect(page).toHaveURL(/\/book\/[0-9a-f-]{36}\?/);

    // 5. Select extras and create reservation hold
    await page.getByRole("button", { name: /reserve and continue|continue to checkout|reserve this car/i }).click();
    await expect(page).toHaveURL(/\/checkout\/[0-9a-f-]{36}/, { timeout: 15_000 });

    // 6. Complete driver profile with licence upload
    const fullNameInput = page.getByLabel("Full name (as on licence)");
    // New user: the profile form streams in after navigation, so wait for it.
    await expect(fullNameInput).toBeVisible({ timeout: 15_000 });
    await fullNameInput.fill(user.name);
    await page.getByLabel("Mobile number").fill("+971501234567");
    await page.getByLabel("Date of birth").fill("1995-05-15");
    await page.getByLabel("Nationality").fill("AE");
    await page.getByLabel("Licence number").fill(`LIC-${Date.now().toString().slice(-6)}`);
    await page.getByLabel("Licence issuing country").fill("AE");
    await page.getByLabel("Licence expiry date").fill(dateIn(500));

    const pngBuffer = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    await page.locator('input[name="licenceFile"]').setInputFiles({
      name: "licence.png",
      mimeType: "image/png",
      buffer: pngBuffer,
    });

    await page.getByRole("button", { name: /save/i }).click();
    await expect(page.getByText(/complete/i).first()).toBeVisible({ timeout: 15_000 });

    // 7. Pay with fake payment provider (defaults to success)
    await page.getByRole("button", { name: /pay & reserve|pay/i }).click();
    await expect(page).toHaveURL(/\/rentals\/[0-9a-f-]{36}\/voucher/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: /pick-up voucher|driveeasy/i }).first()).toBeVisible();
    await expect(page.locator('div[role="img"]').first()).toBeVisible();

    const voucherUrl = page.url();
    const reservationId = voucherUrl.split("/rentals/")[1]?.split("/voucher")[0];
    expect(reservationId).toBeTruthy();

    // 8. Admin check-out and check-in
    const adminPage = await browser.newPage();
    await adminSession(adminPage);
    await adminPage.goto(`/admin/reservations/${reservationId}`);

    // Confirm check-out
    await expect(adminPage.getByText(/confirmed/i).first()).toBeVisible();
    await adminPage.getByRole("button", { name: "Confirm check-out" }).click();
    await expect(adminPage.getByText(/picked up/i).first()).toBeVisible({ timeout: 15_000 });

    // Confirm check-in
    await adminPage.locator('input[name="mileageKm"]').fill("25000");
    await adminPage.locator('input[name="fuelLevel"]').fill("100");
    await adminPage.getByRole("button", { name: "Confirm check-in" }).click();
    await expect(adminPage.getByText(/returned/i).first()).toBeVisible({ timeout: 15_000 });

    await adminPage.close();
  });
});
