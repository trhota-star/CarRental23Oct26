import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FAKE_PAYMENT_METHODS, FakePaymentProvider } from "@/server/payments/fake";
import { PaymentError } from "@/server/payments/types";

const base = { amount: 5000, currency: "usd", reference: "booking_1" };
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "fake-pay-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const provider = (extra: Partial<ConstructorParameters<typeof FakePaymentProvider>[0]> = {}) =>
  new FakePaymentProvider({ stateFile: path.join(dir, "state.json"), webhookSecret: "test-secret", ...extra });

describe("FakePaymentProvider", () => {
  it("succeeds, fails and cancels by payment method", async () => {
    const p = provider();
    const ok = await p.createPayment({ ...base, idempotencyKey: "a", paymentMethod: FAKE_PAYMENT_METHODS.success });
    const bad = await p.createPayment({ ...base, idempotencyKey: "b", paymentMethod: FAKE_PAYMENT_METHODS.decline });
    const gone = await p.createPayment({ ...base, idempotencyKey: "c", paymentMethod: FAKE_PAYMENT_METHODS.cancel });
    expect([ok.status, bad.status, gone.status]).toEqual(["succeeded", "failed", "canceled"]);
    expect(bad.failureReason).toBe("card_declined");
  });

  it("cancels a pending payment", async () => {
    const p = provider();
    const pending = await p.createPayment({ ...base, idempotencyKey: "a", paymentMethod: FAKE_PAYMENT_METHODS.pending });
    expect((await p.cancelPayment(pending.id)).status).toBe("canceled");
  });

  it("is idempotent", async () => {
    const p = provider();
    const req = { ...base, idempotencyKey: "same", paymentMethod: FAKE_PAYMENT_METHODS.success };
    expect((await p.createPayment(req)).id).toBe((await p.createPayment(req)).id);
  });

  it("refunds partially then fully", async () => {
    const p = provider();
    const pay = await p.createPayment({ ...base, idempotencyKey: "a", paymentMethod: FAKE_PAYMENT_METHODS.success });
    expect((await p.refundPayment(pay.id, 2000)).status).toBe("partially_refunded");
    const full = await p.refundPayment(pay.id);
    expect(full).toMatchObject({ status: "refunded", amountRefunded: 5000 });
    await expect(p.refundPayment(pay.id)).rejects.toBeInstanceOf(PaymentError);
  });

  it("holds, releases and captures deposits", async () => {
    const p = provider();
    const hold = await p.holdDeposit({ ...base, idempotencyKey: "h1", paymentMethod: FAKE_PAYMENT_METHODS.success });
    expect(hold.status).toBe("held");
    expect((await p.releaseDeposit(hold.id)).status).toBe("released");
    expect((await p.releaseDeposit(hold.id)).status).toBe("released");

    const hold2 = await p.holdDeposit({ ...base, idempotencyKey: "h2", paymentMethod: FAKE_PAYMENT_METHODS.success });
    expect(await p.captureDeposit(hold2.id, 1500)).toMatchObject({ status: "captured", amountCaptured: 1500 });

    const failed = await p.holdDeposit({ ...base, idempotencyKey: "h3", paymentMethod: FAKE_PAYMENT_METHODS.decline });
    expect(failed.status).toBe("failed");
  });

  it("rejects tampered webhooks", async () => {
    const p = provider();
    await p.createPayment({ ...base, idempotencyKey: "a", paymentMethod: FAKE_PAYMENT_METHODS.success });
    const [event] = await p.listEvents();
    const { body, headers } = p.signedWebhook(event);
    expect(p.verifyWebhook(body, headers[p.webhookSignatureHeader]).id).toBe(event.id);
    expect(() => p.verifyWebhook(body.replace("5000", "1"), headers[p.webhookSignatureHeader])).toThrow(PaymentError);
    expect(() => p.verifyWebhook(body, null)).toThrow(PaymentError);
  });

  describe("webhook delivery", () => {
    let server: Server;
    let received: { id: string; type: string }[];
    let url: string;

    beforeEach(async () => {
      received = [];
      server = createServer((req, res) => {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          received.push(JSON.parse(body));
          res.end("ok");
        });
      });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const address = server.address();
      url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/hook`;
    });
    afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

    it("delivers signed webhooks, with duplicates when enabled", async () => {
      const p = provider({ webhookUrl: url, duplicateWebhooks: true });
      await p.createPayment({ ...base, idempotencyKey: "a", paymentMethod: FAKE_PAYMENT_METHODS.success });
      expect(received).toHaveLength(2);
      expect(received[0].id).toBe(received[1].id);
      expect(received[0].type).toBe("payment.succeeded");

      await p.resendWebhook(received[0].id, 3);
      expect(received).toHaveLength(5);
      expect((await p.listEvents())[0].deliveries).toBe(5);
    });
  });
});
