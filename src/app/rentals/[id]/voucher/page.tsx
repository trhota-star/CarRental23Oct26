import { CheckCircle2, Clock3, IdCard, MapPin, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { Suspense } from "react";
import { PrintButton } from "@/components/booking/print-button";
import { BookingSteps } from "@/components/booking/steps";
import { ReservationStatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Alert, PageSkeleton } from "@/components/ui/feedback";
import { Container, DescriptionList } from "@/components/ui/page";
import { formatAed, formatDateTime } from "@/lib/format";
import { first } from "@/lib/search-params";
import { loadOwnedReservation } from "../../../_lib/reservations";

export const metadata: Metadata = { title: "Pick-up voucher" };

const VOUCHER_STATUSES = new Set(["CONFIRMED", "PICKED_UP", "RETURNED"]);

export default function VoucherPage(props: PageProps<"/rentals/[id]/voucher">) {
  return (
    <Suspense fallback={<PageSkeleton rows={1} label="Loading voucher" />}>
      <VoucherContent {...props} />
    </Suspense>
  );
}

async function VoucherContent({ params, searchParams }: PageProps<"/rentals/[id]/voucher">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { reservation: r } = await loadOwnedReservation(id, `/rentals/${id}/voucher`);
  if (r.status === "PENDING") redirect(`/checkout/${r.id}`);
  if (!VOUCHER_STATUSES.has(r.status)) redirect(`/rentals/${r.id}`);
  const isNew = first(sp.new) === "1";

  // The QR encodes only the booking reference: staff look it up in the admin console.
  const qrSvg = await QRCode.toString(`DRIVEEASY:${r.reference}`, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    color: { dark: "#0c1b2c", light: "#ffffff" },
  });

  return (
    <Container className="py-6 sm:py-10">
      {isNew ? <BookingSteps current={3} className="print:hidden" /> : null}
      {isNew ? (
        <Alert tone="success" title="You're booked!" className="mt-6 print:hidden">
          Payment received and your deposit is held. Show this voucher at the desk when you pick up.
        </Alert>
      ) : null}

      <article
        aria-labelledby="voucher-title"
        className="mx-auto mt-6 max-w-3xl overflow-hidden rounded-card border border-ink-100 bg-white shadow-card print:shadow-none"
      >
        <header className="flex flex-wrap items-center justify-between gap-3 bg-ink-950 px-6 py-5 text-white">
          <div>
            <p className="text-xs font-semibold tracking-[0.14em] text-gold-300 uppercase">Pick-up voucher</p>
            <h1 id="voucher-title" className="font-display text-2xl font-semibold">
              DriveEasy
            </h1>
          </div>
          <div className="text-right">
            <p className="text-xs text-ink-300">Booking reference</p>
            <p className="font-mono text-2xl font-bold tracking-wider text-gold-300">{r.reference}</p>
          </div>
        </header>

        <div className="grid gap-6 p-6 sm:grid-cols-[1fr_auto]">
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <ReservationStatusBadge status={r.status} />
              <span className="text-sm text-ink-600">Main driver: {r.customer.name}</span>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-ink-900">
                {r.vehicle.make} {r.vehicle.model} <span className="font-normal text-ink-500">or similar</span>
              </h2>
              <p className="text-sm text-ink-600">
                {r.vehicle.category.name} · {r.vehicle.year}
                {r.vehicle.color ? ` · ${r.vehicle.color}` : ""}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl bg-ink-50 p-4">
                <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-ink-500 uppercase">
                  <MapPin className="size-3.5" aria-hidden /> Pick-up
                </p>
                <p className="mt-1 font-semibold text-ink-900">{formatDateTime(r.pickupAt, r.pickupBranch.timezone)}</p>
                <p className="text-sm text-ink-700">{r.pickupBranch.name}</p>
                <p className="text-sm text-ink-600">{r.pickupBranch.address}</p>
              </div>
              <div className="rounded-xl bg-ink-50 p-4">
                <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-ink-500 uppercase">
                  <MapPin className="size-3.5" aria-hidden /> Return
                </p>
                <p className="mt-1 font-semibold text-ink-900">{formatDateTime(r.returnAt, r.returnBranch.timezone)}</p>
                <p className="text-sm text-ink-700">{r.returnBranch.name}</p>
                <p className="text-sm text-ink-600">{r.returnBranch.address}</p>
              </div>
            </div>
            <p className="flex items-center gap-1.5 text-xs text-ink-500">
              <Clock3 className="size-3.5" aria-hidden /> Times are local to the branch ({r.pickupBranch.timezone}).
            </p>
          </div>
          <figure className="flex flex-col items-center gap-2 justify-self-center">
            <div
              className="size-44 rounded-xl border border-ink-100 p-1 [&_svg]:size-full"
              role="img"
              aria-label={`QR code for booking ${r.reference}`}
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
            <figcaption className="text-xs text-ink-500">Scan at the desk</figcaption>
          </figure>
        </div>

        <div className="grid gap-6 border-t border-ink-100 p-6 sm:grid-cols-2">
          <DescriptionList
            items={[
              { term: "Paid", detail: formatAed(r.paidFils) },
              { term: "Booking total (incl. VAT)", detail: formatAed(r.pricing.totalFils) },
              {
                term: "Security deposit (held)",
                detail: `${formatAed(r.pricing.depositFils)}${r.deposit ? ` · ${r.deposit.status.toLowerCase()}` : ""}`,
              },
              ...r.extras.map((e) => ({ term: `Extra: ${e.name}`, detail: `× ${e.quantity}` })),
            ]}
          />
          <ul className="space-y-3 text-sm text-ink-700">
            <li className="flex gap-2">
              <IdCard className="mt-0.5 size-4 shrink-0 text-gold-600" aria-hidden />
              Bring the driving licence you uploaded and your Emirates ID or passport.
            </li>
            <li className="flex gap-2">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-gold-600" aria-hidden />
              The deposit is released after the car is returned, minus any late fee or damage.
            </li>
            <li className="flex gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-gold-600" aria-hidden />
              Return the car with the same fuel level to avoid refuelling charges.
            </li>
          </ul>
        </div>
      </article>

      <div className="mx-auto mt-6 flex max-w-3xl flex-wrap gap-3 print:hidden">
        <PrintButton />
        <LinkButton href={`/rentals/${r.id}`} variant="primary">
          Manage booking
        </LinkButton>
        <Link href="/rentals" className="self-center text-sm font-semibold text-ink-900 underline underline-offset-4">
          All my rentals
        </Link>
      </div>
    </Container>
  );
}
