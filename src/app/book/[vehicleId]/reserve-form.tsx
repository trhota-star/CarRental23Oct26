"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/feedback";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionState } from "@/app/_lib/action-result";
import { reserveAction } from "./actions";

export function ReserveForm({ hidden, disabled }: { hidden: Record<string, string>; disabled?: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(reserveAction, {});
  return (
    <form action={action} className="space-y-3">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {state.error ? (
        <Alert tone="danger" title={state.code === "VEHICLE_UNAVAILABLE" ? "This car was just booked" : undefined}>
          {state.error}
        </Alert>
      ) : null}
      <SubmitButton
        variant="accent"
        size="lg"
        className="w-full"
        pending={pending}
        pendingLabel="Reserving…"
        disabled={disabled}
      >
        Reserve and continue
      </SubmitButton>
      <p className="text-center text-xs text-ink-500">
        We hold the car for you for a few minutes while you add driver details and pay.
      </p>
    </form>
  );
}
