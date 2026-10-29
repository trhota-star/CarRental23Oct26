import { ArrowLeft, CalendarDays, MapPin } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PriceBreakdown } from "@/components/booking/price-breakdown";
import { BookingSteps } from "@/components/booking/steps";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, EmptyState, PageSkeleton } from "@/components/ui/feedback";
import { Container } from "@/components/ui/page";
import { CarArt } from "@/components/vehicle/car-art";
import { VehicleSpecs } from "@/components/vehicle/vehicle-specs";
import { extrasToParams, parseExtraSelections } from "@/lib/extras";
import { formatDateTime } from "@/lib/format";
import { toQueryString } from "@/lib/search-params";
import { requireUser } from "@/server/auth/session";
import { isDomainError } from "@/server/errors";
import { resolveSearch, tripParams } from "../../_lib/booking-query";
import { getVehicle, listBranches, listExtras, quotePrice, type Quote } from "../../_lib/server-api";
import { ExtrasForm } from "./extras-form";
import { ReserveForm } from "./reserve-form";

export const metadata: Metadata = { title: "Extras & price" };

export default function BookPage(props: PageProps<"/book/[vehicleId]">) {
  return (
    <Suspense fallback={<PageSkeleton rows={1} label="Preparing your booking" />}>
      <BookContent {...props} />
    </Suspense>
  );
}

async function BookContent({ params, searchParams }: PageProps<"/book/[vehicleId]">) {
  const [{ vehicleId }, sp] = await Promise.all([params, searchParams]);
  const here = `/book/${vehicleId}?${new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])),
  ).toString()}`;
  await requireUser(here);
  await connection();
  const now = new Date();

  let vehicle;
  try {
    vehicle = await getVehicle(vehicleId);
  } catch (e) {
    if (isDomainError(e)) notFound();
    throw e;
  }
  const [branches, extras] = await Promise.all([listBranches(), listExtras()]);
  const resolved = resolveSearch({ ...sp, pickupBranchId: vehicle.branchId }, branches, now);
  if (resolved.status !== "ok") redirect(`/vehicles/${vehicle.id}`);

  const trip = tripParams(resolved);
  const selections = parseExtraSelections(sp).filter((s) => extras.some((x) => x.id === s.extraId));
  const selectedMap = Object.fromEntries(selections.map((s) => [s.extraId, s.quantity]));

  let quote: Quote | null = null;
  let quoteError: string | null = null;
  try {
    quote = await quotePrice({
      vehicleId: vehicle.id,
      pickupBranchId: resolved.pickupBranch.id,
      returnBranchId: resolved.returnBranch.id,
      pickupAt: resolved.pickupAt,
      returnAt: resolved.returnAt,
      extras: selections,
    });
  } catch (e) {
    if (!isDomainError(e)) throw e;
    quoteError = e.message;
  }

  const idempotencyKey = crypto.randomUUID();

  return (
    <Container className="py-6 sm:py-10">
      <Link
        href={`/vehicles/${vehicle.id}?${toQueryString(trip)}`}
        className="inline-flex items-center gap-1 text-sm font-medium text-ink-600 hover:text-ink-900"
      >
        <ArrowLeft className="size-4" aria-hidden /> Back to vehicle
      </Link>
      <BookingSteps current={1} className="mt-4" />
      <h1 className="mt-6 font-display text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">
        Extras &amp; price
      </h1>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <CarArt
                color={vehicle.color}
                category={vehicle.category.name}
                seats={vehicle.seats}
                className="aspect-[16/9] w-full shrink-0 rounded-xl sm:w-48"
              />
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-ink-900">
                    {vehicle.make} {vehicle.model}
                  </h2>
                  <Badge tone="gold">{vehicle.category.name}</Badge>
                </div>
                <VehicleSpecs vehicle={vehicle} />
                <p className="flex items-start gap-2 text-sm text-ink-700">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden />
                  <span>
                    {resolved.pickupBranch.name}
                    {resolved.returnBranch.id !== resolved.pickupBranch.id ? ` → ${resolved.returnBranch.name}` : ""}
                  </span>
                </p>
                <p className="flex items-start gap-2 text-sm text-ink-700">
                  <CalendarDays className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden />
                  <span>
                    {formatDateTime(resolved.pickupAt, resolved.pickupBranch.timezone)} –{" "}
                    {formatDateTime(resolved.returnAt, resolved.returnBranch.timezone)}
                    <span className="text-ink-500"> ({resolved.pickupBranch.timezone})</span>
                  </span>
                </p>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Add extras</CardTitle>
              <p className="text-sm text-ink-600">Optional. Prices update from our server as you choose.</p>
            </CardHeader>
            <CardBody>
              {extras.length === 0 ? (
                <EmptyState icon={CalendarDays} title="No extras available" description="You can continue without extras." />
              ) : (
                <ExtrasForm
                  action={`/book/${vehicle.id}`}
                  trip={trip}
                  extras={extras.map((x) => ({
                    id: x.id,
                    name: x.name,
                    description: x.description,
                    chargeType: x.chargeType,
                    priceFils: x.priceFils,
                    maxQuantity: x.maxQuantity,
                  }))}
                  selected={selectedMap}
                />
              )}
            </CardBody>
          </Card>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardBody className="space-y-5">
              {quote ? (
                <PriceBreakdown quote={quote} />
              ) : (
                <Alert tone="danger" title="We can't price this trip">
                  {quoteError}
                </Alert>
              )}
              <ReserveForm
                disabled={!quote}
                hidden={{
                  vehicleId: vehicle.id,
                  ...trip,
                  ...extrasToParams(selections),
                  idempotencyKey,
                }}
              />
            </CardBody>
          </Card>
        </aside>
      </div>
    </Container>
  );
}
