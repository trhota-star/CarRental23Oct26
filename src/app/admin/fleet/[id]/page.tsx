import { ArrowLeft, CalendarRange, Wrench } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AdminForm } from "@/components/admin/admin-form";
import { ReservationTable } from "@/components/admin/reservation-table";
import { VehicleFields } from "@/components/admin/vehicle-fields";
import { VehicleStatusBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, PageSkeleton } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/form";
import { Container } from "@/components/ui/page";
import { formatDateTime, TIME_SLOTS, utcToZonedParts } from "@/lib/format";
import { first } from "@/lib/search-params";
import { requireAdmin, toActor } from "@/server/auth/session";
import { isDomainError } from "@/server/errors";
import {
  getVehicle,
  listAllReservations,
  listBranches,
  listCategories,
  listFeatures,
  listMaintenanceBlocks,
} from "../../../_lib/server-api";
import { cancelMaintenanceAction, createMaintenanceAction, saveVehicleAction, setVehicleStatusAction } from "../../actions";

export const metadata: Metadata = { title: "Vehicle" };

export default function AdminVehiclePage(props: PageProps<"/admin/fleet/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton rows={1} label="Loading vehicle" />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ params, searchParams }: PageProps<"/admin/fleet/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const user = await requireAdmin(`/admin/fleet/${id}`);
  const actor = toActor(user);
  let v;
  try {
    v = await getVehicle(id);
  } catch (e) {
    if (isDomainError(e)) notFound();
    throw e;
  }
  await connection();
  const now = new Date();
  const tz = v.branch.timezone;
  const [branches, categories, features, blocks, bookings] = await Promise.all([
    listBranches({ includeInactive: true }),
    listCategories(),
    listFeatures(),
    listMaintenanceBlocks(actor, { vehicleId: v.id, from: now }),
    listAllReservations(actor, { vehicleId: v.id, statuses: ["PENDING", "CONFIRMED", "PICKED_UP"], limit: 50 }),
  ]);
  const today = utcToZonedParts(now, tz).date;

  return (
    <Container className="py-8">
      <Link href="/admin/fleet" className="inline-flex items-center gap-1 text-sm font-medium text-ink-600 hover:text-ink-900">
        <ArrowLeft className="size-4" aria-hidden /> Fleet
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-semibold text-ink-900">
          {v.make} {v.model}
        </h1>
        <span className="font-mono text-sm text-ink-500">{v.plate}</span>
        <VehicleStatusBadge status={v.status} />
      </div>
      {first(sp.created) === "1" ? (
        <Alert tone="success" className="mt-4">
          Vehicle added. It appears in search once a daily rate exists for its category.
        </Alert>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardBody>
              <AdminForm action={saveVehicleAction} hidden={{ id: v.id }} submitLabel="Save changes">
                <VehicleFields
                  v={{ ...v, featureIds: v.features.map((f) => f.id) }}
                  branches={branches}
                  categories={categories}
                  features={features}
                />
              </AdminForm>
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarRange className="size-5 text-gold-600" aria-hidden /> Upcoming and active bookings
              </CardTitle>
            </CardHeader>
            <CardBody>
              {bookings.items.length ? (
                <ReservationTable items={bookings.items} caption="Bookings for this vehicle" />
              ) : (
                <p className="text-sm text-ink-600">No upcoming bookings.</p>
              )}
            </CardBody>
          </Card>
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <p className="text-sm text-ink-600">On-rent status is set by check-out and check-in.</p>
            </CardHeader>
            <CardBody>
              <AdminForm action={setVehicleStatusAction} hidden={{ vehicleId: v.id }} submitLabel="Update status">
                <Field label="Status" htmlFor="vs-status">
                  <Select id="vs-status" name="status" defaultValue={["AVAILABLE", "MAINTENANCE", "RETIRED"].includes(v.status) ? v.status : "AVAILABLE"}>
                    <option value="AVAILABLE">Available</option>
                    <option value="MAINTENANCE">Maintenance (hidden from search)</option>
                    <option value="RETIRED">Retired (hidden from search)</option>
                  </Select>
                </Field>
              </AdminForm>
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wrench className="size-5 text-gold-600" aria-hidden /> Maintenance blocks
              </CardTitle>
              <p className="text-sm text-ink-600">Blocks the car for a period ({tz}). Fails if it overlaps a booking.</p>
            </CardHeader>
            <CardBody className="space-y-5">
              {blocks.length ? (
                <ul className="space-y-3">
                  {blocks.map((b) => (
                    <li key={b.id} className="rounded-xl bg-ink-50 p-3 text-sm">
                      <p className="font-medium text-ink-900">
                        {formatDateTime(b.startsAt, tz)} → {formatDateTime(b.endsAt, tz)}
                      </p>
                      <p className="text-ink-600">{b.reason}</p>
                      <AdminForm action={cancelMaintenanceAction} hidden={{ id: b.id }} submitLabel="Cancel block" variant="ghost" confirmText="Cancel this maintenance block?" className="mt-2" />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-600">No upcoming maintenance.</p>
              )}
              <AdminForm action={createMaintenanceAction} hidden={{ vehicleId: v.id }} submitLabel="Add block" resetOnSuccess>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Start date" htmlFor="mb-sd">
                    <Input id="mb-sd" name="startDate" type="date" min={today} required />
                  </Field>
                  <Field label="Start time" htmlFor="mb-st">
                    <Select id="mb-st" name="startTime" defaultValue="08:00">
                      {TIME_SLOTS.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="End date" htmlFor="mb-ed">
                    <Input id="mb-ed" name="endDate" type="date" min={today} required />
                  </Field>
                  <Field label="End time" htmlFor="mb-et">
                    <Select id="mb-et" name="endTime" defaultValue="18:00">
                      {TIME_SLOTS.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <Field label="Reason" htmlFor="mb-reason">
                  <Input id="mb-reason" name="reason" required minLength={3} maxLength={500} placeholder="e.g. 20,000 km service" />
                </Field>
              </AdminForm>
            </CardBody>
          </Card>
          <Link href={`/admin/damage?vehicle=${v.id}`} className="block text-sm font-semibold text-ink-900 underline underline-offset-4">
            Damage reports for this car
          </Link>
        </aside>
      </div>
    </Container>
  );
}
