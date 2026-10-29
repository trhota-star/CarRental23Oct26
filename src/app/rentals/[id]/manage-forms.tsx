"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/_lib/action-result";
import { Alert } from "@/components/ui/feedback";
import { Field, Textarea } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { cancelAction, modifyAction } from "./actions";

export function CancelForm({ reservationId, summary }: { reservationId: string; summary: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(cancelAction, {});
  if (state.ok) return <Alert tone="success">{state.message}</Alert>;
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="reservationId" value={reservationId} />
      <p className="text-sm text-ink-700">{summary}</p>
      <Field label="Reason" htmlFor="cancel-reason" optional>
        <Textarea id="cancel-reason" name="reason" maxLength={500} rows={2} />
      </Field>
      <label className="flex items-start gap-2 text-sm text-ink-800">
        <input type="checkbox" name="confirm" value="yes" required className="mt-0.5 size-4 accent-danger-700" />
        I understand and want to cancel this booking.
      </label>
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      <SubmitButton variant="danger" pending={pending} pendingLabel="Cancelling…">
        Cancel booking
      </SubmitButton>
    </form>
  );
}

/** Confirms a previewed date change; asks for a test outcome when extra payment is due. */
export function ConfirmModifyForm({
  hidden,
  needsPayment,
  label,
}: {
  hidden: Record<string, string>;
  needsPayment: boolean;
  label: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(modifyAction, {});
  return (
    <form action={action} className="space-y-3">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {needsPayment ? (
        <fieldset className="space-y-1.5 rounded-xl border border-gold-300 bg-gold-50 p-3">
          <legend className="px-1 text-xs font-bold tracking-wide text-gold-700 uppercase">Test mode payment</legend>
          {(
            [
              ["success", "Approve the extra charge"],
              ["decline", "Decline the card"],
              ["cancel", "Cancel at the bank step"],
            ] as const
          ).map(([value, text], i) => (
            <label key={value} className="flex items-center gap-2 text-sm text-ink-800">
              <input type="radio" name="outcome" value={value} defaultChecked={i === 0} className="accent-ink-900" />
              {text}
            </label>
          ))}
        </fieldset>
      ) : null}
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      <SubmitButton variant="primary" pending={pending} pendingLabel="Updating…">
        {label}
      </SubmitButton>
    </form>
  );
}
