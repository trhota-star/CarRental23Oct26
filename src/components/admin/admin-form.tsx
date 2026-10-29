"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import type { ActionState } from "@/app/_lib/action-result";
import type { ButtonVariant } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/cn";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * Generic form for admin Server Actions: shows the result (with any
 * per-field validation messages from the server) and a pending submit button.
 */
export function AdminForm({
  action,
  hidden,
  children,
  submitLabel,
  pendingLabel = "Saving…",
  variant = "primary",
  className,
  resetOnSuccess = false,
  confirmText,
}: {
  action: Action;
  hidden?: Record<string, string>;
  children?: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  variant?: ButtonVariant;
  className?: string;
  resetOnSuccess?: boolean;
  /** Native confirm() prompt before submitting (destructive actions). */
  confirmText?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  const fieldMessages = Object.entries(state.fieldErrors ?? {}).flatMap(([k, v]) =>
    (v ?? []).map((m) => `${k}: ${m}`),
  );
  return (
    <form
      ref={ref}
      action={formAction}
      className={cn("space-y-4", className)}
      onSubmit={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
    >
      {hidden
        ? Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)
        : null}
      {children}
      {state.error ? (
        <Alert tone="danger" title={state.error}>
          {fieldMessages.length ? (
            <ul className="list-inside list-disc">
              {fieldMessages.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}
      {state.ok && state.message ? <Alert tone="success">{state.message}</Alert> : null}
      <SubmitButton variant={variant} pending={pending} pendingLabel={pendingLabel}>
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
