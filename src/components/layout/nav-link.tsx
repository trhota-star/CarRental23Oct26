"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, type ComponentProps } from "react";
import { cn } from "@/lib/cn";

type Props = ComponentProps<typeof Link> & { exact?: boolean; activeClassName?: string };

/**
 * Link that marks itself aria-current="page" when its route is active.
 * usePathname() needs a Suspense boundary with Cache Components on dynamic
 * routes, so the fallback is the same link without the active state.
 */
export function NavLink({ exact, activeClassName, ...props }: Props) {
  return (
    <Suspense fallback={<Link {...props} />}>
      <ActiveLink exact={exact} activeClassName={activeClassName} {...props} />
    </Suspense>
  );
}

function ActiveLink({ href, exact, className, activeClassName, ...props }: Props) {
  const pathname = usePathname();
  const target = typeof href === "string" ? href : (href.pathname ?? "");
  const active = exact ? pathname === target : pathname === target || pathname.startsWith(`${target}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(className, active && activeClassName)}
      {...props}
    />
  );
}
