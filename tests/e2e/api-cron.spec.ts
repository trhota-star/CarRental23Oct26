// QA-2: POST /api/cron/release-expired-holds is protected by Bearer CRON_SECRET,
// idempotent, and safe to call in parallel. (DB effects are verified in
// tests/integration/hold-expiry.test.ts.)
import { expect, test } from "@playwright/test";

const PATH = "/api/cron/release-expired-holds";
const secret = () => process.env.CRON_SECRET ?? "";

// HTTP-only spec: one browser project is enough.
test.skip(({ browserName, isMobile }) => browserName !== "chromium" || !!isMobile, "API spec runs once");

test.describe("cron: release expired holds", () => {
  test("401 without or with a wrong bearer token", async ({ request }) => {
    expect((await request.post(PATH)).status()).toBe(401);
    expect((await request.post(PATH, { headers: { authorization: "Bearer wrong" } })).status()).toBe(401);
    expect((await request.post(PATH, { headers: { authorization: secret() } })).status()).toBe(401);
  });

  test("200 with the bearer secret, repeatedly and in parallel", async ({ request }) => {
    const auth = { authorization: `Bearer ${secret()}` };
    expect((await request.post(PATH, { headers: auth })).status()).toBe(200);
    const results = await Promise.all(Array.from({ length: 5 }, () => request.post(PATH, { headers: auth })));
    for (const r of results) expect(r.status()).toBe(200);
  });
});
