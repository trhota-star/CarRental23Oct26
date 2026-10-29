import { ArrowLeft, CalendarClock, CalendarDays, MapPin, Ticket, XCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { PriceBreakdown } from "@/components/booking/price-breakdown";
import { Badge, ReservationStatusBadge } from "@/components/ui/badge";
import { buttonClass, LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, PageSkeleton } from "@/components/ui/feedback";
import { Input, Label, Select } from "@/components/ui/form";
import { Container, DescriptionList } from "@/components/ui/page";
import { formatAed, formatDateTime, TIME_SLOTS, utcToZonedParts, zonedToUtc } from "@/lib/format";
import { first } from "@/lib/search-params";
import { toActor, type CurrentUser } from "@/server/auth/session";
import { isDomainError } from "@/server/errors";
import { loadOwnedReservation } from "../../_lib/reservations";
import { previewCancellation, previewModification, type ReservationView } from "../../_lib/server-api";
import { CancelForm, ConfirmModifyForm } from "./manage-forms";

export const metadata: Metadata = { title: "Booking details" };

export default function RentalPage(props: PageProps<"/rentals/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton rows={1} label="Loading booking" />}>
      <RentalContent {...props} />
    </Suspense>
  );
}

async function RentalContent({ params, searchParams }: PageProps<"/rentals/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { user, reservation: r } = await loadOwnedReservation(id, `/rentals/${id}`);
  await connection();
  const now = new Date();
  const actor = toActor(user);
  const tz = r.pickupBranch.timezone;
  const hasVoucher = ["CONFIRMED", "PICKED_UP", "RETURNED"].includes(r.status);
  const canChange = (r.status === "CONFIRMED" || r.status === "PENDING") && r.pickupAt.getTime() > now.getTime();
  const cancellation = ["PENDING", "CONFIRMED"].includes(r.status) ? await previewCancellation(actor, r.id) : null;

  return (
    <Container className="py-6 sm:py-10">
      <Link href="/rentals" className="inline-flex items-center gap-1 text-sm font-medium text-ink-600 hover:text-ink-900">
        <ArrowLeft className="size-4" aria-hidden /> My rentals
      </Link>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">
          {r.vehicle.make} {r.vehicle.model}
        </h1>
        <ReservationStatusBadge status={r.status} />
        <span className="font-mono text-sm text-ink-500">{r.reference}</span>
      </div>
      {first(sp.changed) === "1" ? (
        <Alert tone="success" className="mt-4">
          Your dates were updated. Any price difference has been charged or refunded.
        </Alert>
      ) : null}
      {r.status === "PENDING" ? (
        <Alert tone="warning" className="mt-4" title="Payment needed">
          This booking isn&apos;t confirmed yet.{" "}
          <Link href={`/checkout/${r.id}`} className="font-semibold underline">
            Finish checkout
          </Link>
        </Alert>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardBody className="grid gap-5 sm:grid-cols-2">
              <TripLeg label="Pick-up" at={r.pickupAt} branch={r.pickupBranch} />
              <TripLeg label="Return" at={r.returnAt} branch={r.returnBranch} />
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <Badge>{r.vehicle.category.name}</Badge>
                <Badge>{r.vehicle.transmission === "MANUAL" ? "Manual" : "Automatic"}</Badge>
                <Badge>{r.vehicle.seats} seats</Badge>
                {r.extras.map((e) => (
                  <Badge key={e.extraId} tone="gold">
                    {e.name}
                    {e.quantity > 1 ? ` × ${e.quantity}` : ""}
                  </Badge>
                ))}
              </div>
            </CardBody>
          </Card>

          {hasVoucher ? (
            <LinkButton href={`/rentals/${r.id}/voucher`} variant="accent" size="lg">
              <Ticket className="size-5" aria-hidden /> View pick-up voucher
            </LinkButton>
          ) : null}

          {canChange ? <ChangeDates r={r} user={user} sp={sp} now={now} /> : null}

          {cancellation ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <XCircle className="size-5 text-danger-700" aria-hidden /> Cancel booking
                </CardTitle>
                <p className="text-sm text-ink-600">{cancellation.policy}</p>
              </CardHeader>
              <CardBody>
                {cancellation.cancellable ? (
                  <CancelForm
                    reservationId={r.id}
                    summary={
                      cancellation.feeFils > 0
                        ? `A cancellation fee of ${formatAed(cancellation.feeFils)} applies. You'll be refunded ${formatAed(cancellation.refundFils)}, and your deposit will be released.`
                        : `You'll be refunded ${formatAed(cancellation.refundFils)} and your deposit will be released.`
                    }
                  />
                ) : (
                  <p className="text-sm text-ink-700">{cancellation.reason ?? "This booking can no longer be cancelled online."}</p>
                )}
              </CardBody>
            </Card>
          ) : null}

          {r.agreement ? (
            <Card>
              <CardHeader>
                <CardTitle>Rental record</CardTitle>
              </CardHeader>
              <CardBody>
                <DescriptionList
                  items={[
                    { term: "Picked up", detail: formatDateTime(r.agreement.pickedUpAt, tz) },
                    { term: "Mileage / fuel at pick-up", detail: `${r.agreement.pickupMileageKm} km · ${r.agreement.pickupFuelLevel}%` },
                    ...(r.agreement.returnedAt
                      ? [
                          { term: "Returned", detail: formatDateTime(r.agreement.returnedAt, r.returnBranch.timezone) },
                          {
                            term: "Mileage / fuel at return",
                            detail: `${r.agreement.returnMileageKm ?? "–"} km · ${r.agreement.returnFuelLevel ?? "–"}%`,
                          },
                          { term: "Late fee", detail: formatAed(r.agreement.lateFeeFils) },
                          { term: "Damage charge", detail: formatAed(r.agreement.damageChargeFils) },
                          { term: "Taken from deposit", detail: formatAed(r.agreement.depositCapturedFils) },
                        ]
                      : []),
                  ]}
                />
              </CardBody>
            </Card>
          ) : null}
        </div>

        <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardBody>
              <PriceBreakdown quote={{ ...r.pricing, extras: r.pricing.quote.extras }} title="Price" />
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Payments</CardTitle>
            </CardHeader>
            <CardBody>
              <DescriptionList
                items={[
                  { term: "Paid (net of refunds)", detail: formatAed(r.paidFils) },
                  ...r.payments.map((p) => ({
                    term: `${p.purpose === "ADJUSTMENT" ? "Date change" : "Rental"} · ${formatDateTime(p.createdAt, tz)}`,
                    detail: `${formatAed(p.amountFils)} · ${p.status.toLowerCase()}${p.amountRefundedFils ? ` (refunded ${formatAed(p.amountRefundedFils)})` : ""}`,
                  })),
                  ...(r.deposit
                    ? [
                        {
                          term: "Security deposit",
                          detail: `${formatAed(r.deposit.amountFils)} · ${r.deposit.status.toLowerCase()}${r.deposit.amountCapturedFils ? ` (captured ${formatAed(r.deposit.amountCapturedFils)})` : ""}`,
                        },
                      ]
                    : []),
                ]}
              />
            </CardBody>
          </Card>
        </aside>
      </div>
    </Container>
  );
}

function TripLeg({ label, at, branch }: { label: string; at: Date; branch: ReservationView["pickupBranch"] }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-ink-500 uppercase">
        <MapPin className="size-3.5" aria-hidden /> {label}
      </p>
      <p className="mt-1 flex items-center gap-1.5 font-semibold text-ink-900">
        <CalendarDays className="size-4 text-ink-400" aria-hidden /> {formatDateTime(at, branch.timezone)}
      </p>
      <p className="text-sm text-ink-700">{branch.name}</p>
      <p className="text-sm text-ink-600">{branch.address}</p>
      <p className="text-xs text-ink-500">{branch.timezone}</p>
    </div>
  );
}

async function ChangeDates({
  r,
  user,
  sp,
  now,
}: {
  r: ReservationView;
  user: CurrentUser;
  sp: Record<string, string | string[] | undefined>;
  now: Date;
}) {
  const cur = { p: utcToZonedParts(r.pickupAt, r.pickupBranch.timezone), r: utcToZonedParts(r.returnAt, r.returnBranch.timezone) };
  const minDate = utcToZonedParts(now, r.pickupBranch.timezone).date;
  const want = {
    pickupDate: first(sp.pickupDate),
    pickupTime: first(sp.pickupTime),
    returnDate: first(sp.returnDate),
    returnTime: first(sp.returnTime),
  };
  let preview: Awaited<ReturnType<typeof previewModification>> | null = null;
  let previewError: string | null = null;
  if (want.pickupDate && want.pickupTime && want.returnDate && want.returnTime) {
    const pickupAt = zonedToUtc(want.pickupDate, want.pickupTime, r.pickupBranch.timezone);
    const returnAt = zonedToUtc(want.returnDate, want.returnTime, r.returnBranch.timezone);
    if (!pickupAt || !returnAt) previewError = "Please choose valid dates and times.";
    else if (returnAt <= pickupAt) previewError = "Return must be after pick-up.";
    else {
      try {
        preview = await previewModification(toActor(user), { reservationId: r.id, pickupAt, returnAt });
      } catch (e) {
        if (!isDomainError(e)) throw e;
        previewError = e.message;
      }
    }
  }

  return (
    <Card id="change-dates">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="size-5 text-gold-600" aria-hidden /> Change dates
        </CardTitle>
        <p className="text-sm text-ink-600">Same car and branches. We&apos;ll re-price your booking on our server.</p>
      </CardHeader>
      <CardBody className="space-y-5">
        <form action={`/rentals/${r.id}#change-dates`} method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="m-pdate">New pick-up date</Label>
            <Input id="m-pdate" type="date" name="pickupDate" min={minDate} required defaultValue={want.pickupDate ?? cur.p.date} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="m-ptime">Pick-up time</Label>
            <Select id="m-ptime" name="pickupTime" defaultValue={want.pickupTime ?? cur.p.time}>
              {TIME_SLOTS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="m-rdate">New return date</Label>
            <Input id="m-rdate" type="date" name="returnDate" min={minDate} required defaultValue={want.returnDate ?? cur.r.date} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="m-rtime">Return time</Label>
            <Select id="m-rtime" name="returnTime" defaultValue={want.returnTime ?? cur.r.time}>
              {TIME_SLOTS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          </div>
          <button type="submit" className={buttonClass("secondary", "md", "sm:col-span-2 lg:col-span-4 lg:justify-self-start")}>
            Check new price
          </button>
        </form>

        {previewError ? <Alert tone="danger">{previewError}</Alert> : null}
        {preview ? (
          preview.available ? (
            <div className="space-y-4 rounded-xl border border-ink-100 bg-ink-50 p-4">
              <PriceBreakdown quote={preview.quote} title="New price" />
              <p className="text-sm font-medium text-ink-900">
                {preview.differenceFils > 0
                  ? `You'll pay an extra ${formatAed(preview.differenceFils)} now.`
                  : preview.differenceFils < 0
                    ? `You'll be refunded ${formatAed(-preview.differenceFils)}.`
                    : "No change in price."}
              </p>
              <ConfirmModifyForm
                needsPayment={preview.differenceFils > 0 && r.status === "CONFIRMED"}
                label="Confirm new dates"
                hidden={{
                  reservationId: r.id,
                  pickupDate: want.pickupDate!,
                  pickupTime: want.pickupTime!,
                  returnDate: want.returnDate!,
                  returnTime: want.returnTime!,
                  idempotencyKey: crypto.randomUUID(),
                }}
              />
            </div>
          ) : (
            <Alert tone="warning" title="Not available">
              This car is already booked for part of those dates. Try different times.
            </Alert>
          )
        ) : null}
      </CardBody>
    </Card>
  );
}
