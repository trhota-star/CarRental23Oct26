import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser, safeNextPath } from "@/server/auth/session";
import { RegisterForm } from "../auth-forms";
import { AuthShell } from "../auth-shell";

export const metadata: Metadata = { title: "Create account" };

export default async function RegisterPage({ searchParams }: PageProps<"/register">) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? safeNextPath(sp.next) : undefined;
  if (await getCurrentUser()) redirect(next ?? "/");
  return (
    <AuthShell title="Create your account" subtitle="It takes a minute. You'll add your licence before your first pick-up.">
      <RegisterForm next={next} />
    </AuthShell>
  );
}
