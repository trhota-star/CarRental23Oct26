import type { Metadata } from "next";
import { NavLink } from "@/components/layout/nav-link";
import { Container } from "@/components/ui/page";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · Admin · DriveEasy" } };

const links = [
  { href: "/admin", label: "Overview", exact: true },
  { href: "/admin/reservations", label: "Reservations" },
  { href: "/admin/fleet", label: "Fleet" },
  { href: "/admin/branches", label: "Branches" },
  { href: "/admin/pricing", label: "Pricing & extras" },
  { href: "/admin/damage", label: "Damage reports" },
];

/** Admin chrome only. Every admin page and action checks requireAdmin() itself. */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex flex-1 flex-col bg-ink-50/60">
      <div className="border-b border-ink-100 bg-white">
        <Container className="flex items-center gap-4 py-2">
          <span className="rounded-md bg-ink-900 px-2 py-1 text-xs font-bold tracking-wide text-gold-300 uppercase">
            Admin
          </span>
          <nav aria-label="Admin" className="-mx-1 flex gap-1 overflow-x-auto">
            {links.map((l) => (
              <NavLink
                key={l.href}
                href={l.href}
                exact={l.exact}
                className="rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap text-ink-600 hover:bg-ink-50 hover:text-ink-900"
                activeClassName="bg-ink-100 text-ink-900"
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
        </Container>
      </div>
      {children}
    </div>
  );
}
