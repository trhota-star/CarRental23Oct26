import { AlertCircle, CheckCircle2, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

type AlertTone = "info" | "success" | "warning" | "danger";

const alertStyles: Record<AlertTone, { box: string; icon: LucideIcon }> = {
  info: { box: "border-info-700/20 bg-info-50 text-info-700", icon: Info },
  success: { box: "border-success-700/20 bg-success-50 text-success-700", icon: CheckCircle2 },
  warning: { box: "border-warning-700/20 bg-warning-50 text-warning-700", icon: TriangleAlert },
  danger: { box: "border-danger-700/20 bg-danger-50 text-danger-700", icon: AlertCircle },
};

export function Alert({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const { box, icon: Icon } = alertStyles[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-xl border px-4 py-3 text-sm", box, className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="space-y-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="text-ink-800">{children}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-card border border-dashed border-ink-200 bg-white px-6 py-12 text-center",
        className,
      )}
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-gold-50 text-gold-700">
        <Icon className="size-6" aria-hidden />
      </span>
      <h2 className="mt-4 text-base font-semibold text-ink-900">{title}</h2>
      {description ? <p className="mt-1 max-w-sm text-sm text-ink-600">{description}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div aria-hidden className={cn("skeleton h-4", className)} {...props} />;
}

/** Generic page-level skeleton used by loading.tsx files. */
export function PageSkeleton({ rows = 3, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8" role="status" aria-live="polite">
      <span className="sr-only">{label}…</span>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="mt-3 h-4 w-80 max-w-full" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: rows * 3 }, (_, i) => (
          <div key={i} className="rounded-card border border-ink-100 bg-white p-5">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="mt-4 h-5 w-2/3" />
            <Skeleton className="mt-2 h-4 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 rounded-xl border border-ink-100 bg-white p-4">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}
