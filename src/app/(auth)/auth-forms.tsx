"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert } from "@/components/ui/feedback";
import { describedBy, Field, Input } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { loginAction, registerAction, type AuthFormState } from "./actions";

const initial: AuthFormState = {};

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(loginAction, initial);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-5" noValidate>
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <Field label="Email" htmlFor="email" error={fe.email}>
        <Input
          {...describedBy("email", fe.email)}
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.values?.email}
        />
      </Field>
      <Field label="Password" htmlFor="password" error={fe.password}>
        <Input
          {...describedBy("password", fe.password)}
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      <SubmitButton pending={pending} pendingLabel="Signing in…" className="w-full" size="lg">
        Sign in
      </SubmitButton>
      <p className="text-center text-sm text-ink-600">
        New to DriveEasy?{" "}
        <Link
          href={next ? `/register?next=${encodeURIComponent(next)}` : "/register"}
          className="font-semibold text-ink-900 underline underline-offset-4"
        >
          Create an account
        </Link>
      </p>
    </form>
  );
}

export function RegisterForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(registerAction, initial);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-5" noValidate>
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <Field label="Full name" htmlFor="name" error={fe.name} hint="As shown on your driving licence.">
        <Input
          {...describedBy("name", fe.name, true)}
          name="name"
          autoComplete="name"
          required
          defaultValue={state.values?.name}
        />
      </Field>
      <Field label="Email" htmlFor="email" error={fe.email}>
        <Input
          {...describedBy("email", fe.email)}
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.values?.email}
        />
      </Field>
      <Field
        label="Password"
        htmlFor="password"
        error={fe.password}
        hint="At least 8 characters, with a letter and a number."
      >
        <Input
          {...describedBy("password", fe.password, true)}
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
        />
      </Field>
      <Field label="Confirm password" htmlFor="confirmPassword" error={fe.confirmPassword}>
        <Input
          {...describedBy("confirmPassword", fe.confirmPassword)}
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
        />
      </Field>
      <SubmitButton pending={pending} pendingLabel="Creating account…" className="w-full" size="lg">
        Create account
      </SubmitButton>
      <p className="text-center text-sm text-ink-600">
        Already have an account?{" "}
        <Link
          href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}
          className="font-semibold text-ink-900 underline underline-offset-4"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
