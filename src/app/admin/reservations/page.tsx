import { ClipboardList } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ReservationTable } from "@/components/admin/reservation-table";
import { buttonClass } from "@/components/ui/button";
import { EmptyState, ListSkeleton } from "@/components/ui/feedback";
import { Input, Label, Select } from "@/components/ui/form";
import { Container, PageHeader } from "@/components/ui/page";
import { first, toQueryString } from "@/lib/search-params";
import { requireAdmin, toActor } from "@/server/auth/session";
import { listAllReservations, listBranches } from "../../_lib/server-api";

export const metadata: Metadata = { title: "Reservations" };

const STATUSES = ["PENDING", "CONFIRMED", "PICKED_UP", "RETURNED", "CANCELLED", "EXPIRED", "REFUNDED"] as const;
const PAGE = 25;

export default function AdminReservationsPage(props: PageProps<"/admin/reservations">) {
  return (
    <Container className="py-8">
      <PageHeader title="Reservations" description="Search by reference (or scanned voucher), customer name or email." />
      <Suspense fallback={<ListSkeleton rows={8} />}>
        <Results {...props} />
      </Suspense>
    </Container>
  );
}

async function Results({ searchParams }: PageProps<"/admin/reservations">) {
  const sp = await searchParams;
  const user = await requireAdmin("/admin/reservations");
  const status = STATUSES.find((s) => s === first(sp.status));
  const branches = await listBranches({ includeInactive: true });
  const branchId = branches.find((b) => b.id === first(sp.branch))?.id;
  const rawSearch = (first(sp.search) ?? "").trim();
  // Voucher QR codes encode "DRIVEEASY:<reference>".
  const search = rawSearch.replace(/^DRIVEEASY:/i, "").slice(0, 100) || undefined;
  const page = Math.max(1, Number.parseInt(first(sp.page) ?? "1", 10) || 1);

  const { items, total } = await listAllReservations(toActor(user), {
    statuses: status ? [status] : undefined,
    branchId,
    search,
    limit: PAGE,
    offset: (page - 1) * PAGE,
  });
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const qs = (p: number) => toQueryString({ status, branch: branchId, search, page: p > 1 ? p : undefined });

  return (
    <div className="space-y-5">
      <form method="get" className="grid gap-3 rounded-card border border-ink-100 bg-white p-4 shadow-card sm:grid-cols-[1fr_12rem_14rem_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="r-search">Search</Label>
          <Input id="r-search" name="search" defaultValue={rawSearch} placeholder="DE-XXXXXXXX, name or email" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="r-status">Status</Label>
          <Select id="r-status" name="status" defaultValue={status ?? ""}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ").toLowerCase()}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="r-branch">Pick-up branch</Label>
          <Select id="r-branch" name="branch" defaultValue={branchId ?? ""}>
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} — {b.name}
              </option>
            ))}
          </Select>
        </div>
        <button type="submit" className={buttonClass("primary", "md")}>
          Filter
        </button>
      </form>
      <p className="text-sm text-ink-600">
        {total} reservation{total === 1 ? "" : "s"}
      </p>
      {items.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No reservations match" description="Try a different search or status." />
      ) : (
        <ReservationTable items={items} caption="Reservations" />
      )}
      {pages > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-between">
          {page > 1 ? (
            <Link href={`/admin/reservations?${qs(page - 1)}`} className={buttonClass("secondary", "sm")}>
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-ink-600">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={`/admin/reservations?${qs(page + 1)}`} className={buttonClass("secondary", "sm")}>
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
