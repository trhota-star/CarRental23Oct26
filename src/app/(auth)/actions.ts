"use server";

import { isAPIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuth } from "@/server/auth";
import { safeNextPath } from "@/server/auth/session";

export type AuthFormState = {
  error?: string;
  fieldErrors?: Partial<Record<"name" | "email" | "password" | "confirmPassword", string[]>>;
  values?: { name?: string; email?: string };
};

const loginSchema = z.object({
  email: z.email("Enter a valid email address.").max(254).transform((v) => v.trim().toLowerCase()),
  password: z.string().min(1, "Enter your password.").max(128),
  next: z.string().optional(),
});

const registerSchema = z
  .object({
    name: z.string().trim().min(2, "Enter your full name.").max(120),
    email: z.email("Enter a valid email address.").max(254).transform((v) => v.trim().toLowerCase()),
    password: z
      .string()
      .min(8, "Use at least 8 characters.")
      .max(128, "Use at most 128 characters.")
      .regex(/[A-Za-z]/, "Include at least one letter.")
      .regex(/\d/, "Include at least one number."),
    confirmPassword: z.string(),
    next: z.string().optional(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords don't match.",
  });

function str(form: FormData, key: string): string | undefined {
  const v = form.get(key);
  return typeof v === "string" ? v : undefined;
}

export async function loginAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const parsed = loginSchema.safeParse({
    email: str(form, "email") ?? "",
    password: str(form, "password") ?? "",
    next: str(form, "next"),
  });
  const values = { email: str(form, "email") };
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values };
  }
  try {
    await getAuth().api.signInEmail({
      body: { email: parsed.data.email, password: parsed.data.password },
      headers: await headers(),
    });
  } catch (error) {
    if (isAPIError(error)) {
      return { error: "That email and password don't match an account.", values };
    }
    throw error;
  }
  redirect(safeNextPath(parsed.data.next, "/"));
}

export async function registerAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const parsed = registerSchema.safeParse({
    name: str(form, "name") ?? "",
    email: str(form, "email") ?? "",
    password: str(form, "password") ?? "",
    confirmPassword: str(form, "confirmPassword") ?? "",
    next: str(form, "next"),
  });
  const values = { name: str(form, "name"), email: str(form, "email") };
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values };
  }
  try {
    await getAuth().api.signUpEmail({
      body: { name: parsed.data.name, email: parsed.data.email, password: parsed.data.password },
      headers: await headers(),
    });
  } catch (error) {
    if (isAPIError(error)) {
      const exists = /exist/i.test(error.message);
      return {
        error: exists ? "An account with this email already exists. Try signing in." : error.message,
        values,
      };
    }
    throw error;
  }
  redirect(safeNextPath(parsed.data.next, "/profile?welcome=1"));
}

export async function logoutAction(): Promise<void> {
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/");
}
