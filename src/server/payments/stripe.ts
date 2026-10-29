// Stripe implementation of PaymentProvider (PaymentIntents). Written, unit-tested
// with a mocked client, NOT connected: it is only used when PAYMENT_PROVIDER=stripe.
//
// - Rental charge: PaymentIntent, confirmed server-side with the given payment method.
// - Deposit: PaymentIntent with capture_method "manual" (an authorisation hold).
//   release = cancel the intent, capture = capture (partial amounts allowed).
// - Refunds: Refund against the intent.
// - Webhooks: verified with stripe.webhooks.constructEvent on the raw body and mapped
//   to provider-neutral events. metadata.kind ("payment" | "deposit") tells them apart.

import Stripe from "stripe";
import {
  IGNORED_WEBHOOK_EVENT,
  PaymentError,
  type DepositHold,
  type DepositHoldStatus,
  type Payment,
  type PaymentProvider,
  type PaymentRequest,
  type PaymentStatus,
  type PaymentWebhookEvent,
  type PaymentWebhookEventType,
} from "./types";

/** The subset of the Stripe SDK this adapter uses (lets tests pass a mock). */
export type StripeLike = {
  paymentIntents: {
    create(params: Stripe.PaymentIntentCreateParams, options?: Stripe.RequestOptions): Promise<Stripe.PaymentIntent>;
    retrieve(id: string, params?: Stripe.PaymentIntentRetrieveParams): Promise<Stripe.PaymentIntent>;
    cancel(id: string, params?: Stripe.PaymentIntentCancelParams): Promise<Stripe.PaymentIntent>;
    capture(id: string, params?: Stripe.PaymentIntentCaptureParams): Promise<Stripe.PaymentIntent>;
  };
  refunds: { create(params: Stripe.RefundCreateParams, options?: Stripe.RequestOptions): Promise<Stripe.Refund> };
  webhooks: { constructEvent(payload: string | Buffer, header: string, secret: string): Stripe.Event };
};

export type StripeOptions = { secretKey: string; webhookSecret: string; client?: StripeLike };


function meta(pi: Stripe.PaymentIntent): Record<string, string> {
  return { ...(pi.metadata ?? {}) } as Record<string, string>;
}

function failureReason(pi: Stripe.PaymentIntent): string | undefined {
  return pi.last_payment_error?.decline_code ?? pi.last_payment_error?.code ?? undefined;
}

function refundedAmount(pi: Stripe.PaymentIntent): number {
  const charge = pi.latest_charge;
  return charge && typeof charge === "object" ? charge.amount_refunded : 0;
}

export function toPayment(pi: Stripe.PaymentIntent): Payment {
  const refunded = refundedAmount(pi);
  let status: PaymentStatus;
  if (pi.status === "succeeded") status = refunded >= pi.amount ? "refunded" : refunded > 0 ? "partially_refunded" : "succeeded";
  else if (pi.status === "canceled") status = "canceled";
  else if (pi.status === "requires_payment_method" && pi.last_payment_error) status = "failed";
  else status = "pending";
  return {
    id: pi.id,
    amount: pi.amount,
    currency: pi.currency,
    status,
    reference: meta(pi).reference ?? "",
    amountRefunded: refunded,
    failureReason: status === "failed" ? failureReason(pi) : undefined,
    metadata: meta(pi),
    createdAt: new Date(pi.created * 1000).toISOString(),
  };
}

export function toDepositHold(pi: Stripe.PaymentIntent): DepositHold {
  let status: DepositHoldStatus;
  if (pi.status === "requires_capture") status = "held";
  else if (pi.status === "succeeded") status = "captured";
  else if (pi.status === "canceled") status = "released";
  else status = "failed";
  return {
    id: pi.id,
    amount: pi.amount,
    currency: pi.currency,
    status,
    reference: meta(pi).reference ?? "",
    amountCaptured: pi.status === "succeeded" ? pi.amount_received : 0,
    failureReason: status === "failed" ? (failureReason(pi) ?? pi.status) : undefined,
    metadata: meta(pi),
    createdAt: new Date(pi.created * 1000).toISOString(),
  };
}

function wrap(error: unknown): never {
  if (error instanceof PaymentError) throw error;
  const e = error as { type?: string; code?: string; message?: string };
  throw new PaymentError(e.message ?? "Stripe request failed", e.code ?? e.type ?? "stripe_error");
}

export class StripePaymentProvider implements PaymentProvider {
  readonly name = "stripe";
  readonly webhookSignatureHeader = "stripe-signature";
  private readonly stripe: StripeLike;

  constructor(private readonly options: StripeOptions) {
    this.stripe = options.client ?? (new Stripe(options.secretKey) as unknown as StripeLike);
  }

  private async createIntent(input: PaymentRequest, kind: "payment" | "deposit"): Promise<Stripe.PaymentIntent> {
    try {
      return await this.stripe.paymentIntents.create(
        {
          amount: input.amount,
          currency: input.currency.toLowerCase(),
          payment_method: input.paymentMethod,
          confirm: true,
          capture_method: kind === "deposit" ? "manual" : "automatic",
          automatic_payment_methods: { enabled: true, allow_redirects: "never" },
          description: `DriveEasy ${kind === "deposit" ? "security deposit" : "rental"} ${input.reference}`,
          metadata: { ...input.metadata, reference: input.reference, kind },
        },
        { idempotencyKey: input.idempotencyKey },
      );
    } catch (error) {
      // Card declines throw but carry the failed intent.
      const pi = (error as { payment_intent?: Stripe.PaymentIntent; raw?: { payment_intent?: Stripe.PaymentIntent } }).payment_intent ??
        (error as { raw?: { payment_intent?: Stripe.PaymentIntent } }).raw?.payment_intent;
      if (pi) return pi;
      wrap(error);
    }
  }

  async createPayment(input: PaymentRequest): Promise<Payment> {
    return toPayment(await this.createIntent(input, "payment"));
  }

  async cancelPayment(paymentId: string): Promise<Payment> {
    try {
      const current = await this.stripe.paymentIntents.retrieve(paymentId);
      if (current.status === "canceled") return toPayment(current);
      if (current.status === "succeeded") throw new PaymentError("Cannot cancel a succeeded payment; refund it instead", "invalid_state");
      return toPayment(await this.stripe.paymentIntents.cancel(paymentId));
    } catch (error) {
      wrap(error);
    }
  }

  async refundPayment(paymentId: string, amount?: number): Promise<Payment> {
    try {
      await this.stripe.refunds.create({ payment_intent: paymentId, ...(amount ? { amount } : {}) });
      return toPayment(await this.stripe.paymentIntents.retrieve(paymentId, { expand: ["latest_charge"] }));
    } catch (error) {
      wrap(error);
    }
  }

  async holdDeposit(input: PaymentRequest): Promise<DepositHold> {
    return toDepositHold(await this.createIntent(input, "deposit"));
  }

  async releaseDeposit(holdId: string): Promise<DepositHold> {
    try {
      const current = await this.stripe.paymentIntents.retrieve(holdId);
      if (current.status === "canceled") return toDepositHold(current);
      if (current.status !== "requires_capture") throw new PaymentError(`Cannot release a ${current.status} deposit`, "invalid_state");
      return toDepositHold(await this.stripe.paymentIntents.cancel(holdId));
    } catch (error) {
      wrap(error);
    }
  }

  async captureDeposit(holdId: string, amount?: number): Promise<DepositHold> {
    try {
      return toDepositHold(await this.stripe.paymentIntents.capture(holdId, amount ? { amount_to_capture: amount } : {}));
    } catch (error) {
      wrap(error);
    }
  }

  verifyWebhook(rawBody: string, signature: string | null): PaymentWebhookEvent {
    if (!signature) throw new PaymentError("Missing webhook signature", "invalid_signature");
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, this.options.webhookSecret);
    } catch (error) {
      throw new PaymentError((error as Error).message || "Webhook signature mismatch", "invalid_signature");
    }
    const mapped = mapStripeEvent(event);
    if (!mapped) throw new PaymentError(`Ignored Stripe event ${event.type}`, IGNORED_WEBHOOK_EVENT);
    return mapped;
  }
}

/** Stripe event → provider-neutral event, or null when we don't act on it. */
export function mapStripeEvent(event: Stripe.Event): PaymentWebhookEvent | null {
  const createdAt = new Date(event.created * 1000).toISOString();
  if (event.type.startsWith("payment_intent.")) {
    const pi = event.data.object as Stripe.PaymentIntent;
    const isDeposit = pi.metadata?.kind === "deposit";
    const table: Record<string, [PaymentWebhookEventType, PaymentWebhookEventType] | undefined> = {
      "payment_intent.succeeded": ["payment.succeeded", "deposit.captured"],
      "payment_intent.payment_failed": ["payment.failed", "deposit.failed"],
      "payment_intent.canceled": ["payment.canceled", "deposit.released"],
      "payment_intent.amount_capturable_updated": [undefined as never, "deposit.held"],
    };
    const pair = table[event.type];
    const type = pair?.[isDeposit ? 1 : 0];
    if (!type) return null;
    return { id: event.id, type, createdAt, data: isDeposit ? toDepositHold(pi) : toPayment(pi) };
  }
  if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    if (typeof charge.payment_intent !== "string" || charge.metadata?.kind === "deposit") return null;
    const data: Payment = {
      id: charge.payment_intent,
      amount: charge.amount,
      currency: charge.currency,
      status: charge.amount_refunded >= charge.amount ? "refunded" : "partially_refunded",
      reference: charge.metadata?.reference ?? "",
      amountRefunded: charge.amount_refunded,
      metadata: { ...(charge.metadata ?? {}) } as Record<string, string>,
      createdAt,
    };
    return { id: event.id, type: "payment.refunded", createdAt, data };
  }
  return null;
}
