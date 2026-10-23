// Inspect the fake payment provider and replay webhooks.
//   pnpm fake-payments events                     list recorded webhook events
//   pnpm fake-payments resend <eventId> [times]   redeliver an event (duplicates)

import { FakePaymentProvider } from "../src/server/payments/fake";
import { getPaymentProvider } from "../src/server/payments";
import { loadLocalEnv } from "./load-env";

async function main() {
  loadLocalEnv();
  const provider = getPaymentProvider();
  if (!(provider instanceof FakePaymentProvider)) throw new Error("PAYMENT_PROVIDER is not 'fake'");

  const [command, eventId, times] = process.argv.slice(2);
  if (command === "events") {
    for (const e of await provider.listEvents()) {
      console.log(`${e.createdAt}  ${e.id}  ${e.type.padEnd(18)} ${e.data.id}  delivered×${e.deliveries}`);
    }
  } else if (command === "resend" && eventId) {
    const delivered = await provider.resendWebhook(eventId, Number(times ?? 1));
    console.log(`Delivered ${delivered} time(s) to ${process.env.PAYMENT_WEBHOOK_URL ?? "(no PAYMENT_WEBHOOK_URL)"}`);
  } else {
    console.error("Usage: pnpm fake-payments events | resend <eventId> [times]");
    process.exit(1);
  }
}

main();
