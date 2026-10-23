// Local stand-in for a real payment provider. State lives in a JSON file so the
// dev server, scripts and tests all see the same payments.
//
// Choose the outcome with the paymentMethod token:
//   pm_fake_success  → payment succeeds / deposit is held (default)
//   pm_fake_decline  → payment fails / deposit hold fails
//   pm_fake_cancel   → customer cancels at checkout
//   pm_fake_pending  → payment stays pending until cancelPayment()

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  PaymentError,
  type DepositHold,
  type Payment,
  type PaymentProvider,
  type PaymentRequest,
  type PaymentWebhookEvent,
  type PaymentWebhookEventType,
} from "./types";

export const FAKE_PAYMENT_METHODS = {
  success: "pm_fake_success",
  decline: "pm_fake_decline",
  cancel: "pm_fake_cancel",
  pending: "pm_fake_pending",
} as const;

const SIGNATURE_TOLERANCE_SECONDS = 300;

type StoredEvent = PaymentWebhookEvent & { deliveries: number };

type Store = {
  payments: Record<string, Payment>;
  holds: Record<string, DepositHold>;
  idempotency: Record<string, string>;
  events: StoredEvent[];
};

export type FakePaymentOptions = {
  /** JSON file holding fake provider state. */
  stateFile: string;
  webhookSecret: string;
  /** Where to POST webhooks. Unset → events are only recorded. */
  webhookUrl?: string;
  /** Deliver every webhook twice, to exercise duplicate handling. */
  duplicateWebhooks?: boolean;
};

export class FakePaymentProvider implements PaymentProvider {
  readonly name = "fake";
  readonly webhookSignatureHeader = "x-fake-payments-signature";
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: FakePaymentOptions) {}

  createPayment(input: PaymentRequest): Promise<Payment> {
    return this.mutate(async (store) => {
      const existing = this.fromIdempotencyKey(store, "payment", input.idempotencyKey);
      if (existing) return { result: store.payments[existing], events: [] };

      const outcome = outcomeFor(input.paymentMethod);
      const payment: Payment = {
        id: `fpay_${randomUUID()}`,
        amount: input.amount,
        currency: input.currency,
        reference: input.reference,
        metadata: input.metadata ?? {},
        amountRefunded: 0,
        createdAt: new Date().toISOString(),
        status:
          outcome === "success"
            ? "succeeded"
            : outcome === "decline"
              ? "failed"
              : outcome === "cancel"
                ? "canceled"
                : "pending",
        failureReason: outcome === "decline" ? "card_declined" : undefined,
      };
      store.payments[payment.id] = payment;
      store.idempotency[`payment:${input.idempotencyKey}`] = payment.id;

      const type: PaymentWebhookEventType | null =
        payment.status === "succeeded"
          ? "payment.succeeded"
          : payment.status === "failed"
            ? "payment.failed"
            : payment.status === "canceled"
              ? "payment.canceled"
              : null;
      return { result: payment, events: type ? [{ type, data: payment }] : [] };
    });
  }

  cancelPayment(paymentId: string): Promise<Payment> {
    return this.mutate(async (store) => {
      const payment = getOrThrow(store.payments, paymentId);
      if (payment.status === "canceled") return { result: payment, events: [] };
      if (payment.status !== "pending") {
        throw new PaymentError(`Cannot cancel a ${payment.status} payment; refund it instead`, "invalid_state");
      }
      payment.status = "canceled";
      return { result: payment, events: [{ type: "payment.canceled", data: payment }] };
    });
  }

  refundPayment(paymentId: string, amount?: number): Promise<Payment> {
    return this.mutate(async (store) => {
      const payment = getOrThrow(store.payments, paymentId);
      if (payment.status !== "succeeded" && payment.status !== "partially_refunded") {
        throw new PaymentError(`Cannot refund a ${payment.status} payment`, "invalid_state");
      }
      const refundable = payment.amount - payment.amountRefunded;
      const refund = amount ?? refundable;
      if (refund <= 0 || refund > refundable) {
        throw new PaymentError(`Refund must be between 1 and ${refundable}`, "invalid_amount");
      }
      payment.amountRefunded += refund;
      payment.status = payment.amountRefunded === payment.amount ? "refunded" : "partially_refunded";
      return { result: payment, events: [{ type: "payment.refunded", data: payment }] };
    });
  }

  holdDeposit(input: PaymentRequest): Promise<DepositHold> {
    return this.mutate(async (store) => {
      const existing = this.fromIdempotencyKey(store, "hold", input.idempotencyKey);
      if (existing) return { result: store.holds[existing], events: [] };

      const succeeded = outcomeFor(input.paymentMethod) === "success";
      const hold: DepositHold = {
        id: `fhold_${randomUUID()}`,
        amount: input.amount,
        currency: input.currency,
        reference: input.reference,
        metadata: input.metadata ?? {},
        amountCaptured: 0,
        createdAt: new Date().toISOString(),
        status: succeeded ? "held" : "failed",
        failureReason: succeeded ? undefined : "card_declined",
      };
      store.holds[hold.id] = hold;
      store.idempotency[`hold:${input.idempotencyKey}`] = hold.id;
      return {
        result: hold,
        events: [{ type: succeeded ? "deposit.held" : "deposit.failed", data: hold }],
      };
    });
  }

  releaseDeposit(holdId: string): Promise<DepositHold> {
    return this.mutate(async (store) => {
      const hold = getOrThrow(store.holds, holdId);
      if (hold.status === "released") return { result: hold, events: [] };
      if (hold.status !== "held") {
        throw new PaymentError(`Cannot release a ${hold.status} deposit`, "invalid_state");
      }
      hold.status = "released";
      return { result: hold, events: [{ type: "deposit.released", data: hold }] };
    });
  }

  captureDeposit(holdId: string, amount?: number): Promise<DepositHold> {
    return this.mutate(async (store) => {
      const hold = getOrThrow(store.holds, holdId);
      if (hold.status !== "held") {
        throw new PaymentError(`Cannot capture a ${hold.status} deposit`, "invalid_state");
      }
      const capture = amount ?? hold.amount;
      if (capture <= 0 || capture > hold.amount) {
        throw new PaymentError(`Capture must be between 1 and ${hold.amount}`, "invalid_amount");
      }
      hold.amountCaptured = capture;
      hold.status = "captured";
      return { result: hold, events: [{ type: "deposit.captured", data: hold }] };
    });
  }

  verifyWebhook(rawBody: string, signature: string | null): PaymentWebhookEvent {
    if (!signature) throw new PaymentError("Missing webhook signature", "invalid_signature");
    const parts = Object.fromEntries(signature.split(",").map((p) => p.split("=", 2)));
    const timestamp = Number(parts.t);
    if (!Number.isFinite(timestamp) || !parts.v1) {
      throw new PaymentError("Malformed webhook signature", "invalid_signature");
    }
    if (Math.abs(Date.now() / 1000 - timestamp) > SIGNATURE_TOLERANCE_SECONDS) {
      throw new PaymentError("Webhook signature expired", "invalid_signature");
    }
    const expected = Buffer.from(this.sign(timestamp, rawBody), "hex");
    const given = Buffer.from(parts.v1, "hex");
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      throw new PaymentError("Webhook signature mismatch", "invalid_signature");
    }
    return JSON.parse(rawBody) as PaymentWebhookEvent;
  }

  // ---- Fake-only helpers (not part of PaymentProvider) ----

  async listEvents(): Promise<StoredEvent[]> {
    return (await this.load()).events;
  }

  /** Builds a signed webhook request, as the provider would send it. */
  signedWebhook(event: PaymentWebhookEvent): { body: string; headers: Record<string, string> } {
    const body = JSON.stringify({ id: event.id, type: event.type, createdAt: event.createdAt, data: event.data });
    const t = Math.floor(Date.now() / 1000);
    return {
      body,
      headers: {
        "content-type": "application/json",
        [this.webhookSignatureHeader]: `t=${t},v1=${this.sign(t, body)}`,
      },
    };
  }

  /** Re-sends a recorded event (same id) `times` times. */
  async resendWebhook(eventId: string, times = 1): Promise<number> {
    const event = (await this.load()).events.find((e) => e.id === eventId);
    if (!event) throw new PaymentError(`Unknown event ${eventId}`, "not_found");
    let delivered = 0;
    for (let i = 0; i < times; i++) if (await this.deliver(event)) delivered++;
    await this.mutate(async (store) => {
      const stored = store.events.find((e) => e.id === eventId);
      if (stored) stored.deliveries += delivered;
      return { result: null, events: [] };
    });
    return delivered;
  }

  // ---- internals ----

  private sign(timestamp: number, body: string): string {
    return createHmac("sha256", this.options.webhookSecret).update(`${timestamp}.${body}`).digest("hex");
  }

  private fromIdempotencyKey(store: Store, kind: "payment" | "hold", key: string): string | undefined {
    return store.idempotency[`${kind}:${key}`];
  }

  private async load(): Promise<Store> {
    try {
      return JSON.parse(await readFile(this.options.stateFile, "utf8")) as Store;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { payments: {}, holds: {}, idempotency: {}, events: [] };
    }
  }

  private async save(store: Store): Promise<void> {
    await mkdir(path.dirname(this.options.stateFile), { recursive: true });
    await writeFile(this.options.stateFile, JSON.stringify(store, null, 2));
  }

  /** Serialises state changes, then delivers any webhooks they produced. */
  private mutate<T>(
    change: (store: Store) => Promise<{
      result: T;
      events: { type: PaymentWebhookEventType; data: Payment | DepositHold }[];
    }>,
  ): Promise<T> {
    const run = this.queue.then(async () => {
      const store = await this.load();
      const { result, events } = await change(store);
      const created: StoredEvent[] = events.map((e) => ({
        id: `fevt_${randomUUID()}`,
        type: e.type,
        createdAt: new Date().toISOString(),
        data: structuredClone(e.data),
        deliveries: 0,
      }));
      store.events.push(...created);
      await this.save(store);
      return { result: structuredClone(result), created };
    });
    this.queue = run.catch(() => undefined);
    return run.then(async ({ result, created }) => {
      const copies = this.options.duplicateWebhooks ? 2 : 1;
      for (const event of created) {
        if (this.options.webhookUrl) await this.resendWebhook(event.id, copies);
      }
      return result;
    });
  }

  private async deliver(event: PaymentWebhookEvent): Promise<boolean> {
    if (!this.options.webhookUrl) return false;
    const { body, headers } = this.signedWebhook(event);
    try {
      const res = await fetch(this.options.webhookUrl, { method: "POST", headers, body });
      if (!res.ok) console.warn(`[fake-payments] webhook ${event.id} → HTTP ${res.status}`);
      return res.ok;
    } catch (error) {
      console.warn(`[fake-payments] webhook ${event.id} not delivered: ${(error as Error).message}`);
      return false;
    }
  }
}

function outcomeFor(paymentMethod: string): "success" | "decline" | "cancel" | "pending" {
  switch (paymentMethod) {
    case FAKE_PAYMENT_METHODS.decline:
      return "decline";
    case FAKE_PAYMENT_METHODS.cancel:
      return "cancel";
    case FAKE_PAYMENT_METHODS.pending:
      return "pending";
    default:
      return "success";
  }
}

function getOrThrow<T>(records: Record<string, T>, id: string): T {
  const record = records[id];
  if (!record) throw new PaymentError(`Unknown id ${id}`, "not_found");
  return record;
}
