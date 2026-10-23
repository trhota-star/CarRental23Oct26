import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser, safeNextPath } from "@/server/auth/session";
import { LoginForm } from "../auth-forms";
import { AuthShell } from "../auth-shell";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? safeNextPath(sp.next) : undefined;
  if (await getCurrentUser()) redirect(next ?? "/");
  return (
    <AuthShell title="Welcome back" subtitle="Sign in to manage your rentals and book faster.">
      <LoginForm next={next} />
    </AuthShell>
  );
}
