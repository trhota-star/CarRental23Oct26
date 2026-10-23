import "server-only";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { getAuth } from "./index";

export type Role = "customer" | "admin";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
};

/**
 * The signed-in user for this request, or null. Deduplicated per request.
 * Reads request headers, so callers must render inside a Suspense boundary
 * (loading.tsx counts) when Cache Components is on.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  const u = session.user as typeof session.user & { role?: string | null };
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role === "admin" ? "admin" : "customer",
  };
});

/** The `actor` argument the DB agent's domain functions expect. */
export function toActor(user: CurrentUser): { userId: string; role: Role } {
  return { userId: user.id, role: user.role };
}

/** Only allows same-site relative paths, to prevent open redirects via ?next=. */
export function safeNextPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}

/** Redirects to /login (returning to `nextPath`) when nobody is signed in. */
export async function requireUser(nextPath?: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    const next = nextPath ? `?next=${encodeURIComponent(safeNextPath(nextPath))}` : "";
    redirect(`/login${next}`);
  }
  return user;
}

/**
 * Admin-only guard. Signed-out visitors go to /login; signed-in customers get
 * a 404 so admin URLs are not discoverable.
 */
export async function requireAdmin(nextPath?: string): Promise<CurrentUser> {
  const user = await requireUser(nextPath);
  if (user.role !== "admin") notFound();
  return user;
}
