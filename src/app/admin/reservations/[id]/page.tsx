import { ArrowLeft, CarFront, ClipboardCheck, IdCard, KeyRound, TriangleAlert, XCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AdminForm } from "@/components/admin/admin-form";
import { DamagePhotos } from "@/components/admin/damage-photos";
import { PriceBreakdown } from "@/components/booking/price-breakdown";
import { Badge, ReservationStatusBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, PageSkeleton } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Container, DescriptionList } from "@/components/ui/page";
import { formatAed, formatDateTime } from "@/lib/format";
import { requireAdmin, toActor } from "@/server/auth/session";
import { isDomainError } from "@/server/errors";
import { fileUrl } from "../../../_lib/profile";
import {
  getDriverProfile,
  getReservationForUser,
  getVehicle,
  listBranches,
  listDamageReports,
  previewCancellation,
  previewCheckIn,
} from "../../../_lib/server-api";
import { adminCancelAction, checkInAction, checkOutAction } from "../../actions";

export const metadata: Metadata = { title: "Reservation" };

export default function AdminReservationPage(props: PageProps<"/admin/reservations/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton rows={1} label="Loading reservation" />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ params }: PageProps<"/admin/reservations/[id]">) {
  const { id } = await params;
  const user = await requireAdmin(`/admin/reservations/${id}`);
  const actor = toActor(user);
  let r;
  try {
    r = await getReservationForUser(actor, id);
  } catch (e) {
    if (isDomainError(e)) notFound();
    throw e;
  }
  await connection();
  const [profile, vehicle, branches, damage, checkInPreview, cancelPreview] = await Promise.all([
    getDriverProfile(actor, r.userId),
    getVehicle(r.vehicle.id),
    listBranches(),
    listDamageReports(actor, { reservationId: r.id }),
    r.status === "PICKED_UP" ? previewCheckIn(actor, { reservationId: r.id }) : Promise.resolve(null),
    r.status === "PENDING" || r.status === "CONFIRMED" ? previewCancellation(actor, r.id) : Promise.resolve(null),
  ]);
  const tz = r.pickupBranch.timezone;

  return (
    <Container className="py-8">
      <Link href="/admin/reservations" className="inline-flex items-center gap-1 text-sm font-medium text-ink-600 hover:text-ink-900">
        <ArrowLeft className="size-4" aria-hidden /> Reservations
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-2xl font-bold text-ink-900">{r.reference}</h1>
        <ReservationStatusBadge status={r.status} />
        <span className="text-sm text-ink-600">
          {r.customer.name} · {r.customer.email}
        </span>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CarFront className="size-5 text-gold-600" aria-hidden /> {r.vehicle.make} {r.vehicle.model}
                <span className="font-mono text-sm font-normal text-ink-500">{r.vehicle.plate}</span>
              </CardTitle>
            </CardHeader>
            <CardBody>
              <DescriptionList
                items={[
                  { term: "Pick-up", detail: `${formatDateTime(r.pickupAt, tz)} · ${r.pickupBranch.name}` },
                  { term: "Return", detail: `${formatDateTime(r.returnAt, r.returnBranch.timezone)} · ${r.returnBranch.name}` },
                  { term: "Vehicle now", detail: `${vehicle.status.replace("_", " ").toLowerCase()} · ${vehicle.mileageKm} km · fuel ${vehicle.fuelLevel}%` },
                  { term: "Extras", detail: r.extras.length ? r.extras.map((e) => `${e.name} × ${e.quantity}`).join(", ") : "None" },
                  { term: "Paid", detail: formatAed(r.paidFils) },
                  {
                    term: "Deposit",
                    detail: r.deposit
                      ? `${formatAed(r.deposit.amountFils)} · ${r.deposit.status.toLowerCase()}${r.deposit.amountCapturedFils ? ` · captured ${formatAed(r.deposit.amountCapturedFils)}` : ""}`
                      : "None",
                  },
                ]}
              />
            </CardBody>
          </Card>

          {r.status === "CONFIRMED" ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <KeyRound className="size-5 text-gold-600" aria-hidden /> Check-out (hand over keys)
                </CardTitle>
                <p className="text-sm text-ink-600">Record the odometer and fuel gauge as the customer leaves.</p>
              </CardHeader>
              <CardBody>
                {!profile?.licenceFileKey ? (
                  <Alert tone="warning" className="mb-4">
                    No licence on file for this customer. Check their licence in person before handing over the car.
                  </Alert>
                ) : null}
                <AdminForm action={checkOutAction} hidden={{ reservationId: r.id }} submitLabel="Confirm check-out" pendingLabel="Checking out…">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Mileage (km)" htmlFor="co-mileage" hint={`Last recorded: ${vehicle.mileageKm} km`}>
                      <Input id="co-mileage" name="mileageKm" type="number" inputMode="numeric" min={vehicle.mileageKm} defaultValue={vehicle.mileageKm} required aria-describedby="co-mileage-hint" />
                    </Field>
                    <Field label="Fuel level (%)" htmlFor="co-fuel">
                      <Input id="co-fuel" name="fuelLevel" type="number" inputMode="numeric" min={0} max={100} defaultValue={vehicle.fuelLevel} required />
                    </Field>
                    <Field label="Notes" htmlFor="co-notes" optional className="sm:col-span-2">
                      <Textarea id="co-notes" name="notes" rows={2} maxLength={2000} />
                    </Field>
                  </div>
                </AdminForm>
              </CardBody>
            </Card>
          ) : null}

          {r.status === "PICKED_UP" && r.agreement ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ClipboardCheck className="size-5 text-gold-600" aria-hidden /> Check-in (car returned)
                </CardTitle>
                <p className="text-sm text-ink-600">
                  Picked up at {r.agreement.pickupMileageKm} km, fuel {r.agreement.pickupFuelLevel}%.
                  {checkInPreview && checkInPreview.lateFee.totalFils > 0
                    ? ` If checked in now, the late fee is ${formatAed(checkInPreview.lateFee.totalFils)} (incl. VAT).`
                    : " Returning now: no late fee."}{" "}
                  Charges are taken from the {formatAed(checkInPreview?.depositFils ?? r.pricing.depositFils)} deposit.
                </p>
              </CardHeader>
              <CardBody>
                <AdminForm action={checkInAction} hidden={{ reservationId: r.id }} submitLabel="Confirm check-in" pendingLabel="Checking in…">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Mileage (km)" htmlFor="ci-mileage">
                      <Input id="ci-mileage" name="mileageKm" type="number" inputMode="numeric" min={r.agreement.pickupMileageKm} required />
                    </Field>
                    <Field label="Fuel level (%)" htmlFor="ci-fuel">
                      <Input id="ci-fuel" name="fuelLevel" type="number" inputMode="numeric" min={0} max={100} required />
                    </Field>
                    <Field label="Returned to" htmlFor="ci-branch">
                      <Select id="ci-branch" name="returnBranchId" defaultValue={r.returnBranch.id}>
                        {branches.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.code} — {b.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Notes" htmlFor="ci-notes" optional>
                      <Input id="ci-notes" name="notes" maxLength={2000} />
                    </Field>
                  </div>
                  <fieldset className="space-y-4 rounded-xl border border-ink-200 p-4">
                    <legend className="px-1 text-sm font-semibold text-ink-900">Damage</legend>
                    <label className="flex items-center gap-2 text-sm text-ink-800">
                      <Checkbox name="hasDamage" /> The car has new damage
                    </label>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Severity" htmlFor="ci-sev">
                        <Select id="ci-sev" name="severity" defaultValue="MINOR">
                          <option value="MINOR">Minor</option>
                          <option value="MODERATE">Moderate</option>
                          <option value="MAJOR">Major</option>
                        </Select>
                      </Field>
                      <Field label="Charge to customer (AED)" htmlFor="ci-charge" hint="Taken from the deposit, capped at the hold.">
                        <Input id="ci-charge" name="damageCharge" inputMode="decimal" placeholder="0.00" aria-describedby="ci-charge-hint" />
                      </Field>
                      <Field label="Estimated repair cost (AED)" htmlFor="ci-repair" optional>
                        <Input id="ci-repair" name="repairCost" inputMode="decimal" placeholder="0.00" />
                      </Field>
                      <Field label="Photos" htmlFor="ci-photos" optional hint="JPEG, PNG or WebP, up to 5 MB each, max 6.">
                        <input id="ci-photos" name="photos" type="file" multiple accept="image/jpeg,image/png,image/webp" className="block w-full text-sm" aria-describedby="ci-photos-hint" />
                      </Field>
                      <Field label="Description" htmlFor="ci-desc" className="sm:col-span-2">
                        <Textarea id="ci-desc" name="damageDescription" rows={2} maxLength={4000} placeholder="e.g. Scratch on rear bumper, left side" />
                      </Field>
                    </div>
                  </fieldset>
                </AdminForm>
              </CardBody>
            </Card>
          ) : null}

          {r.agreement ? (
            <Card>
              <CardHeader>
                <CardTitle>Rental agreement</CardTitle>
              </CardHeader>
              <CardBody>
                <DescriptionList
                  items={[
                    { term: "Picked up", detail: `${formatDateTime(r.agreement.pickedUpAt, tz)} · ${r.agreement.pickupMileageKm} km · fuel ${r.agreement.pickupFuelLevel}%` },
                    ...(r.agreement.pickupNotes ? [{ term: "Pick-up notes", detail: r.agreement.pickupNotes }] : []),
                    ...(r.agreement.returnedAt
                      ? [
                          { term: "Returned", detail: `${formatDateTime(r.agreement.returnedAt, r.returnBranch.timezone)} · ${r.agreement.returnMileageKm} km · fuel ${r.agreement.returnFuelLevel}%` },
                          { term: "Late", detail: `${r.agreement.lateMinutes} min · ${formatAed(r.agreement.lateFeeFils)}` },
                          { term: "Damage charge", detail: formatAed(r.agreement.damageChargeFils) },
                          { term: "Captured from deposit", detail: formatAed(r.agreement.depositCapturedFils) },
                        ]
                      : []),
                  ]}
                />
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <TriangleAlert className="size-5 text-gold-600" aria-hidden /> Damage reports
              </CardTitle>
              <Link href={`/admin/damage?vehicle=${r.vehicle.id}&reservation=${r.id}`} className="text-sm font-semibold text-ink-900 underline underline-offset-4">
                File a report
              </Link>
            </CardHeader>
            <CardBody>
              {damage.length === 0 ? (
                <p className="text-sm text-ink-600">No damage recorded for this booking.</p>
              ) : (
                <ul className="space-y-4">
                  {damage.map((d) => (
                    <li key={d.id} className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={d.severity === "MAJOR" ? "danger" : d.severity === "MODERATE" ? "warning" : "neutral"}>{d.severity.toLowerCase()}</Badge>
                        <Badge>{d.status.toLowerCase()}</Badge>
                        <span className="text-xs text-ink-500">{formatDateTime(d.createdAt, tz)}</span>
                      </div>
                      <p className="text-sm text-ink-800">{d.description}</p>
                      <DamagePhotos keys={d.photoKeys} />
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {cancelPreview ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <XCircle className="size-5 text-danger-700" aria-hidden /> Cancel booking
                </CardTitle>
                <p className="text-sm text-ink-600">{cancelPreview.policy}</p>
              </CardHeader>
              <CardBody>
                {cancelPreview.cancellable ? (
                  <AdminForm
                    action={adminCancelAction}
                    hidden={{ reservationId: r.id }}
                    submitLabel="Cancel booking"
                    variant="danger"
                    confirmText={`Cancel ${r.reference}? Refund: ${formatAed(cancelPreview.refundFils)}.`}
                  >
                    <p className="text-sm text-ink-700">
                      Refund {formatAed(cancelPreview.refundFils)}
                      {cancelPreview.feeFils ? `, fee kept ${formatAed(cancelPreview.feeFils)}` : ""}. The deposit is released.
                    </p>
                    <Field label="Reason" htmlFor="ac-reason" optional>
                      <Input id="ac-reason" name="reason" maxLength={500} />
                    </Field>
                  </AdminForm>
                ) : (
                  <p className="text-sm text-ink-700">{cancelPreview.reason}</p>
                )}
              </CardBody>
            </Card>
          ) : null}
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <IdCard className="size-5 text-gold-600" aria-hidden /> Driver
              </CardTitle>
            </CardHeader>
            <CardBody>
              {profile ? (
                <DescriptionList
                  items={[
                    { term: "Name", detail: profile.fullName },
                    { term: "Phone", detail: profile.phone },
                    { term: "Date of birth", detail: profile.dateOfBirth },
                    { term: "Licence", detail: `${profile.licenceNumber} (${profile.licenceCountry})` },
                    { term: "Licence expiry", detail: profile.licenceExpiry },
                    {
                      term: "Licence photo",
                      detail: profile.licenceFileKey ? (
                        <a href={fileUrl(profile.licenceFileKey)} target="_blank" rel="noreferrer" className="font-semibold underline">
                          View
                        </a>
                      ) : (
                        "Not uploaded"
                      ),
                    },
                  ]}
                />
              ) : (
                <p className="text-sm text-ink-600">No driver profile yet.</p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <PriceBreakdown quote={{ ...r.pricing, extras: r.pricing.quote.extras }} title="Booking price" />
            </CardBody>
          </Card>
        </aside>
      </div>
    </Container>
  );
}
