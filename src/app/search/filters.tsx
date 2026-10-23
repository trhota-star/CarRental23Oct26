import { SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { toQueryString } from "@/lib/search-params";

type Props = {
  trip: Record<string, string>;
  current: Record<string, string | undefined>;
  categories: Array<{ id: string; name: string }>;
};

/** GET form that keeps the trip (where/when) and applies filters. Works without JS. */
export function Filters({ trip, current, categories }: Props) {
  const body = (p: string) => (
    <form action="/search" method="get" className="space-y-4">
      {Object.entries(trip).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Field label="Category" htmlFor={`${p}-category`}>
        <Select id={`${p}-category`} name="category" defaultValue={current.category ?? ""}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Transmission" htmlFor={`${p}-transmission`}>
        <Select id={`${p}-transmission`} name="transmission" defaultValue={current.transmission ?? ""}>
          <option value="">Any</option>
          <option value="AUTOMATIC">Automatic</option>
          <option value="MANUAL">Manual</option>
        </Select>
      </Field>
      <Field label="Seats (minimum)" htmlFor={`${p}-seats`}>
        <Select id={`${p}-seats`} name="seats" defaultValue={current.seats ?? ""}>
          <option value="">Any</option>
          {[2, 4, 5, 7, 8].map((n) => (
            <option key={n} value={n}>
              {n}+ seats
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Fuel type" htmlFor={`${p}-fuel`}>
        <Select id={`${p}-fuel`} name="fuelType" defaultValue={current.fuelType ?? ""}>
          <option value="">Any</option>
          <option value="PETROL">Petrol</option>
          <option value="DIESEL">Diesel</option>
          <option value="HYBRID">Hybrid</option>
          <option value="ELECTRIC">Electric</option>
        </Select>
      </Field>
      <Field label="Max daily rate (AED)" htmlFor={`${p}-price`} hint="Before VAT and extras.">
        <Input
          id={`${p}-price`}
          name="maxPrice"
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          placeholder="e.g. 400"
          defaultValue={current.maxPrice ?? ""}
          aria-describedby={`${p}-price-hint`}
        />
      </Field>
      <Field label="Sort by" htmlFor={`${p}-sort`}>
        <Select id={`${p}-sort`} name="sort" defaultValue={current.sort ?? "price_asc"}>
          <option value="price_asc">Price: low to high</option>
          <option value="price_desc">Price: high to low</option>
          <option value="seats_desc">Most seats</option>
        </Select>
      </Field>
      <div className="flex gap-2 pt-1">
        <button type="submit" className={buttonClass("primary", "md", "flex-1")}>
          Apply filters
        </button>
        <Link href={`/search?${toQueryString(trip)}`} className={buttonClass("ghost", "md")}>
          Reset
        </Link>
      </div>
    </form>
  );
  return (
    <>
      <details className="rounded-card border border-ink-100 bg-white p-4 shadow-card lg:hidden">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-ink-900 [&::-webkit-details-marker]:hidden">
          <SlidersHorizontal className="size-4" aria-hidden /> Filters &amp; sort
        </summary>
        <div className="mt-4">{body("fm")}</div>
      </details>
      <aside aria-label="Filters" className="hidden rounded-card border border-ink-100 bg-white p-5 shadow-card lg:block">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-ink-900">
          <SlidersHorizontal className="size-4" aria-hidden /> Filters &amp; sort
        </h2>
        {body("fd")}
      </aside>
    </>
  );
}
