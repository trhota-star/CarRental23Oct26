import { CalendarArrowDown, CalendarArrowUp, CarFront, Hourglass, Search, Wrench } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ReservationTable } from "@/components/admin/reservation-table";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ListSkeleton } from "@/components/ui/feedback";
import { Input, Label } from "@/components/ui/form";
import { Container, PageHeader } from "@/components/ui/page";
import { DEFAULT_TIME_ZONE, utcToZonedParts } from "@/lib/format";
import { requireAdmin, toActor } from "@/server/auth/session";
import { listAllReservations, listVehicles } from "../_lib/server-api";

export const metadata: Metadata = { title: "Overview" };

export default function AdminHome() {
  return (
    <Container className="py-8">
      <PageHeader
        title="Today at DriveEasy"
        description={`Pick-ups and returns for today (${DEFAULT_TIME_ZONE}). Scan or type a voucher reference to find a booking.`}
        actions={
          <form action="/admin/reservations" method="get" className="flex items-end gap-2">
            <div>
              <Label htmlFor="ref-search" className="sr-only">
                Booking reference or customer
              </Label>
              <Input id="ref-search" name="search" placeholder="DE-XXXXXXXX or email" className="w-56" />
            </div>
            <button type="submit" className={buttonClass("primary", "md")}>
              <Search className="size-4" aria-hidden /> Find
            </button>
          </form>
        }
      />
      <Suspense fallback={<ListSkeleton rows={6} />}>
        <Dashboard />
      </Suspense>
    </Container>
  );
}

async function Dashboard() {
  const user = await requireAdmin("/admin");
  await connection();
  const actor = toActor(user);
  const now = new Date();
  const [confirmed, onRent, pending, vehicles] = await Promise.all([
    listAllReservations(actor, { statuses: ["CONFIRMED"], limit: 200 }),
    listAllReservations(actor, { statuses: ["PICKED_UP"], limit: 200 }),
    listAllReservations(actor, { statuses: ["PENDING"], limit: 200 }),
    listVehicles(),
  ]);
  const today = (d: Date, tz: string) => utcToZonedParts(d, tz).date === utcToZonedParts(now, tz).date;
  const pickupsToday = confirmed.items.filter((r) => today(r.pickupAt, r.pickupBranch.timezone) || r.pickupAt < now);
  const returnsDue = onRent.items.filter((r) => today(r.returnAt, r.returnBranch.timezone) || r.returnAt < now);
  const overdue = onRent.items.filter((r) => r.returnAt < now).length;
  const maintenance = vehicles.filter((v) => v.status === "MAINTENANCE").length;

  const stats = [
    { label: "Pick-ups due", value: pickupsToday.length, icon: CalendarArrowUp, href: "/admin/reservations?status=CONFIRMED" },
    { label: "Returns due", value: returnsDue.length, icon: CalendarArrowDown, href: "/admin/reservations?status=PICKED_UP" },
    { label: "Overdue returns", value: overdue, icon: Hourglass, href: "/admin/reservations?status=PICKED_UP" },
    { label: "Cars on rent", value: onRent.total, icon: CarFront, href: "/admin/fleet" },
    { label: "Awaiting payment", value: pending.total, icon: Hourglass, href: "/admin/reservations?status=PENDING" },
    { label: "In maintenance", value: maintenance, icon: Wrench, href: "/admin/fleet" },
  ];

  return (
    <div className="space-y-8">
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {stats.map((s) => (
          <li key={s.label}>
            <Link href={s.href} className="block rounded-card border border-ink-100 bg-white p-4 shadow-card hover:shadow-lift">
              <s.icon className="size-5 text-gold-600" aria-hidden />
              <p className="mt-3 font-display text-2xl font-semibold text-ink-900 tabular-nums">{s.value}</p>
              <p className="text-xs text-ink-600">{s.label}</p>
            </Link>
          </li>
        ))}
      </ul>
      <Card>
        <CardHeader>
          <CardTitle>Pick-ups due (today and missed)</CardTitle>
        </CardHeader>
        <CardBody>
          {pickupsToday.length ? (
            <ReservationTable items={pickupsToday} caption="Pick-ups due" />
          ) : (
            <EmptyState icon={CalendarArrowUp} title="No pick-ups due today" />
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Returns due (today and overdue)</CardTitle>
        </CardHeader>
        <CardBody>
          {returnsDue.length ? (
            <ReservationTable items={returnsDue} caption="Returns due" />
          ) : (
            <EmptyState icon={CalendarArrowDown} title="No returns due today" />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
