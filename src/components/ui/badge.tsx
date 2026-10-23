import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export type BadgeTone = "neutral" | "gold" | "success" | "danger" | "warning" | "info" | "dark";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-ink-100 text-ink-700 ring-ink-200",
  gold: "bg-gold-100 text-gold-700 ring-gold-300",
  success: "bg-success-50 text-success-700 ring-success-700/20",
  danger: "bg-danger-50 text-danger-700 ring-danger-700/20",
  warning: "bg-warning-50 text-warning-700 ring-warning-700/20",
  info: "bg-info-50 text-info-700 ring-info-700/20",
  dark: "bg-ink-900 text-white ring-ink-900",
};

export function Badge({ tone = "neutral", className, ...props }: ComponentProps<"span"> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

const reservationTones: Record<string, BadgeTone> = {
  PENDING: "warning",
  CONFIRMED: "success",
  PICKED_UP: "info",
  RETURNED: "neutral",
  CANCELLED: "danger",
  EXPIRED: "neutral",
  REFUNDED: "gold",
};

const reservationLabels: Record<string, string> = {
  PENDING: "Awaiting payment",
  CONFIRMED: "Confirmed",
  PICKED_UP: "On rent",
  RETURNED: "Returned",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
  REFUNDED: "Refunded",
};

export function ReservationStatusBadge({ status }: { status: string }) {
  return <Badge tone={reservationTones[status] ?? "neutral"}>{reservationLabels[status] ?? status}</Badge>;
}

const vehicleTones: Record<string, BadgeTone> = {
  AVAILABLE: "success",
  RESERVED: "info",
  ON_RENT: "gold",
  MAINTENANCE: "warning",
  RETIRED: "neutral",
};

export function VehicleStatusBadge({ status }: { status: string }) {
  return <Badge tone={vehicleTones[status] ?? "neutral"}>{status.replace("_", " ").toLowerCase()}</Badge>;
}
