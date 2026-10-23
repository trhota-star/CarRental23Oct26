import path from "node:path";
import { requireEnv } from "../config";
import { FakePaymentProvider } from "./fake";
import type { PaymentProvider } from "./types";

export * from "./types";

let provider: PaymentProvider | undefined;

/** Returns the provider named by PAYMENT_PROVIDER (default "fake"). */
export function getPaymentProvider(): PaymentProvider {
  if (provider) return provider;
  const name = process.env.PAYMENT_PROVIDER ?? "fake";
  switch (name) {
    case "fake":
      provider = new FakePaymentProvider({
        stateFile: path.resolve(process.env.FAKE_PAYMENTS_STATE_FILE ?? ".local/fake-payments.json"),
        webhookSecret: requireEnv("PAYMENT_WEBHOOK_SECRET"),
        webhookUrl: process.env.PAYMENT_WEBHOOK_URL || undefined,
        duplicateWebhooks: process.env.FAKE_PAYMENTS_DUPLICATE_WEBHOOKS === "true",
      });
      return provider;
    // case "stripe": add a StripePaymentProvider implementing PaymentProvider.
    default:
      throw new Error(`PAYMENT_PROVIDER "${name}" is not implemented yet`);
  }
}
