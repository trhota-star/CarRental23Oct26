import { Plus, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminForm } from "@/components/admin/admin-form";
import { DamagePhotos } from "@/components/admin/damage-photos";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ListSkeleton } from "@/components/ui/feedback";
import { Field, Input, Label, Select, Textarea } from "@/components/ui/form";
import { Container, PageHeader } from "@/components/ui/page";
import { filsToInput, formatAed, formatDateTime } from "@/lib/format";
import { first } from "@/lib/search-params";
import { requireAdmin, toActor } from "@/server/auth/session";
import { listDamageReports, listVehicles } from "../../_lib/server-api";
import { createDamageAction, updateDamageAction } from "../actions";

export const metadata: Metadata = { title: "Damage reports" };

const STATUSES = ["OPEN", "CHARGED", "RESOLVED"] as const;
const UUID = /^[0-9a-f-]{36}$/i;

export default function DamagePage(props: PageProps<"/admin/damage">) {
  return (
    <Container className="py-8">
      <PageHeader title="Damage reports" description="Photos are stored privately and only visible to staff and the customer on that booking." />
      <Suspense fallback={<ListSkeleton rows={6} />}>
        <DamageContent {...props} />
      </Suspense>
    </Container>
  );
}

async function DamageContent({ searchParams }: PageProps<"/admin/damage">) {
  const sp = await searchParams;
  const user = await requireAdmin("/admin/damage");
  const actor = toActor(user);
  const vehicles = await listVehicles();
  const vehicleId = vehicles.find((v) => v.id === first(sp.vehicle))?.id;
  const reservationParam = first(sp.reservation);
  const reservationId = reservationParam && UUID.test(reservationParam) ? reservationParam : undefined;
  const status = STATUSES.find((s) => s === first(sp.status));
  const reports = await listDamageReports(actor, { vehicleId, status });
  const vName = (id: string) => {
    const v = vehicles.find((x) => x.id === id);
    return v ? `${v.make} ${v.model} · ${v.plate}` : "Unknown vehicle";
  };
  const vTz = (id: string) => vehicles.find((x) => x.id === id)?.branch.timezone ?? "Asia/Dubai";

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="min-w-0 space-y-4">
        <form method="get" className="grid gap-3 rounded-card border border-ink-100 bg-white p-4 shadow-card sm:grid-cols-[1fr_10rem_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="d-vehicle">Vehicle</Label>
            <Select id="d-vehicle" name="vehicle" defaultValue={vehicleId ?? ""}>
              <option value="">All vehicles</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.make} {v.model} · {v.plate}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="d-status">Status</Label>
            <Select id="d-status" name="status" defaultValue={status ?? ""}>
              <option value="">All</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.toLowerCase()}
                </option>
              ))}
            </Select>
          </div>
          <button type="submit" className={buttonClass("primary", "md")}>
            Filter
          </button>
        </form>
        {reports.length === 0 ? (
          <EmptyState icon={TriangleAlert} title="No damage reports" description="Reports filed at check-in or here will appear in this list." />
        ) : (
          <ul className="space-y-3">
            {reports.map((d) => (
              <li key={d.id} className="rounded-card border border-ink-100 bg-white p-4 shadow-card">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-ink-900">{vName(d.vehicleId)}</span>
                  <Badge tone={d.severity === "MAJOR" ? "danger" : d.severity === "MODERATE" ? "warning" : "neutral"}>{d.severity.toLowerCase()}</Badge>
                  <Badge tone={d.status === "OPEN" ? "warning" : d.status === "CHARGED" ? "gold" : "success"}>{d.status.toLowerCase()}</Badge>
                  <span className="text-xs text-ink-500">{formatDateTime(d.createdAt, vTz(d.vehicleId))}</span>
                  {d.reservationId ? (
                    <Link href={`/admin/reservations/${d.reservationId}`} className="text-xs font-semibold underline">
                      View booking
                    </Link>
                  ) : null}
                </div>
                <p className="mt-2 text-sm text-ink-800">{d.description}</p>
                <p className="mt-1 text-xs text-ink-600">
                  Repair estimate: {d.repairCostFils != null ? formatAed(d.repairCostFils) : "—"} · Charged: {formatAed(d.chargedFils)}
                </p>
                <div className="mt-3">
                  <DamagePhotos keys={d.photoKeys} />
                </div>
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-medium text-ink-800 underline underline-offset-4">Update</summary>
                  <AdminForm action={updateDamageAction} hidden={{ id: d.id }} submitLabel="Save report" className="mt-3">
                    {d.photoKeys.map((k) => (
                      <input key={k} type="hidden" name="existingPhotoKeys" value={k} />
                    ))}
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Field label="Status" htmlFor={`du-s-${d.id}`}>
                        <Select id={`du-s-${d.id}`} name="status" defaultValue={d.status}>
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s.toLowerCase()}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Repair cost (AED)" htmlFor={`du-c-${d.id}`} optional>
                        <Input id={`du-c-${d.id}`} name="repairCost" inputMode="decimal" defaultValue={d.repairCostFils != null ? filsToInput(d.repairCostFils) : ""} />
                      </Field>
                      <Field label="Add photos" htmlFor={`du-p-${d.id}`} optional>
                        <input id={`du-p-${d.id}`} name="photos" type="file" multiple accept="image/jpeg,image/png,image/webp" className="block w-full text-sm" />
                      </Field>
                    </div>
                  </AdminForm>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Card className="self-start">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="size-5 text-gold-600" aria-hidden /> File a report
          </CardTitle>
        </CardHeader>
        <CardBody>
          <AdminForm action={createDamageAction} hidden={reservationId ? { reservationId } : undefined} submitLabel="File report" resetOnSuccess>
            <Field label="Vehicle" htmlFor="dn-vehicle">
              <Select id="dn-vehicle" name="vehicleId" required defaultValue={vehicleId ?? ""}>
                <option value="" disabled>
                  Choose…
                </option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.make} {v.model} · {v.plate}
                  </option>
                ))}
              </Select>
            </Field>
            {reservationId ? <p className="text-xs text-ink-600">Linked to the booking you came from.</p> : null}
            <Field label="Severity" htmlFor="dn-sev">
              <Select id="dn-sev" name="severity" defaultValue="MINOR">
                <option value="MINOR">Minor</option>
                <option value="MODERATE">Moderate</option>
                <option value="MAJOR">Major</option>
              </Select>
            </Field>
            <Field label="Description" htmlFor="dn-desc">
              <Textarea id="dn-desc" name="description" required minLength={3} maxLength={4000} rows={3} />
            </Field>
            <Field label="Repair estimate (AED)" htmlFor="dn-cost" optional>
              <Input id="dn-cost" name="repairCost" inputMode="decimal" placeholder="0.00" />
            </Field>
            <Field label="Photos" htmlFor="dn-photos" optional hint="Up to 6 images, 5 MB each.">
              <input id="dn-photos" name="photos" type="file" multiple accept="image/jpeg,image/png,image/webp" className="block w-full text-sm" aria-describedby="dn-photos-hint" />
            </Field>
          </AdminForm>
        </CardBody>
      </Card>
    </div>
  );
}
