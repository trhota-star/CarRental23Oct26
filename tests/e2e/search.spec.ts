// QA-6: search, branch selection, date ranges, every filter, vehicle details.
// Dates are ~120 days out so seed reservations/maintenance don't interfere.
import { expect, test, type Page } from "@playwright/test";
import { branchByCode, dateIn, q } from "./helpers/db";

async function trip(code = "DXB", returnCode = code, from = 120, days = 3) {
  const p = await branchByCode(code);
  const r = await branchByCode(returnCode);
  return new URLSearchParams({
    pickupBranchId: p.id,
    returnBranchId: r.id,
    pickupDate: dateIn(from),
    pickupTime: "10:00",
    returnDate: dateIn(from + days),
    returnTime: "10:00",
  });
}

async function expectedCount(code: string, where = "true", params: unknown[] = []) {
  const [row] = await q<{ n: number }>(
    `select count(*)::int n from vehicles v join branches b on b.id = v.branch_id
     where b.code = $1 and v.status not in ('RETIRED','MAINTENANCE') and ${where}`,
    [code, ...params],
  );
  return row.n;
}

const dailyRates = (page: Page) => page.locator("article p").filter({ hasText: /^AED\s[\d,]+\.\d{2}\/day$/ }); // Intl uses a no-break space

const heading = (n: number) => new RegExp(`^${n} cars? available$`);

test.describe("search", () => {
  test("home search form → results page", async ({ page }) => {
    await page.goto("/");
    const branch = await branchByCode("DXB");
    await page.getByLabel("Pick-up branch").selectOption(branch.id);
    await page.getByLabel("Pick-up date").fill(dateIn(120));
    await page.getByLabel("Return date").fill(dateIn(123));
    await page.getByRole("button", { name: /search/i }).first().click();
    await expect(page).toHaveURL(/\/search\?/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading(await expectedCount("DXB")));
  });

  test("results show daily rate and total incl. VAT; every branch searchable", async ({ page }) => {
    for (const code of ["DXB", "DXM", "AUH", "SHJ"]) {
      await page.goto(`/search?${await trip(code)}`);
      await expect(page.getByRole("heading", { level: 1 }), code).toHaveText(heading(await expectedCount(code)));
    }
    await page.goto(`/search?${await trip("DXB")}`);
    await expect(dailyRates(page).first()).toBeVisible();
    await expect(page.locator("article p").filter({ hasText: /total · 3 days incl\. VAT/ }).first()).toBeVisible();
  });

  test("filters: transmission, fuel type, seats, category, max price, sort", async ({ page }) => {
    const base = await trip("DXB");
    const check = async (params: Record<string, string>, where: string, args: unknown[] = []) => {
      const qs = new URLSearchParams(base);
      for (const [k, v] of Object.entries(params)) qs.set(k, v);
      await page.goto(`/search?${qs}`);
      await expect(page.getByRole("heading", { level: 1 }), JSON.stringify(params)).toHaveText(heading(await expectedCount("DXB", where, args)));
    };
    await check({ transmission: "MANUAL" }, "v.transmission = 'MANUAL'");
    await check({ transmission: "AUTOMATIC" }, "v.transmission = 'AUTOMATIC'");
    await check({ fuelType: "ELECTRIC" }, "v.fuel_type = 'ELECTRIC'");
    await check({ fuelType: "PETROL" }, "v.fuel_type = 'PETROL'");
    await check({ seats: "7" }, "v.seats >= 7");
    const [suv] = await q<{ id: string }>(`select id from vehicle_categories where code = 'SUV'`);
    await check({ category: suv.id }, "v.category_id = $2", [suv.id]);
    await check({ maxPrice: "1" }, "false");
    // sort by price ascending: first card's daily rate <= last card's
    const qs = new URLSearchParams(base);
    qs.set("sort", "price_asc");
    await page.goto(`/search?${qs}`);
    const prices = (await dailyRates(page).allTextContents()).map((t) => Number(t.replace(/[^\d.]/g, "")));
    expect(prices.length).toBeGreaterThan(1);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  test("filter UI (desktop sidebar) applies via the form", async ({ page, isMobile }) => {
    test.skip(isMobile, "sidebar is desktop-only");
    await page.goto(`/search?${await trip("DXB")}`);
    const filters = page.getByRole("complementary", { name: "Filters" });
    await filters.getByLabel("Transmission").selectOption("MANUAL");
    await filters.getByRole("button").last().click();
    await expect(page).toHaveURL(/transmission=MANUAL/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading(await expectedCount("DXB", "v.transmission = 'MANUAL'")));
  });

  test("return before pick-up shows an error, not a crash", async ({ page }) => {
    const qs = await trip("DXB");
    qs.set("returnDate", dateIn(118));
    const res = await page.goto(`/search?${qs}`);
    expect(res?.status()).toBeLessThan(500);
    await expect(page.getByRole("alert").first()).toBeVisible();
  });

  test("garbage query params never 500", async ({ page }) => {
    for (const qs of ["pickupBranchId=nope", "pickupBranchId=00000000-0000-0000-0000-000000000000&pickupDate=2020-99-99", "seats=abc&maxPrice=-5"]) {
      const res = await page.goto(`/search?${qs}`);
      expect(res?.status(), qs).toBeLessThan(500);
    }
  });

  test("vehicle details page from a result card shows the car and an availability calendar", async ({ page }) => {
    await page.goto(`/search?${await trip("DXB")}`);
    const first = page.locator("article h2 a").first();
    const name = (await first.textContent())?.trim() ?? "";
    await first.click();
    await expect(page).toHaveURL(/\/vehicles\/[0-9a-f-]{36}\?/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(name);
    await expect(page.getByText(/availability/i).first()).toBeVisible();
  });

  test("unknown vehicle id → not-found page (HTTP 404: see BUG-3)", async ({ page }) => {
    const res = await page.goto(`/vehicles/00000000-0000-4000-8000-000000000000`);
    await expect(page.getByRole("heading", { name: "We can't find that page" })).toBeVisible();
    expect(res?.status()).toBeLessThan(500);
    if (res?.status() !== 404) test.info().annotations.push({ type: "BUG-3", description: `status ${res?.status()} instead of 404` });
  });

  test("branches page lists every active branch with its time zone", async ({ page }) => {
    await page.goto("/branches");
    const branches = await q<{ name: string }>(`select name from branches where is_active and code !~ '^Q'`);
    for (const b of branches) await expect(page.getByText(b.name).first()).toBeVisible();
  });
});
