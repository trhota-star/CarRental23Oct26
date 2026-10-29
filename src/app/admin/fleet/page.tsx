import { CarFront, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { VehicleStatusBadge } from "@/components/ui/badge";
import { buttonClass, LinkButton } from "@/components/ui/button";
import { EmptyState, ListSkeleton } from "@/components/ui/feedback";
import { Label, Select } from "@/components/ui/form";
import { Container, PageHeader } from "@/components/ui/page";
import { first } from "@/lib/search-params";
import { requireAdmin } from "@/server/auth/session";
import { listBranches, listCategories, listVehicles } from "../../_lib/server-api";

export const metadata: Metadata = { title: "Fleet" };

const STATUSES = ["AVAILABLE", "ON_RENT", "MAINTENANCE", "RESERVED", "RETIRED"] as const;

export default function FleetPage(props: PageProps<"/admin/fleet">) {
  return (
    <Container className="py-8">
      <PageHeader
        title="Fleet"
        description="Every vehicle, where it is based and its current state."
        actions={
          <LinkButton href="/admin/fleet/new">
            <Plus className="size-4" aria-hidden /> Add vehicle
          </LinkButton>
        }
      />
      <Suspense fallback={<ListSkeleton rows={8} />}>
        <FleetList {...props} />
      </Suspense>
    </Container>
  );
}

async function FleetList({ searchParams }: PageProps<"/admin/fleet">) {
  const sp = await searchParams;
  await requireAdmin("/admin/fleet");
  const [branches, categories] = await Promise.all([listBranches({ includeInactive: true }), listCategories()]);
  const branchId = branches.find((b) => b.id === first(sp.branch))?.id;
  const categoryId = categories.find((c) => c.id === first(sp.category))?.id;
  const status = STATUSES.find((s) => s === first(sp.status));
  const vehicles = await listVehicles({ branchId, categoryId, status });

  return (
    <div className="space-y-5">
      <form method="get" className="grid gap-3 rounded-card border border-ink-100 bg-white p-4 shadow-card sm:grid-cols-4 sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="fl-branch">Branch</Label>
          <Select id="fl-branch" name="branch" defaultValue={branchId ?? ""}>
            <option value="">All</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} — {b.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fl-cat">Category</Label>
          <Select id="fl-cat" name="category" defaultValue={categoryId ?? ""}>
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fl-status">Status</Label>
          <Select id="fl-status" name="status" defaultValue={status ?? ""}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ").toLowerCase()}
              </option>
            ))}
          </Select>
        </div>
        <button type="submit" className={buttonClass("primary", "md")}>
          Filter
        </button>
      </form>
      {vehicles.length === 0 ? (
        <EmptyState icon={CarFront} title="No vehicles match" action={<LinkButton href="/admin/fleet/new">Add vehicle</LinkButton>} />
      ) : (
        <div className="overflow-x-auto rounded-card border border-ink-100 bg-white shadow-card">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <caption className="sr-only">Vehicles</caption>
            <thead className="border-b border-ink-100 bg-ink-50 text-xs tracking-wide text-ink-500 uppercase">
              <tr>
                <th scope="col" className="px-4 py-3">Vehicle</th>
                <th scope="col" className="px-4 py-3">Plate</th>
                <th scope="col" className="px-4 py-3">Category</th>
                <th scope="col" className="px-4 py-3">Branch</th>
                <th scope="col" className="px-4 py-3">Mileage</th>
                <th scope="col" className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {vehicles.map((v) => (
                <tr key={v.id} className="hover:bg-ink-50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/fleet/${v.id}`} className="font-semibold text-ink-900 hover:underline">
                      {v.make} {v.model}
                    </Link>
                    <span className="block text-xs text-ink-500">
                      {v.year}
                      {v.color ? ` · ${v.color}` : ""}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono">{v.plate}</td>
                  <td className="px-4 py-3">{v.category.name}</td>
                  <td className="px-4 py-3">{v.branch.code}</td>
                  <td className="px-4 py-3 tabular-nums">{v.mileageKm.toLocaleString("en-AE")} km</td>
                  <td className="px-4 py-3">
                    <VehicleStatusBadge status={v.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
