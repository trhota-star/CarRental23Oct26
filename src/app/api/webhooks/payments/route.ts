// POST /api/webhooks/payments — payment provider webhooks.
// The raw body is verified by the configured provider (fake HMAC or Stripe).
// Duplicate deliveries (same event id) are acknowledged and ignored.

import { getPaymentProvider, IGNORED_WEBHOOK_EVENT, PaymentError } from "@/server/payments";
import { handlePaymentWebhook } from "@/server/reservations";
import { log } from "@/server/log";

export async function POST(request: Request): Promise<Response> {
  const provider = getPaymentProvider();
  const rawBody = await request.text();
  const signature = request.headers.get(provider.webhookSignatureHeader);
  try {
    const result = await handlePaymentWebhook(rawBody, signature, { provider });
    return Response.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof PaymentError && error.code === IGNORED_WEBHOOK_EVENT) {
      return Response.json({ status: "ignored" }, { status: 200 });
    }
    if (error instanceof PaymentError) {
      log.warn("webhook.rejected", { code: error.code, message: error.message });
      return Response.json({ error: "invalid_signature" }, { status: 400 });
    }
    log.error("webhook.failed", { error });
    // 500 → the provider retries later; dedup makes the retry safe.
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
