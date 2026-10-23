// Provider-neutral payment interface. App code depends only on this file;
// the concrete provider is chosen by the PAYMENT_PROVIDER setting.

/** Amounts are in minor units (cents). */
export type Money = { amount: number; currency: string };

export type PaymentStatus =
  | "pending"
  | "succeeded"
  | "failed"
  | "canceled"
  | "refunded"
  | "partially_refunded";

export type DepositHoldStatus = "held" | "failed" | "released" | "captured";

export type Payment = Money & {
  id: string;
  status: PaymentStatus;
  reference: string;
  amountRefunded: number;
  failureReason?: string;
  metadata: Record<string, string>;
  createdAt: string;
};

export type DepositHold = Money & {
  id: string;
  status: DepositHoldStatus;
  reference: string;
  amountCaptured: number;
  failureReason?: string;
  metadata: Record<string, string>;
  createdAt: string;
};

export type PaymentRequest = Money & {
  /** Your own id for what is being paid for, e.g. a booking id. */
  reference: string;
  /** Same key → same result, no second charge. */
  idempotencyKey: string;
  /** Provider payment-method token. */
  paymentMethod: string;
  metadata?: Record<string, string>;
};

export type PaymentWebhookEventType =
  | "payment.succeeded"
  | "payment.failed"
  | "payment.canceled"
  | "payment.refunded"
  | "deposit.held"
  | "deposit.failed"
  | "deposit.released"
  | "deposit.captured";

export type PaymentWebhookEvent = {
  /** Stable across redeliveries. Store it to ignore duplicates. */
  id: string;
  type: PaymentWebhookEventType;
  createdAt: string;
  data: Payment | DepositHold;
};

export interface PaymentProvider {
  readonly name: string;
  /** HTTP header carrying the webhook signature. */
  readonly webhookSignatureHeader: string;

  createPayment(input: PaymentRequest): Promise<Payment>;
  cancelPayment(paymentId: string): Promise<Payment>;
  /** Omit amount for a full refund. */
  refundPayment(paymentId: string, amount?: number): Promise<Payment>;

  holdDeposit(input: PaymentRequest): Promise<DepositHold>;
  releaseDeposit(holdId: string): Promise<DepositHold>;
  /** Omit amount to capture the full hold. */
  captureDeposit(holdId: string, amount?: number): Promise<DepositHold>;

  /** Verifies the signature and returns the event, or throws. */
  verifyWebhook(rawBody: string, signature: string | null): PaymentWebhookEvent;
}

export class PaymentError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "PaymentError";
  }
}
