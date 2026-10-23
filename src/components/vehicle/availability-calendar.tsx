import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { zonedToUtc } from "@/lib/format";

type Busy = { start: string; end: string; kind: "RESERVED" | "MAINTENANCE" };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Month as "YYYY-MM" → previous/next month strings. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** UTC bounds [from, to) of a month in the given zone (for the calendar query). */
export function monthBounds(month: string, timeZone: string): { from: Date; to: Date } {
  const from = zonedToUtc(`${month}-01`, "00:00", timeZone)!;
  const to = zonedToUtc(`${shiftMonth(month, 1)}-01`, "00:00", timeZone)!;
  return { from, to };
}

/**
 * Server-rendered month grid. A day is "booked" if busy intervals cover all of
 * it (branch-local), "partial" if they cover part of it. No customer data is shown.
 */
export function AvailabilityCalendar({
  month,
  today,
  timeZone,
  busy,
  hrefForMonth,
  canGoBack,
}: {
  month: string;
  /** "YYYY-MM-DD" in the branch zone. */
  today: string;
  timeZone: string;
  busy: Busy[];
  hrefForMonth: (month: string) => string;
  canGoBack: boolean;
}) {
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const firstWeekday = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Monday = 0
  const intervals = busy.map((b) => ({ s: Date.parse(b.start), e: Date.parse(b.end), kind: b.kind }));

  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const date = `${month}-${pad(i + 1)}`;
    const start = zonedToUtc(date, "00:00", timeZone)!.getTime();
    const end = (i + 1 < daysInMonth ? zonedToUtc(`${month}-${pad(i + 2)}`, "00:00", timeZone) : monthBounds(month, timeZone).to)!.getTime();
    const overlapping = intervals.filter((iv) => iv.s < end && iv.e > start);
    // Merge coverage to see whether the whole day is taken.
    let covered = 0;
    let cursor = start;
    for (const iv of [...overlapping].sort((a, b) => a.s - b.s)) {
      const s = Math.max(iv.s, cursor);
      const e = Math.min(iv.e, end);
      if (e > s) {
        covered += e - s;
        cursor = e;
      }
    }
    const state = overlapping.length === 0 ? "free" : covered >= end - start ? "booked" : "partial";
    return { day: i + 1, date, state, past: date < today };
  });

  const label = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  );

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold text-ink-900" aria-live="polite">
          {label}
        </h3>
        <div className="flex gap-1">
          {canGoBack ? (
            <Link
              href={hrefForMonth(shiftMonth(month, -1))}
              scroll={false}
              className="inline-flex size-9 items-center justify-center rounded-lg border border-ink-200 hover:bg-ink-50"
            >
              <ChevronLeft className="size-4" aria-hidden />
              <span className="sr-only">Previous month</span>
            </Link>
          ) : (
            <span className="inline-flex size-9 items-center justify-center rounded-lg border border-ink-100 text-ink-300" aria-hidden>
              <ChevronLeft className="size-4" />
            </span>
          )}
          <Link
            href={hrefForMonth(shiftMonth(month, 1))}
            scroll={false}
            className="inline-flex size-9 items-center justify-center rounded-lg border border-ink-200 hover:bg-ink-50"
          >
            <ChevronRight className="size-4" aria-hidden />
            <span className="sr-only">Next month</span>
          </Link>
        </div>
      </div>
      <table className="w-full table-fixed border-separate border-spacing-1 text-center text-sm">
        <caption className="sr-only">Availability for {label}</caption>
        <thead>
          <tr>
            {WEEKDAYS.map((d) => (
              <th key={d} scope="col" className="pb-1 text-xs font-medium text-ink-500">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: Math.ceil((firstWeekday + daysInMonth) / 7) }, (_, w) => (
            <tr key={w}>
              {Array.from({ length: 7 }, (_, c) => {
                const d = days[w * 7 + c - firstWeekday];
                if (!d) return <td key={c} />;
                const text =
                  d.past ? "past" : d.state === "booked" ? "booked" : d.state === "partial" ? "partly booked" : "available";
                return (
                  <td key={c}>
                    <span
                      className={cn(
                        "flex h-9 items-center justify-center rounded-lg text-sm tabular-nums",
                        d.past && "text-ink-300",
                        !d.past && d.state === "free" && "bg-success-50 font-medium text-success-700",
                        !d.past && d.state === "partial" && "bg-gold-100 font-medium text-gold-700",
                        !d.past && d.state === "booked" && "bg-ink-100 text-ink-400 line-through",
                        d.date === today && "ring-2 ring-ink-900",
                      )}
                    >
                      {d.day}
                      <span className="sr-only">, {text}</span>
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="mt-3 flex flex-wrap gap-4 text-xs text-ink-600">
        <li className="flex items-center gap-1.5">
          <span className="size-3 rounded bg-success-50 ring-1 ring-success-700/30" aria-hidden /> Available
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-3 rounded bg-gold-100 ring-1 ring-gold-300" aria-hidden /> Partly booked
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-3 rounded bg-ink-100 ring-1 ring-ink-200" aria-hidden /> Booked
        </li>
      </ul>
    </div>
  );
}
