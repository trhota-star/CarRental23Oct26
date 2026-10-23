import { CalendarDays, CarFront, MapPin, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { SearchForm } from "@/components/search/search-form";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Alert, EmptyState, PageSkeleton } from "@/components/ui/feedback";
import { Container } from "@/components/ui/page";
import { CarArt } from "@/components/vehicle/car-art";
import { VehicleSpecs } from "@/components/vehicle/vehicle-specs";
import { formatAed, formatDateTime, pluralize } from "@/lib/format";
import { defaultSearchDates, toQueryString } from "@/lib/search-params";
import { isDomainError } from "@/server/errors";
import { resolveSearch, tripParams } from "../_lib/booking-query";
import { listBranches, listCategories, searchAvailability, type AvailableVehicle } from "../_lib/server-api";
import { Filters } from "./filters";

export const metadata: Metadata = { title: "Find a car" };

export default function SearchPage({ searchParams }: PageProps<"/search">) {
  return (
    <Suspense fallback={<PageSkeleton label="Searching cars" />}>
      <SearchContent searchParams={searchParams} />
    </Suspense>
  );
}

async function SearchContent({ searchParams }: { searchParams: PageProps<"/search">["searchParams"] }) {
  const sp = await searchParams;
  await connection();
  const now = new Date();
  const [branches, categories] = await Promise.all([listBranches(), listCategories()]);
  const resolved = resolveSearch(sp, branches, now);
  const branchOptions = branches.map((b) => ({ id: b.id, name: b.name, city: b.city }));
  const fallbackDates = defaultSearchDates(now, branches[0]?.timezone);

  if (branches.length === 0) {
    return (
      <Container className="py-10">
        <EmptyState
          icon={MapPin}
          title="No branches are open for booking yet"
          description="Please check back shortly."
        />
      </Container>
    );
  }

  if (resolved.status !== "ok") {
    const raw = resolved.raw;
    return (
      <Container className="py-8 sm:py-12">
        <h1 className="font-display text-2xl font-semibold text-ink-900 sm:text-3xl">Find your car</h1>
        <p className="mt-1 text-ink-600">Choose where and when you&apos;d like to pick up.</p>
        {resolved.status === "invalid" ? (
          <Alert tone="danger" className="mt-5" title="Please check your search">
            <ul className="list-inside list-disc">
              {resolved.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        <div className="mt-6 rounded-card border border-ink-100 bg-white p-4 shadow-card sm:p-6">
          <SearchForm
            branches={branchOptions}
            defaults={{
              minDate: fallbackDates.minDate,
              pickupBranchId: raw.pickupBranchId ?? branches[0]?.id,
              returnBranchId: raw.returnBranchId,
              pickupDate: raw.pickupDate ?? fallbackDates.pickupDate,
              pickupTime: raw.pickupTime ?? fallbackDates.pickupTime,
              returnDate: raw.returnDate ?? fallbackDates.returnDate,
              returnTime: raw.returnTime ?? fallbackDates.returnTime,
            }}
            extraHidden={raw.category ? { category: raw.category } : undefined}
          />
        </div>
      </Container>
    );
  }

  const { q, pickupBranch, returnBranch, pickupAt, returnAt } = resolved;
  const trip = tripParams(resolved);
  const categoryId = categories.some((c) => c.id === q.category) ? q.category : undefined;

  let results: AvailableVehicle[] = [];
  let error: string | null = null;
  try {
    results = await searchAvailability({
      pickupBranchId: pickupBranch.id,
      returnBranchId: returnBranch.id,
      pickupAt,
      returnAt,
      categoryId,
      transmission: q.transmission,
      fuelType: q.fuelType,
      minSeats: q.seats,
      maxDailyRateFils: q.maxPrice !== undefined ? q.maxPrice * 100 : undefined,
      sort: q.sort === "price_desc" ? "price_desc" : "price_asc",
    });
  } catch (e) {
    if (!isDomainError(e)) throw e;
    error = e.message;
  }
  if (q.sort === "seats_desc") results = [...results].sort((a, b) => b.seats - a.seats);

  const filterValues = {
    category: categoryId,
    transmission: q.transmission,
    fuelType: q.fuelType,
    seats: q.seats?.toString(),
    maxPrice: q.maxPrice?.toString(),
    sort: q.sort,
  };
  const activeFilterCount = Object.entries(filterValues).filter(([k, v]) => k !== "sort" && v).length;

  return (
    <>
      <div className="border-b border-ink-100 bg-white">
        <Container className="py-5">
          <details className="group">
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-6 gap-y-2 [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2 text-sm text-ink-800">
                <MapPin className="size-4 text-gold-600" aria-hidden />
                <span className="font-semibold">{pickupBranch.name}</span>
                {returnBranch.id !== pickupBranch.id ? <span>→ {returnBranch.name}</span> : null}
              </span>
              <span className="flex items-center gap-2 text-sm text-ink-800">
                <CalendarDays className="size-4 text-gold-600" aria-hidden />
                {formatDateTime(pickupAt, pickupBranch.timezone)} – {formatDateTime(returnAt, returnBranch.timezone)}
              </span>
              <span className="text-sm font-semibold text-ink-900 underline underline-offset-4 group-open:hidden">
                Change search
              </span>
            </summary>
            <div className="mt-5">
              <SearchForm
                variant="compact"
                branches={branchOptions}
                defaults={{
                  minDate: fallbackDates.minDate,
                  pickupBranchId: pickupBranch.id,
                  returnBranchId: returnBranch.id,
                  pickupDate: q.pickupDate,
                  pickupTime: q.pickupTime,
                  returnDate: q.returnDate,
                  returnTime: q.returnTime,
                }}
              />
            </div>
          </details>
        </Container>
      </div>

      <Container className="grid gap-6 py-8 lg:grid-cols-[17rem_1fr]">
        <Filters trip={trip} current={filterValues} categories={categories} />
        <section aria-labelledby="results-title" className="min-w-0">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h1 id="results-title" className="font-display text-xl font-semibold text-ink-900 sm:text-2xl">
              {pluralize(results.length, "car")} available
            </h1>
            <p className="text-sm text-ink-500">
              Times in {pickupBranch.timezone}
              {activeFilterCount ? ` · ${pluralize(activeFilterCount, "filter")} applied` : ""}
            </p>
          </div>
          {error ? (
            <Alert tone="danger" title="We couldn't search those dates">
              {error}
            </Alert>
          ) : results.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="No cars match your search"
              description={
                activeFilterCount
                  ? "Try removing a filter or changing your dates."
                  : "Everything at this branch is booked for those dates. Try other dates or another branch."
              }
              action={
                activeFilterCount ? (
                  <LinkButton href={`/search?${toQueryString(trip)}`} variant="secondary">
                    Clear filters
                  </LinkButton>
                ) : (
                  <LinkButton href="/branches" variant="secondary">
                    See all branches
                  </LinkButton>
                )
              }
            />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {results.map((v) => (
                <li key={v.id}>
                  <ResultCard vehicle={v} href={`/vehicles/${v.id}?${toQueryString(trip)}`} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </Container>
    </>
  );
}

function ResultCard({ vehicle: v, href }: { vehicle: AvailableVehicle; href: string }) {
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-card border border-ink-100 bg-white shadow-card transition-shadow hover:shadow-lift">
      <CarArt color={v.color} category={v.category.name} seats={v.seats} className="aspect-[16/9]" />
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className="font-semibold text-ink-900">
            <Link href={href} className="after:absolute after:inset-0 focus:outline-none">
              {v.make} {v.model}
            </Link>
          </h2>
          <Badge tone="gold">{v.category.name}</Badge>
        </div>
        <p className="text-xs text-ink-500">
          {v.year}
          {v.color ? ` · ${v.color}` : ""} · or similar
        </p>
        <VehicleSpecs vehicle={v} className="mt-3" />
        <div className="mt-4 flex items-end justify-between gap-2 border-t border-ink-100 pt-3 md:mt-auto">
          <div>
            <p className="text-lg font-bold text-ink-900">
              {formatAed(v.quote.dailyRateFils)}
              <span className="text-sm font-normal text-ink-500">/day</span>
            </p>
            <p className="text-xs text-ink-500">
              {formatAed(v.quote.totalFils)} total · {pluralize(v.quote.rentalDays, "day")} incl. VAT
            </p>
          </div>
          <span className="inline-flex items-center gap-1 text-sm font-semibold text-ink-900">
            <CarFront className="size-4" aria-hidden /> View
          </span>
        </div>
      </div>
    </article>
  );
}
