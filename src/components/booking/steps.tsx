import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

const STEPS = ["Car & dates", "Extras", "Driver & payment", "Voucher"];

/** Progress indicator for the booking flow (0-based `current`). */
export function BookingSteps({ current, className }: { current: number; className?: string }) {
  return (
    <nav aria-label="Booking progress" className={className}>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-xs sm:text-sm">
        {STEPS.map((label, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={label} className="flex shrink-0 items-center gap-2">
              <span
                aria-current={active ? "step" : undefined}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1 font-medium",
                  done && "bg-success-50 text-success-700",
                  active && "bg-ink-900 text-white",
                  !done && !active && "bg-ink-100 text-ink-500",
                )}
              >
                {done ? <Check className="size-3.5" aria-hidden /> : <span aria-hidden>{i + 1}</span>}
                {label}
                {done ? <span className="sr-only"> (completed)</span> : null}
              </span>
              {i < STEPS.length - 1 ? <span className="h-px w-4 bg-ink-200" aria-hidden /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
