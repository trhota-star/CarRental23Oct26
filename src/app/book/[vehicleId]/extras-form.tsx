"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { buttonClass } from "@/components/ui/button";
import { formatAed } from "@/lib/format";
import { EXTRA_PREFIX } from "@/lib/extras";

type ExtraOption = {
  id: string;
  name: string;
  description: string | null;
  chargeType: string;
  priceFils: number;
  maxQuantity: number;
};

/**
 * Extras picker. Changing a choice re-requests the page so the server re-quotes;
 * nothing is priced in the browser. Without JS, "Update price" submits the GET form.
 */
export function ExtrasForm({
  action,
  trip,
  extras,
  selected,
}: {
  action: string;
  trip: Record<string, string>;
  extras: ExtraOption[];
  selected: Record<string, number>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onChange(form: HTMLFormElement) {
    const params = new URLSearchParams();
    for (const [k, v] of new FormData(form).entries()) {
      if (typeof v === "string" && v !== "" && v !== "0") params.set(k, v);
    }
    startTransition(() => router.replace(`${action}?${params.toString()}`, { scroll: false }));
  }

  return (
    <form
      action={action}
      method="get"
      onChange={(e) => onChange(e.currentTarget)}
      aria-busy={pending}
      className="space-y-3"
    >
      {Object.entries(trip).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <fieldset>
        <legend className="sr-only">Optional extras</legend>
        <ul className="divide-y divide-ink-100 rounded-xl border border-ink-100">
          {extras.map((x) => {
            const name = `${EXTRA_PREFIX}${x.id}`;
            const qty = selected[x.id] ?? 0;
            const price = `${formatAed(x.priceFils)} ${x.chargeType === "PER_DAY" ? "per day" : "per rental"}`;
            return (
              <li key={x.id} className="flex items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <label htmlFor={`extra-${x.id}`} className="font-medium text-ink-900">
                    {x.name}
                  </label>
                  {x.description ? <p className="text-sm text-ink-600">{x.description}</p> : null}
                  <p className="text-sm font-medium text-gold-700">{price}</p>
                </div>
                {x.maxQuantity > 1 ? (
                  <select
                    id={`extra-${x.id}`}
                    name={name}
                    defaultValue={String(qty)}
                    className="h-10 rounded-lg border border-ink-200 bg-white px-2 text-sm"
                    aria-label={`${x.name} quantity`}
                  >
                    {Array.from({ length: x.maxQuantity + 1 }, (_, n) => (
                      <option key={n} value={n}>
                        {n === 0 ? "None" : n}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`extra-${x.id}`}
                    type="checkbox"
                    name={name}
                    value="1"
                    defaultChecked={qty > 0}
                    className="size-5 accent-ink-900"
                  />
                )}
              </li>
            );
          })}
        </ul>
      </fieldset>
      <noscript>
        <button type="submit" className={buttonClass("secondary", "sm")}>
          Update price
        </button>
      </noscript>
      <p aria-live="polite" className="h-4 text-xs text-ink-500">
        {pending ? "Updating price…" : ""}
      </p>
    </form>
  );
}
