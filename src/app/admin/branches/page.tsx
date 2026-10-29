import { MapPin, Plus } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminForm } from "@/components/admin/admin-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ListSkeleton } from "@/components/ui/feedback";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { Container, PageHeader } from "@/components/ui/page";
import { requireAdmin } from "@/server/auth/session";
import { listBranches, type Branch } from "../../_lib/server-api";
import { saveBranchAction } from "../actions";

export const metadata: Metadata = { title: "Branches" };

export default function AdminBranchesPage() {
  return (
    <Container className="py-8">
      <PageHeader title="Branches" description="Locations, opening hours and time zones. Inactive branches are hidden from customers." />
      <Suspense fallback={<ListSkeleton rows={4} />}>
        <BranchesContent />
      </Suspense>
    </Container>
  );
}

function BranchFields({ b, prefix }: { b?: Branch; prefix: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Code" htmlFor={`${prefix}-code`} hint="2–10 letters/digits, e.g. DXB">
        <Input id={`${prefix}-code`} name="code" required maxLength={10} defaultValue={b?.code} className="uppercase" aria-describedby={`${prefix}-code-hint`} />
      </Field>
      <Field label="Name" htmlFor={`${prefix}-name`}>
        <Input id={`${prefix}-name`} name="name" required maxLength={120} defaultValue={b?.name} />
      </Field>
      <Field label="City" htmlFor={`${prefix}-city`}>
        <Input id={`${prefix}-city`} name="city" required maxLength={80} defaultValue={b?.city} />
      </Field>
      <Field label="Address" htmlFor={`${prefix}-address`} className="sm:col-span-2">
        <Input id={`${prefix}-address`} name="address" required maxLength={300} defaultValue={b?.address} />
      </Field>
      <Field label="Phone" htmlFor={`${prefix}-phone`} optional>
        <Input id={`${prefix}-phone`} name="phone" type="tel" maxLength={40} defaultValue={b?.phone ?? ""} />
      </Field>
      <Field label="Time zone (IANA)" htmlFor={`${prefix}-tz`}>
        <Input id={`${prefix}-tz`} name="timezone" required defaultValue={b?.timezone ?? "Asia/Dubai"} />
      </Field>
      <Field label="Opening hours" htmlFor={`${prefix}-hours`} optional>
        <Input id={`${prefix}-hours`} name="openingHours" maxLength={200} defaultValue={b?.openingHours ?? ""} placeholder="Daily 08:00–22:00" />
      </Field>
      <label className="flex items-center gap-2 self-end pb-3 text-sm text-ink-800">
        <Checkbox name="isActive" defaultChecked={b ? b.isActive : true} /> Active (bookable)
      </label>
    </div>
  );
}

async function BranchesContent() {
  await requireAdmin("/admin/branches");
  const branches = await listBranches({ includeInactive: true });
  return (
    <div className="space-y-6">
      {branches.length === 0 ? (
        <EmptyState icon={MapPin} title="No branches yet" description="Add your first branch below." />
      ) : (
        <ul className="space-y-3">
          {branches.map((b) => (
            <li key={b.id}>
              <details className="group rounded-card border border-ink-100 bg-white shadow-card">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
                  <span className="rounded-md bg-ink-100 px-2 py-1 font-mono text-xs font-semibold">{b.code}</span>
                  <span className="font-semibold text-ink-900">{b.name}</span>
                  <span className="text-sm text-ink-600">{b.city}</span>
                  {b.isActive ? <Badge tone="success">active</Badge> : <Badge>inactive</Badge>}
                  <span className="ml-auto text-sm font-medium text-ink-700 underline underline-offset-4 group-open:hidden">Edit</span>
                </summary>
                <div className="border-t border-ink-100 p-4">
                  <AdminForm action={saveBranchAction} hidden={{ id: b.id }} submitLabel="Save branch">
                    <BranchFields b={b} prefix={`b-${b.code}`} />
                  </AdminForm>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="size-5 text-gold-600" aria-hidden /> Add branch
          </CardTitle>
        </CardHeader>
        <CardBody>
          <AdminForm action={saveBranchAction} submitLabel="Add branch" resetOnSuccess>
            <BranchFields prefix="b-new" />
          </AdminForm>
        </CardBody>
      </Card>
    </div>
  );
}
