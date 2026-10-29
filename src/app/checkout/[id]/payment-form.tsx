"use client";

import { CreditCard, FlaskConical, Lock } from "lucide-react";
import { useActionState } from "react";
import { Alert } from "@/components/ui/feedback";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/cn";
import { payAction, type PayState } from "./actions";

const OUTCOMES = [
  { value: "success", label: "Approve", help: "Payment and deposit succeed; booking is confirmed." },
  { value: "decline", label: "Decline", help: "The card is declined; nothing is charged." },
  { value: "cancel", label: "Cancel", help: "You abandon the payment at the bank step." },
  { value: "pending", label: "Pending", help: "The bank is slow; confirmation arrives by webhook." },
] as const;

/**
 * TEST MODE payment form for the local fake provider. No card data is
 * collected: the customer picks the outcome the fake provider should return.
 */
export function PaymentForm({
  reservationId,
  idempotencyKey,
  totalLabel,
  depositLabel,
  disabled,
}: {
  reservationId: string;
  idempotencyKey: string;
  totalLabel: string;
  depositLabel: string;
  disabled?: boolean;
}) {
  const [state, action, pending] = useActionState<PayState, FormData>(payAction, {});
  const key = state.nextKey ?? idempotencyKey;
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="reservationId" value={reservationId} />
      <input type="hidden" name="idempotencyKey" value={key} />
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-ink-800 to-ink-950 p-5 text-white shadow-lift">
        <span className="absolute top-3 right-3 inline-flex items-center gap-1 rounded-full bg-gold-400 px-2.5 py-1 text-xs font-bold tracking-wide text-ink-950 uppercase">
          <FlaskConical className="size-3.5" aria-hidden /> Test mode
        </span>
        <CreditCard className="size-7 text-gold-300" aria-hidden />
        <p className="mt-6 font-mono text-lg tracking-widest">4242 4242 4242 4242</p>
        <div className="mt-3 flex justify-between text-xs text-ink-300">
          <span>DRIVEEASY TEST CARD</span>
          <span>12/34 · CVC 123</span>
        </div>
      </div>
      <p className="text-sm text-ink-600">
        This is a local test environment. No real card is used and no money moves. Choose what the test bank should
        do:
      </p>
      <fieldset className="space-y-2" disabled={disabled || pending}>
        <legend className="sr-only">Test payment outcome</legend>
        {OUTCOMES.map((o, i) => (
          <label
            key={o.value}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-xl border border-ink-200 bg-white p-3",
              "has-[:checked]:border-ink-900 has-[:checked]:ring-2 has-[:checked]:ring-ink-900/10",
            )}
          >
            <input type="radio" name="outcome" value={o.value} defaultChecked={i === 0} className="mt-1 accent-ink-900" />
            <span>
              <span className="block text-sm font-semibold text-ink-900">{o.label}</span>
              <span className="block text-xs text-ink-600">{o.help}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {state.error ? (
        <Alert tone="danger" title="Payment not completed">
          {state.error}
        </Alert>
      ) : null}
      {state.ok && state.message ? <Alert tone="info">{state.message}</Alert> : null}
      <SubmitButton
        variant="accent"
        size="lg"
        className="w-full"
        pending={pending}
        pendingLabel="Processing…"
        disabled={disabled}
      >
        <Lock className="size-4" aria-hidden /> Pay {totalLabel}
      </SubmitButton>
      <p className="text-center text-xs text-ink-500">
        A refundable deposit of {depositLabel} will also be held on the card.
      </p>
    </form>
  );
}
