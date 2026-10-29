import Link from "next/link";
import { ReservationStatusBadge } from "@/components/ui/badge";
import { formatAed, formatDateTime } from "@/lib/format";
import type { ReservationView } from "@/server/reservations/views";

/** Compact reservation table for admin screens; rows link to the admin detail page. */
export function ReservationTable({ items, caption }: { items: ReservationView[]; caption: string }) {
  return (
    <div className="overflow-x-auto rounded-card border border-ink-100 bg-white shadow-card">
      <table className="w-full min-w-[48rem] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-ink-100 bg-ink-50 text-xs tracking-wide text-ink-500 uppercase">
          <tr>
            <th scope="col" className="px-4 py-3">Reference</th>
            <th scope="col" className="px-4 py-3">Customer</th>
            <th scope="col" className="px-4 py-3">Vehicle</th>
            <th scope="col" className="px-4 py-3">Pick-up</th>
            <th scope="col" className="px-4 py-3">Return</th>
            <th scope="col" className="px-4 py-3">Status</th>
            <th scope="col" className="px-4 py-3 text-right">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {items.map((r) => (
            <tr key={r.id} className="hover:bg-ink-50">
              <td className="px-4 py-3 font-mono">
                <Link href={`/admin/reservations/${r.id}`} className="font-semibold text-ink-900 underline-offset-4 hover:underline">
                  {r.reference}
                </Link>
              </td>
              <td className="px-4 py-3">
                <span className="block text-ink-900">{r.customer.name}</span>
                <span className="block text-xs text-ink-500">{r.customer.email}</span>
              </td>
              <td className="px-4 py-3">
                <span className="block text-ink-900">
                  {r.vehicle.make} {r.vehicle.model}
                </span>
                <span className="block font-mono text-xs text-ink-500">{r.vehicle.plate}</span>
              </td>
              <td className="px-4 py-3">
                <span className="block text-ink-900">{formatDateTime(r.pickupAt, r.pickupBranch.timezone)}</span>
                <span className="block text-xs text-ink-500">{r.pickupBranch.code}</span>
              </td>
              <td className="px-4 py-3">
                <span className="block text-ink-900">{formatDateTime(r.returnAt, r.returnBranch.timezone)}</span>
                <span className="block text-xs text-ink-500">{r.returnBranch.code}</span>
              </td>
              <td className="px-4 py-3">
                <ReservationStatusBadge status={r.status} />
              </td>
              <td className="px-4 py-3 text-right font-medium text-ink-900 tabular-nums">{formatAed(r.pricing.totalFils)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
