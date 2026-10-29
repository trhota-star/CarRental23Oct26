import { CalendarDays, CarFront, ChevronRight, MapPin } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ReservationStatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { EmptyState, ListSkeleton } from "@/components/ui/feedback";
import { Container, PageHeader } from "@/components/ui/page";
import { cn } from "@/lib/cn";
import { formatAed, formatDateTime } from "@/lib/format";
import { first } from "@/lib/search-params";
import { requireUser, toActor } from "@/server/auth/session";
import { listReservationsForUser, type ReservationView } from "../_lib/server-api";

export const metadata: Metadata = { title: "My rentals" };

const TABS = [
  { key: "upcoming", label: "Upcoming", statuses: ["PENDING", "CONFIRMED", "PICKED_UP"] },
  { key: "past", label: "Past", statuses: ["RETURNED"] },
  { key: "cancelled", label: "Cancelled", statuses: ["CANCELLED", "EXPIRED", "REFUNDED"] },
] as const;

export default function RentalsPage(props: PageProps<"/rentals">) {
  return (
    <Container className="py-8 sm:py-12">
      <PageHeader
        eyebrow="Your account"
        title="My rentals"
        description="View vouchers, change dates or cancel. Times are shown in each branch's local time."
        actions={<LinkButton href="/search">Book a car</LinkButton>}
      />
      <Suspense fallback={<ListSkeleton />}>
        <RentalList {...props} />
      </Suspense>
    </Container>
  );
}

async function RentalList({ searchParams }: PageProps<"/rentals">) {
  const sp = await searchParams;
  const user = await requireUser("/rentals");
  await connection();
  const tab = TABS.find((t) => t.key === first(sp.tab)) ?? TABS[0];
  const { items } = await listReservationsForUser(toActor(user), { statuses: [...tab.statuses], limit: 100 });
  const sorted = tab.key === "upcoming" ? [...items].sort((a, b) => a.pickupAt.getTime() - b.pickupAt.getTime()) : items;

  return (
    <>
      <nav aria-label="Rental filters" className="mb-5 flex gap-2 overflow-x-auto">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === "upcoming" ? "/rentals" : `/rentals?tab=${t.key}`}
            aria-current={t.key === tab.key ? "page" : undefined}
            className={cn(
              "rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap",
              t.key === tab.key ? "bg-ink-900 text-white" : "bg-white text-ink-700 ring-1 ring-ink-200 hover:bg-ink-50",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {sorted.length === 0 ? (
        <EmptyState
          icon={CarFront}
          title={tab.key === "upcoming" ? "No upcoming rentals" : `No ${tab.label.toLowerCase()} rentals`}
          description={tab.key === "upcoming" ? "When you book a car it will appear here." : undefined}
          action={tab.key === "upcoming" ? <LinkButton href="/search">Find a car</LinkButton> : undefined}
        />
      ) : (
        <ul className="space-y-3">
          {sorted.map((r) => (
            <li key={r.id}>
              <RentalRow r={r} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function RentalRow({ r }: { r: ReservationView }) {
  return (
    <Link
      href={r.status === "PENDING" ? `/checkout/${r.id}` : `/rentals/${r.id}`}
      className="flex items-center gap-4 rounded-card border border-ink-100 bg-white p-4 shadow-card transition-shadow hover:shadow-lift sm:p-5"
    >
      <span className="hidden size-12 shrink-0 items-center justify-center rounded-xl bg-gold-50 text-gold-700 sm:flex">
        <CarFront className="size-6" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-ink-900">
            {r.vehicle.make} {r.vehicle.model}
          </p>
          <ReservationStatusBadge status={r.status} />
          <span className="font-mono text-xs text-ink-500">{r.reference}</span>
        </div>
        <p className="flex items-center gap-1.5 text-sm text-ink-600">
          <CalendarDays className="size-4 shrink-0 text-ink-400" aria-hidden />
          {formatDateTime(r.pickupAt, r.pickupBranch.timezone)} → {formatDateTime(r.returnAt, r.returnBranch.timezone)}
        </p>
        <p className="flex items-center gap-1.5 text-sm text-ink-600">
          <MapPin className="size-4 shrink-0 text-ink-400" aria-hidden />
          {r.pickupBranch.name}
          {r.returnBranch.id !== r.pickupBranch.id ? ` → ${r.returnBranch.name}` : ""}
        </p>
      </div>
      <div className="text-right">
        <p className="font-semibold text-ink-900">{formatAed(r.pricing.totalFils)}</p>
        {r.status === "PENDING" ? <p className="text-xs font-medium text-warning-700">Finish payment</p> : null}
      </div>
      <ChevronRight className="size-5 shrink-0 text-ink-400" aria-hidden />
    </Link>
  );
}
