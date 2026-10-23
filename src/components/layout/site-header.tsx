import { Suspense } from "react";
import { Skeleton } from "@/components/ui/feedback";
import { AccountMenu, MobileAccount } from "./account-menu";
import { Logo } from "./logo";
import { MobileNav } from "./mobile-nav";
import { NavLink } from "./nav-link";

const links = [
  { href: "/search", label: "Find a car" },
  { href: "/branches", label: "Branches" },
  { href: "/rentals", label: "My rentals" },
] as const;

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-ink-100 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/75">
      <div className="relative mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Logo />
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <NavLink
              key={l.href}
              href={l.href}
              className="rounded-lg px-3 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50 hover:text-ink-900"
              activeClassName="text-ink-900 bg-ink-50"
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="hidden md:block">
          <Suspense fallback={<Skeleton className="h-9 w-40" />}>
            <AccountMenu />
          </Suspense>
        </div>
        <MobileNav>
          <nav aria-label="Main mobile" className="flex flex-col border-b border-ink-100 pb-2">
            {links.map((l) => (
              <NavLink
                key={l.href}
                href={l.href}
                className="rounded-xl px-3 py-3 text-base font-medium text-ink-800 hover:bg-ink-50"
                activeClassName="bg-ink-50 text-ink-950"
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
          <Suspense fallback={<Skeleton className="mt-3 h-11 w-full" />}>
            <MobileAccount />
          </Suspense>
        </MobileNav>
      </div>
    </header>
  );
}
