import Link from "next/link";
import { Logo } from "./logo";

export function SiteFooter() {
  return (
    <footer className="mt-auto bg-ink-950 text-ink-300">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-8">
        <div className="space-y-3">
          <Logo inverted />
          <p className="text-sm leading-relaxed">
            Premium car rental across the UAE. Transparent prices in AED, VAT included at checkout.
          </p>
        </div>
        <FooterColumn
          title="Rent"
          links={[
            { href: "/search", label: "Find a car" },
            { href: "/branches", label: "Branches" },
          ]}
        />
        <FooterColumn
          title="Your account"
          links={[
            { href: "/rentals", label: "My rentals" },
            { href: "/profile", label: "Profile & licence" },
          ]}
        />
        <div className="space-y-3 text-sm">
          <h2 className="text-xs font-semibold tracking-[0.14em] text-white uppercase">Good to know</h2>
          <p>Times are shown in each branch&apos;s local time (Gulf Standard Time, UTC+4).</p>
          <p>A refundable security deposit is held on your card at booking.</p>
        </div>
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto w-full max-w-6xl px-4 py-5 text-xs text-ink-400 sm:px-6 lg:px-8">
          DriveEasy Car Rental · United Arab Emirates
        </p>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: Array<{ href: string; label: string }> }) {
  return (
    <div>
      <h2 className="text-xs font-semibold tracking-[0.14em] text-white uppercase">{title}</h2>
      <ul className="mt-3 space-y-2 text-sm">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="rounded hover:text-white">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
