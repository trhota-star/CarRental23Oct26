import { Clock3, Globe2, MapPin, Phone } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { LinkButton } from "@/components/ui/button";
import { EmptyState, PageSkeleton } from "@/components/ui/feedback";
import { Container, PageHeader } from "@/components/ui/page";
import { zoneLabel } from "@/lib/format";
import { toQueryString } from "@/lib/search-params";
import { getActiveBranches } from "../_lib/catalog";

export const metadata: Metadata = { title: "Branches" };

export default function BranchesPage() {
  return (
    <Container className="py-8 sm:py-12">
      <PageHeader
        eyebrow="Locations"
        title="Our branches"
        description="Opening hours and pick-up times are in each branch's local time."
      />
      <Suspense fallback={<PageSkeleton rows={1} label="Loading branches" />}>
        <BranchList />
      </Suspense>
    </Container>
  );
}

async function BranchList() {
  await connection();
  const branches = await getActiveBranches();
  if (branches.length === 0) {
    return <EmptyState icon={MapPin} title="No branches yet" description="Our locations will be listed here soon." />;
  }
  return (
    <ul className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
      {branches.map((b) => (
        <li key={b.id} className="flex flex-col rounded-card border border-ink-100 bg-white p-6 shadow-card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-wide text-gold-700 uppercase">{b.city}</p>
              <h2 className="mt-1 text-lg font-semibold text-ink-900">{b.name}</h2>
            </div>
            <span className="rounded-md bg-ink-50 px-2 py-1 font-mono text-xs text-ink-600">{b.code}</span>
          </div>
          <ul className="mt-4 space-y-2 text-sm text-ink-700">
            <li className="flex gap-2">
              <MapPin className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden />
              <span>{b.address}</span>
            </li>
            {b.phone ? (
              <li className="flex gap-2">
                <Phone className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden />
                <a href={`tel:${b.phone.replace(/\s+/g, "")}`} className="hover:underline">
                  {b.phone}
                </a>
              </li>
            ) : null}
            {b.openingHours ? (
              <li className="flex gap-2">
                <Clock3 className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden />
                <span>{b.openingHours}</span>
              </li>
            ) : null}
            <li className="flex gap-2">
              <Globe2 className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden />
              <span>
                {b.timezone} ({zoneLabel(b.timezone)})
              </span>
            </li>
          </ul>
          <div className="mt-6 pt-2 md:mt-auto">
            <LinkButton href={`/search?${toQueryString({ pickupBranchId: b.id })}`} variant="secondary" className="w-full">
              Find a car here
            </LinkButton>
          </div>
        </li>
      ))}
    </ul>
  );
}
