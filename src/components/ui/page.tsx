import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Container({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8", className)} {...props} />;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-4 pb-6 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-xs font-semibold tracking-[0.14em] text-gold-700 uppercase">{eyebrow}</p>
        ) : null}
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-sm text-ink-600 sm:text-base">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

/** Two-column key/value list used in summaries and vouchers. */
export function DescriptionList({
  items,
  className,
}: {
  items: Array<{ term: ReactNode; detail: ReactNode }>;
  className?: string;
}) {
  return (
    <dl className={cn("divide-y divide-ink-100", className)}>
      {items.map((item, i) => (
        <div key={i} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:justify-between sm:gap-4">
          <dt className="text-sm text-ink-500">{item.term}</dt>
          <dd className="text-sm font-medium text-ink-900 sm:text-right">{item.detail}</dd>
        </div>
      ))}
    </dl>
  );
}
