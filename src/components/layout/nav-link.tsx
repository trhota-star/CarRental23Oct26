"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

type Props = ComponentProps<typeof Link> & { exact?: boolean; activeClassName?: string };

/** Link that marks itself aria-current="page" when its route is active. */
export function NavLink({ href, exact, className, activeClassName, ...props }: Props) {
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
