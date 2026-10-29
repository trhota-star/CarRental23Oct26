import { CalendarDays, CircleAlert, IdCard, MapPin } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { HoldCountdown } from "@/components/booking/hold-countdown";
import { PriceBreakdown } from "@/components/booking/price-breakdown";
import { BookingSteps } from "@/components/booking/steps";
import { DriverProfileForm } from "@/components/profile/driver-profile-form";
import { ReservationStatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, EmptyState, PageSkeleton } from "@/components/ui/feedback";
import { Container } from "@/components/ui/page";
import { formatAed, formatDateTime } from "@/lib/format";
import { toQueryString } from "@/lib/search-params";
import { loadDriverProfileForm } from "../../_lib/profile";
import { loadOwnedReservation } from "../../_lib/reservations";
import { PaymentForm } from "./payment-form";

export const metadata: Metadata = { title: "Checkout" };

export default function CheckoutPage(props: PageProps<"/checkout/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton rows={1} label="Loading checkout" />}>
      <CheckoutContent {...props} />
    </Suspense>
  );
}

async function CheckoutContent({ params }: PageProps<"/checkout/[id]">) {
  const { id } = await params;
  const { user, reservation: r } = await loadOwnedReservation(id, `/checkout/${id}`);
  if (r.status === "CONFIRMED" || r.status === "PICKED_UP" || r.status === "RETURNED") {
    redirect(`/rentals/${r.id}/voucher`);
  }
  await connection();
  const now = new Date().getTime();

  const pickupTz = r.pickupBranch.timezone;
  const returnTz = r.returnBranch.timezone;
  const retry = toQueryString({
    pickupBranchId: r.pickupBranch.id,
    returnBranchId: r.returnBranch.id,
  });

  if (r.status !== "PENDING" || (r.holdExpiresAt && r.holdExpiresAt.getTime() <= now)) {
    return (
      <Container className="py-10">
        <EmptyState
          icon={CircleAlert}
          title={r.status === "CANCELLED" ? "This booking was cancelled" : "Your hold has expired"}
          description="The car was released so others can book it. Nothing was charged for an unpaid hold. You can search again; it may still be available."
          action={
            <LinkButton href={`/vehicles/${r.vehicle.id}?${retry}`} variant="primary">
              Check this car again
            </LinkButton>
          }
        />
      </Container>
    );
  }

  const profile = await loadDriverProfileForm(user);
  const idempotencyKey = crypto.randomUUID();

  return (
    <Container className="py-6 sm:py-10">
      <BookingSteps current={2} />
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">Checkout</h1>
        <ReservationStatusBadge status={r.status} />
        <span className="font-mono text-sm text-ink-500">{r.reference}</span>
      </div>
      {r.holdExpiresAt ? (
        <div className="mt-4 max-w-xl">
          <HoldCountdown expiresAt={r.holdExpiresAt.toISOString()} />
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>
                {r.vehicle.make} {r.vehicle.model}{" "}
                <span className="font-normal text-ink-500">· {r.vehicle.category.name}</span>
              </CardTitle>
            </CardHeader>
            <CardBody className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <p className="flex items-center gap-1.5 font-medium text-ink-900">
                  <MapPin className="size-4 text-gold-600" aria-hidden /> Pick-up
                </p>
                <p className="mt-1 text-ink-700">{r.pickupBranch.name}</p>
                <p className="text-ink-600">{r.pickupBranch.address}</p>
                <p className="mt-1 flex items-center gap-1.5 text-ink-900">
                  <CalendarDays className="size-4 text-ink-400" aria-hidden /> {formatDateTime(r.pickupAt, pickupTz)}
                </p>
              </div>
              <div>
                <p className="flex items-center gap-1.5 font-medium text-ink-900">
                  <MapPin className="size-4 text-gold-600" aria-hidden /> Return
                </p>
                <p className="mt-1 text-ink-700">{r.returnBranch.name}</p>
                <p className="text-ink-600">{r.returnBranch.address}</p>
                <p className="mt-1 flex items-center gap-1.5 text-ink-900">
                  <CalendarDays className="size-4 text-ink-400" aria-hidden /> {formatDateTime(r.returnAt, returnTz)}
                </p>
              </div>
              <p className="text-xs text-ink-500 sm:col-span-2">Times are local to each branch ({pickupTz}).</p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="flex items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2">
                <IdCard className="size-5 text-gold-600" aria-hidden /> Driver details &amp; licence
              </CardTitle>
              {profile.complete ? <span className="text-sm font-medium text-success-700">Complete</span> : null}
            </CardHeader>
            <CardBody>
              {profile.complete ? (
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-ink-800">
                    {profile.values.fullName} · licence {profile.values.licenceNumber} (expires{" "}
                    {profile.values.licenceExpiry}). <span className="underline">Edit</span>
                  </summary>
                  <div className="mt-4">
                    <DriverProfileForm initial={profile.values} />
                  </div>
                </details>
              ) : (
                <>
                  <p className="mb-4 text-sm text-ink-600">
                    We need the main driver&apos;s details and a photo of their driving licence before we can confirm
                    your booking.
                  </p>
                  <DriverProfileForm initial={profile.values} submitLabel="Save and continue" />
                </>
              )}
            </CardBody>
          </Card>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardBody>
              <PriceBreakdown quote={{ ...r.pricing, extras: r.pricing.quote.extras }} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Payment</CardTitle>
            </CardHeader>
            <CardBody>
              {!profile.complete ? (
                <Alert tone="warning" className="mb-4">
                  Add your driver details and licence first.
                </Alert>
              ) : null}
              <PaymentForm
                reservationId={r.id}
                idempotencyKey={idempotencyKey}
                totalLabel={formatAed(r.pricing.totalFils)}
                depositLabel={formatAed(r.pricing.depositFils)}
                disabled={!profile.complete}
              />
            </CardBody>
          </Card>
        </aside>
      </div>
    </Container>
  );
}
