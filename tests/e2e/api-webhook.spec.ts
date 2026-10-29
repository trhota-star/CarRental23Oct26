// QA-4: POST /api/webhooks/payments over HTTP: 400 on bad/missing signature,
// 200 with {status} on valid deliveries, duplicates are no-ops.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { FAKE_PAYMENT_METHODS, FakePaymentProvider } from "../../src/server/payments/fake";

const PATH = "/api/webhooks/payments";

// HTTP-only spec: one browser project is enough.
test.skip(({ browserName, isMobile }) => browserName !== "chromium" || !!isMobile, "API spec runs once");

function provider() {
  const dir = mkdtempSync(path.join(tmpdir(), "qa-wh-"));
  return new FakePaymentProvider({
    stateFile: path.join(dir, "state.json"),
    webhookSecret: process.env.PAYMENT_WEBHOOK_SECRET ?? "",
  });
}

test.describe("payment webhook route", () => {
  test("rejects missing and tampered signatures with 400", async ({ request }) => {
    const p = provider();
    await p.createPayment({ amount: 100, currency: "aed", reference: "DE-QAWH0001", idempotencyKey: `qa-wh-${Date.now()}`, paymentMethod: FAKE_PAYMENT_METHODS.success });
    const [event] = await p.listEvents();
    const { body, headers } = p.signedWebhook(event);
    expect((await request.post(PATH, { data: body, headers: { "content-type": "application/json" } })).status()).toBe(400);
    const tampered = body.replace(/"amount":\d+/, '"amount":1');
    expect((await request.post(PATH, { data: tampered, headers: { ...headers, "content-type": "application/json" } })).status()).toBe(400);
  });

  test("valid delivery → 200; redelivery → 200 duplicate", async ({ request }) => {
    const p = provider();
    await p.createPayment({ amount: 100, currency: "aed", reference: "DE-QAWH0002", idempotencyKey: `qa-wh2-${Date.now()}`, paymentMethod: FAKE_PAYMENT_METHODS.success });
    const [event] = await p.listEvents();
    const { body, headers } = p.signedWebhook(event);
    const send = () => request.post(PATH, { data: body, headers: { ...headers, "content-type": "application/json" } });
    const first = await send();
    expect(first.status()).toBe(200);
    expect(["processed", "ignored"]).toContain((await first.json()).status);
    const dupes = await Promise.all([send(), send(), send()]);
    for (const d of dupes) {
      expect(d.status()).toBe(200);
      expect((await d.json()).status).toBe("duplicate");
    }
  });
});
