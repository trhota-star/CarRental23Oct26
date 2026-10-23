import { CarFront, ChevronDown, LayoutDashboard, LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import { logoutAction } from "@/app/(auth)/actions";
import { LinkButton } from "@/components/ui/button";
import { getCurrentUser } from "@/server/auth/session";

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "?"
  );
}

/** Desktop account area: sign-in buttons, or the signed-in user's menu. */
export async function AccountMenu() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <LinkButton href="/login" variant="ghost" size="sm">
          Sign in
        </LinkButton>
        <LinkButton href="/register" variant="primary" size="sm">
          Create account
        </LinkButton>
      </div>
    );
  }
  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-ink-100 [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden
          className="flex size-8 items-center justify-center rounded-full bg-ink-900 text-xs font-bold text-white"
        >
          {initials(user.name)}
        </span>
        <span className="max-w-32 truncate text-sm font-medium text-ink-800">{user.name}</span>
        <ChevronDown className="size-4 text-ink-500 transition-transform group-open:rotate-180" aria-hidden />
        <span className="sr-only">Account menu</span>
      </summary>
      <div className="absolute right-0 z-40 mt-2 w-60 rounded-xl border border-ink-100 bg-white p-1.5 shadow-lift">
        <div className="border-b border-ink-100 px-3 py-2">
          <p className="truncate text-sm font-semibold text-ink-900">{user.name}</p>
          <p className="truncate text-xs text-ink-500">{user.email}</p>
        </div>
        <AccountLinks isAdmin={user.role === "admin"} />
        <form action={logoutAction} className="border-t border-ink-100 pt-1">
          <button
            type="submit"
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink-700 hover:bg-ink-50"
          >
            <LogOut className="size-4" aria-hidden /> Sign out
          </button>
        </form>
      </div>
    </details>
  );
}

function AccountLinks({ isAdmin }: { isAdmin: boolean }) {
  const item = "flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-ink-50";
  return (
    <div className="py-1">
      <Link href="/rentals" className={item}>
        <CarFront className="size-4" aria-hidden /> My rentals
      </Link>
      <Link href="/profile" className={item}>
        <UserRound className="size-4" aria-hidden /> Profile &amp; licence
      </Link>
      {isAdmin ? (
        <Link href="/admin" className={item}>
          <LayoutDashboard className="size-4" aria-hidden /> Admin console
        </Link>
      ) : null}
    </div>
  );
}

/** Account section inside the mobile menu panel. */
export async function MobileAccount() {
  const user = await getCurrentUser();
  const item = "flex items-center gap-3 rounded-xl px-3 py-3 text-base font-medium text-ink-800 hover:bg-ink-50";
  if (!user) {
    return (
      <div className="grid grid-cols-2 gap-2 pt-2">
        <LinkButton href="/login" variant="secondary">
          Sign in
        </LinkButton>
        <LinkButton href="/register" variant="primary">
          Create account
        </LinkButton>
      </div>
    );
  }
  return (
    <div className="pt-2">
      <p className="px-3 pb-1 text-xs font-semibold tracking-wide text-ink-500 uppercase">
        Signed in as {user.name}
      </p>
      <Link href="/rentals" className={item}>
        <CarFront className="size-5" aria-hidden /> My rentals
      </Link>
      <Link href="/profile" className={item}>
        <UserRound className="size-5" aria-hidden /> Profile &amp; licence
      </Link>
      {user.role === "admin" ? (
        <Link href="/admin" className={item}>
          <LayoutDashboard className="size-5" aria-hidden /> Admin console
        </Link>
      ) : null}
      <form action={logoutAction}>
        <button type="submit" className={`${item} w-full text-left`}>
          <LogOut className="size-5" aria-hidden /> Sign out
        </button>
      </form>
    </div>
  );
}
