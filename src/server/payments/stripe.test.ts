// StripePaymentProvider with a mocked Stripe client. No network calls.

import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { mapStripeEvent, StripePaymentProvider, type StripeLike } from "./stripe";
import { IGNORED_WEBHOOK_EVENT, PaymentError } from "./types";

function intent(over: Partial<Stripe.PaymentIntent>): Stripe.PaymentIntent {
  return {
    id: "pi_1",
    object: "payment_intent",
    amount: 10000,
    amount_received: 0,
    currency: "aed",
    status: "succeeded",
    created: 1_900_000_000,
    metadata: { reference: "DE-TEST", kind: "payment" },
    last_payment_error: null,
    latest_charge: null,
    ...over,
  } as Stripe.PaymentIntent;
}

function mockClient(overrides: Partial<StripeLike["paymentIntents"]> = {}) {
  const client = {
    paymentIntents: {
      create: vi.fn(async (p: Stripe.PaymentIntentCreateParams) =>
        intent({ amount: p.amount, status: p.capture_method === "manual" ? "requires_capture" : "succeeded", metadata: p.metadata as Stripe.Metadata }),
      ),
      retrieve: vi.fn(async () => intent({})),
      cancel: vi.fn(async () => intent({ status: "canceled" })),
      capture: vi.fn(async (_id: string, p?: Stripe.PaymentIntentCaptureParams) => intent({ status: "succeeded", amount_received: p?.amount_to_capture ?? 10000 })),
      ...overrides,
    },
    refunds: { create: vi.fn(async () => ({ id: "re_1" }) as Stripe.Refund) },
    webhooks: { constructEvent: vi.fn() },
  };
  return client;
}

const req = { amount: 10000, currency: "AED", reference: "DE-TEST", idempotencyKey: "key-1", paymentMethod: "pm_card_visa", metadata: { paymentId: "x" } };

describe("StripePaymentProvider", () => {
  it("creates a confirmed PaymentIntent with the idempotency key", async () => {
    const client = mockClient();
    const p = new StripePaymentProvider({ secretKey: "sk_test", webhookSecret: "whsec", client: client as unknown as StripeLike });
    const payment = await p.createPayment(req);
    expect(payment.status).toBe("succeeded");
    const [params, options] = (client.paymentIntents.create as ReturnType<typeof vi.fn>).mock.calls[0] as unknown as [Stripe.PaymentIntentCreateParams, Stripe.RequestOptions];
    expect(params).toMatchObject({ amount: 10000, currency: "aed", confirm: true, capture_method: "automatic", payment_method: "pm_card_visa" });
    expect(params.metadata).toMatchObject({ reference: "DE-TEST", kind: "payment", paymentId: "x" });
    expect(options).toEqual({ idempotencyKey: "key-1" });
  });

  it("maps a card decline to a failed payment", async () => {
    const declined = Object.assign(new Error("Your card was declined"), {
      type: "StripeCardError",
      payment_intent: intent({ status: "requires_payment_method", last_payment_error: { code: "card_declined", decline_code: "generic_decline" } as Stripe.PaymentIntent.LastPaymentError }),
    });
    const client = mockClient({ create: vi.fn(async () => Promise.reject(declined)) });
    const p = new StripePaymentProvider({ secretKey: "sk_test", webhookSecret: "whsec", client: client as unknown as StripeLike });
    const payment = await p.createPayment(req);
    expect(payment.status).toBe("failed");
    expect(payment.failureReason).toBe("generic_decline");
  });

  it("holds deposits with manual capture, releases by cancel and captures partially", async () => {
    const client = mockClient({ retrieve: vi.fn(async () => intent({ status: "requires_capture" })) });
    const p = new StripePaymentProvider({ secretKey: "sk_test", webhookSecret: "whsec", client: client as unknown as StripeLike });
    const hold = await p.holdDeposit(req);
    expect(hold.status).toBe("held");
    expect(((client.paymentIntents.create as ReturnType<typeof vi.fn>).mock.calls[0] as unknown as [Stripe.PaymentIntentCreateParams])[0].capture_method).toBe("manual");
    expect((await p.releaseDeposit("pi_1")).status).toBe("released");
    expect(client.paymentIntents.cancel).toHaveBeenCalledWith("pi_1");
    const captured = await p.captureDeposit("pi_1", 2500);
    expect(captured).toMatchObject({ status: "captured", amountCaptured: 2500 });
    expect(client.paymentIntents.capture).toHaveBeenCalledWith("pi_1", { amount_to_capture: 2500 });
  });

  it("refunds and reports the refunded amount from the latest charge", async () => {
    const client = mockClient({
      retrieve: vi.fn(async () => intent({ latest_charge: { amount_refunded: 4000 } as Stripe.Charge })),
    });
    const p = new StripePaymentProvider({ secretKey: "sk_test", webhookSecret: "whsec", client: client as unknown as StripeLike });
    const refunded = await p.refundPayment("pi_1", 4000);
    expect(client.refunds.create).toHaveBeenCalledWith({ payment_intent: "pi_1", amount: 4000 });
    expect(refunded).toMatchObject({ status: "partially_refunded", amountRefunded: 4000 });
  });

  it("verifies webhooks and maps events; bad signatures and unknown events are typed errors", () => {
    const client = mockClient();
    const p = new StripePaymentProvider({ secretKey: "sk_test", webhookSecret: "whsec", client: client as unknown as StripeLike });
    client.webhooks.constructEvent.mockReturnValueOnce({
      id: "evt_1",
      type: "payment_intent.amount_capturable_updated",
      created: 1_900_000_000,
      data: { object: intent({ status: "requires_capture", metadata: { kind: "deposit", reference: "DE-TEST" } }) },
    });
    const ev = p.verifyWebhook("{}", "t=1,v1=abc");
    expect(ev).toMatchObject({ id: "evt_1", type: "deposit.held" });
    expect(client.webhooks.constructEvent).toHaveBeenCalledWith("{}", "t=1,v1=abc", "whsec");

    client.webhooks.constructEvent.mockImplementationOnce(() => {
      throw new Error("No signatures found");
    });
    expect(() => p.verifyWebhook("{}", "bad")).toThrow(PaymentError);
    expect(() => p.verifyWebhook("{}", null)).toThrow(/Missing/);

    client.webhooks.constructEvent.mockReturnValueOnce({ id: "evt_2", type: "customer.created", created: 1, data: { object: {} } });
    try {
      p.verifyWebhook("{}", "sig");
      expect.unreachable();
    } catch (error) {
      expect((error as PaymentError).code).toBe(IGNORED_WEBHOOK_EVENT);
    }
  });

  it("maps payment and refund events", () => {
    expect(mapStripeEvent({ id: "e", type: "payment_intent.succeeded", created: 1, data: { object: intent({}) } } as unknown as Stripe.Event)?.type).toBe("payment.succeeded");
    expect(
      mapStripeEvent({ id: "e", type: "payment_intent.canceled", created: 1, data: { object: intent({ status: "canceled", metadata: { kind: "deposit" } }) } } as unknown as Stripe.Event)?.type,
    ).toBe("deposit.released");
    const refund = mapStripeEvent({
      id: "e",
      type: "charge.refunded",
      created: 1,
      data: { object: { payment_intent: "pi_1", amount: 10000, amount_refunded: 10000, currency: "aed", metadata: {} } },
    } as unknown as Stripe.Event);
    expect(refund).toMatchObject({ type: "payment.refunded", data: { id: "pi_1", status: "refunded" } });
  });
});
