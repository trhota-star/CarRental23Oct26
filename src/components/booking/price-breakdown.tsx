import { ShieldCheck } from "lucide-react";
import { formatAed, pluralize } from "@/lib/format";
import type { Quote } from "@/server/pricing/engine";

type Props = {
  quote: Pick<
    Quote,
    | "rentalDays"
    | "dailyRateFils"
    | "baseFils"
    | "extras"
    | "oneWayFeeFils"
    | "subtotalFils"
    | "vatRateBps"
    | "vatFils"
    | "totalFils"
    | "depositFils"
  >;
  title?: string;
};

/** Server-quoted price breakdown. Every number shown comes from the quote; nothing is computed here. */
export function PriceBreakdown({ quote, title = "Price breakdown" }: Props) {
  const vatPct = `${quote.vatRateBps / 100}%`;
  return (
    <section aria-labelledby="price-breakdown-title" className="space-y-3">
      <h2 id="price-breakdown-title" className="text-sm font-semibold text-ink-900">
        {title}
      </h2>
      <dl className="space-y-2 text-sm">
        <Row
          term={`${formatAed(quote.dailyRateFils)} × ${pluralize(quote.rentalDays, "day")}`}
          detail={formatAed(quote.baseFils)}
        />
        {quote.extras.map((e) => (
          <Row
            key={e.extraId}
            term={
              <>
                {e.name}
                {e.quantity > 1 ? ` × ${e.quantity}` : ""}
                <span className="text-ink-400">
                  {" "}
                  · {formatAed(e.unitPriceFils)}
                  {e.chargeType === "PER_DAY" ? "/day" : "/rental"}
                </span>
              </>
            }
            detail={formatAed(e.totalFils)}
          />
        ))}
        {quote.oneWayFeeFils > 0 ? <Row term="One-way fee" detail={formatAed(quote.oneWayFeeFils)} /> : null}
        <div className="border-t border-ink-100 pt-2">
          <Row term="Subtotal" detail={formatAed(quote.subtotalFils)} />
        </div>
        <Row term={`VAT (${vatPct})`} detail={formatAed(quote.vatFils)} />
        <div className="flex items-baseline justify-between border-t border-ink-200 pt-3">
          <dt className="text-base font-semibold text-ink-900">Total to pay now</dt>
          <dd className="font-display text-xl font-bold text-ink-900">{formatAed(quote.totalFils)}</dd>
        </div>
      </dl>
      <div className="flex gap-2 rounded-xl bg-ink-50 px-3 py-2.5 text-xs text-ink-700">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ink-600" aria-hidden />
        <p>
          <span className="font-semibold text-ink-900">Security deposit {formatAed(quote.depositFils)}</span> — held
          on your card (not charged) and released after the car is returned.
        </p>
      </div>
    </section>
  );
}

function Row({ term, detail }: { term: React.ReactNode; detail: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-ink-600">{term}</dt>
      <dd className="font-medium whitespace-nowrap text-ink-900 tabular-nums">{detail}</dd>
    </div>
  );
}
