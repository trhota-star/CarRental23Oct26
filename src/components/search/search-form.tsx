"use client";

import { ArrowRight, CalendarDays, Clock, MapPin } from "lucide-react";
import { useId, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { Label, Select, Input } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import { TIME_SLOTS } from "@/lib/format";

export type BranchOption = { id: string; name: string; city: string };

export type SearchDefaults = {
  pickupBranchId?: string;
  returnBranchId?: string;
  pickupDate: string;
  pickupTime: string;
  returnDate: string;
  returnTime: string;
  /** Earliest selectable date (today in Asia/Dubai). */
  minDate: string;
};

/**
 * Where/when search. Plain GET form to /search, so it works without JS and the
 * results page is shareable. Times are branch-local (all UAE branches are GST).
 */
export function SearchForm({
  branches,
  defaults,
  variant = "hero",
  extraHidden,
  action = "/search",
  returnBranches,
  submitLabel = "Search",
}: {
  branches: BranchOption[];
  /** Options for the return branch; defaults to `branches`. */
  returnBranches?: BranchOption[];
  action?: string;
  submitLabel?: string;
  defaults: SearchDefaults;
  variant?: "hero" | "compact";
  /** Filters to keep when re-searching from the results page. */
  extraHidden?: Record<string, string>;
}) {
  const id = useId();
  const [pickupDate, setPickupDate] = useState(defaults.pickupDate);
  const [returnDate, setReturnDate] = useState(defaults.returnDate);
  const [differentReturn, setDifferentReturn] = useState(
    Boolean(defaults.returnBranchId && defaults.returnBranchId !== defaults.pickupBranchId),
  );

  const compact = variant === "compact";
  const grid = compact
    ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_0.7fr_1fr_0.7fr_auto] lg:items-end"
    : "grid gap-4 md:grid-cols-2 lg:grid-cols-[1.5fr_1fr_0.75fr_1fr_0.75fr_auto] lg:items-end";

  return (
    <form action={action} method="get" className="space-y-3" aria-label="Search cars">
      {extraHidden
        ? Object.entries(extraHidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)
        : null}
      <div className={grid}>
        <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
          <Label htmlFor={`${id}-pickup`} className="flex items-center gap-1.5">
            <MapPin className="size-3.5 text-gold-600" aria-hidden /> Pick-up branch
          </Label>
          <Select id={`${id}-pickup`} name="pickupBranchId" required defaultValue={defaults.pickupBranchId ?? ""}>
            <option value="" disabled>
              Choose a branch
            </option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} — {b.city}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-pdate`} className="flex items-center gap-1.5">
            <CalendarDays className="size-3.5 text-gold-600" aria-hidden /> Pick-up date
          </Label>
          <Input
            id={`${id}-pdate`}
            type="date"
            name="pickupDate"
            required
            min={defaults.minDate}
            value={pickupDate}
            onChange={(e) => {
              setPickupDate(e.target.value);
              if (returnDate < e.target.value) setReturnDate(e.target.value);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-ptime`} className="flex items-center gap-1.5">
            <Clock className="size-3.5 text-gold-600" aria-hidden /> Time
          </Label>
          <Select id={`${id}-ptime`} name="pickupTime" defaultValue={defaults.pickupTime}>
            {TIME_SLOTS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-rdate`} className="flex items-center gap-1.5">
            <CalendarDays className="size-3.5 text-gold-600" aria-hidden /> Return date
          </Label>
          <Input
            id={`${id}-rdate`}
            type="date"
            name="returnDate"
            required
            min={pickupDate || defaults.minDate}
            value={returnDate}
            onChange={(e) => setReturnDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-rtime`} className="flex items-center gap-1.5">
            <Clock className="size-3.5 text-gold-600" aria-hidden /> Time
          </Label>
          <Select id={`${id}-rtime`} name="returnTime" defaultValue={defaults.returnTime}>
            {TIME_SLOTS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>
        <button
          type="submit"
          className={buttonClass("accent", "lg", cn("w-full sm:col-span-2 lg:col-span-1 lg:w-auto"))}
        >
          {submitLabel} <ArrowRight className="size-4" aria-hidden />
        </button>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="inline-flex items-center gap-2 text-sm text-ink-700">
          <input
            type="checkbox"
            className="size-4 accent-ink-900"
            checked={differentReturn}
            onChange={(e) => setDifferentReturn(e.target.checked)}
          />
          Return to a different branch
        </label>
        {differentReturn ? (
          <div className="flex-1 sm:max-w-sm">
            <Label htmlFor={`${id}-return`} className="sr-only">
              Return branch
            </Label>
            <Select
              id={`${id}-return`}
              name="returnBranchId"
              defaultValue={defaults.returnBranchId ?? defaults.pickupBranchId ?? ""}
            >
              <option value="">Same as pick-up</option>
              {(returnBranches ?? branches).map((b) => (
                <option key={b.id} value={b.id}>
                  Return to {b.name} — {b.city}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>
    </form>
  );
}
