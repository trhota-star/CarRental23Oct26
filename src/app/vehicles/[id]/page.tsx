import { ArrowLeft, CalendarX2, Check, MapPin } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PriceBreakdown } from "@/components/booking/price-breakdown";
import { SearchForm } from "@/components/search/search-form";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Alert, PageSkeleton } from "@/components/ui/feedback";
import { Container } from "@/components/ui/page";
import { AvailabilityCalendar, monthBounds } from "@/components/vehicle/availability-calendar";
import { CarArt } from "@/components/vehicle/car-art";
import { VehicleSpecs } from "@/components/vehicle/vehicle-specs";
import { formatDateTime, utcToZonedParts } from "@/lib/format";
import { defaultSearchDates, first, toQueryString } from "@/lib/search-params";
import { isDomainError } from "@/server/errors";
import { resolveSearch, tripParams } from "../../_lib/booking-query";
import { getVehicle, getVehicleCalendar, listBranches, searchAvailability, type VehicleDetails } from "../../_lib/server-api";

export const metadata: Metadata = { title: "Vehicle details" };

export default function VehiclePage(props: PageProps<"/vehicles/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton rows={1} label="Loading vehicle" />}>
      <VehicleContent {...props} />
    </Suspense>
  );
}

async function loadVehicle(id: string): Promise<VehicleDetails> {
  try {
    return await getVehicle(id);
  } catch (e) {
    if (isDomainError(e) && (e.code === "NOT_FOUND" || e.code === "VALIDATION")) notFound();
    throw e;
  }
}

async function VehicleContent({ params, searchParams }: PageProps<"/vehicles/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  await connection();
  const now = new Date();
  const vehicle = await loadVehicle(id);
  if (vehicle.status === "RETIRED") notFound();
  const branches = await listBranches();
  const tz = vehicle.branch.timezone;
  const today = utcToZonedParts(now, tz).date;
  const currentMonth = today.slice(0, 7);
  const monthParam = first(sp.month);
  const month = monthParam && /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam) && monthParam >= currentMonth ? monthParam : currentMonth;

  // Trip is only meaningful at this vehicle's branch.
  const resolved = resolveSearch({ ...sp, pickupBranchId: vehicle.branchId }, branches, now);
  const hasTripInput = Boolean(first(sp.pickupDate));

  const bounds = monthBounds(month, tz);
  const calendar = await getVehicleCalendar({ vehicleId: vehicle.id, from: bounds.from, to: bounds.to });

  const keep = (extra: Record<string, string | undefined>) =>
    toQueryString({ ...(resolved.status === "ok" ? tripParams(resolved) : {}), ...extra });

  return (
    <Container className="py-6 sm:py-10">
      <Link
        href={resolved.status === "ok" ? `/search?${toQueryString(tripParams(resolved))}` : "/search"}
        className="inline-flex items-center gap-1 text-sm font-medium text-ink-600 hover:text-ink-900"
      >
        <ArrowLeft className="size-4" aria-hidden /> Back to results
      </Link>

      <div className="mt-4 grid gap-8 lg:grid-cols-[1fr_24rem]">
        <div className="min-w-0 space-y-8">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="gold">{vehicle.category.name}</Badge>
              <span className="flex items-center gap-1 text-sm text-ink-600">
                <MapPin className="size-4" aria-hidden /> {vehicle.branch.name}, {vehicle.branch.city}
              </span>
            </div>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink-900">
              {vehicle.make} {vehicle.model}
            </h1>
            <p className="text-sm text-ink-500">
              {vehicle.year}
              {vehicle.color ? ` · ${vehicle.color}` : ""}
            </p>
          </div>
          <CarArt
            color={vehicle.color}
            category={vehicle.category.name}
            seats={vehicle.seats}
            className="aspect-[16/8] rounded-card border border-ink-100"
          />
          <VehicleSpecs vehicle={vehicle} showDoors className="text-base" />
          {vehicle.features.length ? (
            <section aria-labelledby="features-title">
              <h2 id="features-title" className="text-lg font-semibold text-ink-900">
                Features
              </h2>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {vehicle.features.map((f) => (
                  <li key={f.id} className="flex items-center gap-2 text-sm text-ink-700">
                    <Check className="size-4 text-success-700" aria-hidden /> {f.name}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section aria-labelledby="availability-title">
            <h2 id="availability-title" className="text-lg font-semibold text-ink-900">
              Availability
            </h2>
            <p className="mt-1 mb-4 text-sm text-ink-600">Days shown in branch local time ({tz}).</p>
            <Card>
              <CardBody>
                <AvailabilityCalendar
                  month={month}
                  today={today}
                  timeZone={tz}
                  busy={calendar.busy}
                  canGoBack={month > currentMonth}
                  hrefForMonth={(m) => `/vehicles/${vehicle.id}?${keep({ month: m })}#availability-title`}
                />
              </CardBody>
            </Card>
          </section>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardBody className="space-y-5">
              {resolved.status === "ok" ? (
                <BookingPanel vehicle={vehicle} resolved={resolved} />
              ) : (
                <>
                  <div>
                    <h2 className="text-lg font-semibold text-ink-900">Choose your dates</h2>
                    <p className="text-sm text-ink-600">Pick-up is at {vehicle.branch.name}.</p>
                  </div>
                  {hasTripInput && resolved.status === "invalid" ? (
                    <Alert tone="danger">{resolved.errors.join(" ")}</Alert>
                  ) : null}
                  <TripForm vehicle={vehicle} branches={branches} now={now} raw={resolved.raw} />
                </>
              )}
            </CardBody>
          </Card>
        </aside>
      </div>
    </Container>
  );
}

function TripForm({
  vehicle,
  branches,
  now,
  raw,
}: {
  vehicle: VehicleDetails;
  branches: Array<{ id: string; name: string; city: string; timezone: string }>;
  now: Date;
  raw: Record<string, string | undefined>;
}) {
  const d = defaultSearchDates(now, vehicle.branch.timezone);
  const opts = branches.map((b) => ({ id: b.id, name: b.name, city: b.city }));
  return (
    <SearchForm
      variant="compact"
      action={`/vehicles/${vehicle.id}`}
      submitLabel="Check price"
      branches={opts.filter((b) => b.id === vehicle.branchId)}
      returnBranches={opts}
      defaults={{
        minDate: d.minDate,
        pickupBranchId: vehicle.branchId,
        returnBranchId: raw.returnBranchId,
        pickupDate: raw.pickupDate ?? d.pickupDate,
        pickupTime: raw.pickupTime ?? d.pickupTime,
        returnDate: raw.returnDate ?? d.returnDate,
        returnTime: raw.returnTime ?? d.returnTime,
      }}
    />
  );
}

async function BookingPanel({
  vehicle,
  resolved,
}: {
  vehicle: VehicleDetails;
  resolved: Extract<ReturnType<typeof resolveSearch>, { status: "ok" }>;
}) {
  const trip = tripParams(resolved);
  let match;
  let error: string | null = null;
  try {
    const results = await searchAvailability({
      pickupBranchId: resolved.pickupBranch.id,
      returnBranchId: resolved.returnBranch.id,
      pickupAt: resolved.pickupAt,
      returnAt: resolved.returnAt,
    });
    match = results.find((r) => r.id === vehicle.id);
  } catch (e) {
    if (!isDomainError(e)) throw e;
    error = e.message;
  }
  const changeHref = `/vehicles/${vehicle.id}`;
  return (
    <>
      <div>
        <h2 className="text-lg font-semibold text-ink-900">Your trip</h2>
        <dl className="mt-2 space-y-1 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-500">Pick-up</dt>
            <dd className="text-right font-medium text-ink-900">
              {formatDateTime(resolved.pickupAt, resolved.pickupBranch.timezone)}
              <br />
              <span className="font-normal text-ink-600">{resolved.pickupBranch.name}</span>
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-500">Return</dt>
            <dd className="text-right font-medium text-ink-900">
              {formatDateTime(resolved.returnAt, resolved.returnBranch.timezone)}
              <br />
              <span className="font-normal text-ink-600">{resolved.returnBranch.name}</span>
            </dd>
          </div>
        </dl>
        <Link href={changeHref} className="mt-2 inline-block text-sm font-semibold text-ink-900 underline underline-offset-4">
          Change dates
        </Link>
      </div>
      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : match ? (
        <>
          <PriceBreakdown quote={match.quote} title="Estimated price (before extras)" />
          <LinkButton href={`/book/${vehicle.id}?${toQueryString(trip)}`} variant="accent" size="lg" className="w-full">
            Continue to extras
          </LinkButton>
          <p className="text-center text-xs text-ink-500">You won&apos;t be charged yet.</p>
        </>
      ) : (
        <Alert tone="warning" title="Not available for these dates">
          <span className="flex items-start gap-2">
            <CalendarX2 className="mt-0.5 size-4 shrink-0" aria-hidden />
            This car is booked for part of your trip. Check the calendar for free days, or{" "}
            <Link href={`/search?${toQueryString(trip)}`} className="font-semibold underline">
              see other cars
            </Link>
            .
          </span>
        </Alert>
      )}
    </>
  );
}
