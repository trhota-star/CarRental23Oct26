"use client";

import { Loader2 } from "lucide-react";
import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import { Button, type ButtonSize, type ButtonVariant } from "./button";

type Props = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  pendingLabel?: string;
  /** Pass a pending flag from useActionState; falls back to the parent form's status. */
  pending?: boolean;
};

/** Submit button that disables itself and shows a spinner while its form is submitting. */
export function SubmitButton({ children, pendingLabel, pending, disabled, ...props }: Props) {
  const status = useFormStatus();
  const isPending = pending ?? status.pending;
  return (
    <Button type="submit" disabled={disabled || isPending} aria-busy={isPending} {...props}>
      {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {isPending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}
