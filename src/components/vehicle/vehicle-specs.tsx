import { Briefcase, Cog, DoorOpen, Fuel, Users } from "lucide-react";
import { cn } from "@/lib/cn";

const fuelLabel: Record<string, string> = { PETROL: "Petrol", DIESEL: "Diesel", HYBRID: "Hybrid", ELECTRIC: "Electric" };

export function transmissionLabel(t: string) {
  return t === "MANUAL" ? "Manual" : "Automatic";
}
export function fuelTypeLabel(f: string) {
  return fuelLabel[f] ?? f;
}

export function VehicleSpecs({
  vehicle,
  className,
  showDoors = false,
}: {
  vehicle: { seats: number; transmission: string; fuelType: string; luggage: number; doors: number };
  className?: string;
  showDoors?: boolean;
}) {
  const items = [
    { icon: Users, label: `${vehicle.seats} seats` },
    { icon: Cog, label: transmissionLabel(vehicle.transmission) },
    { icon: Fuel, label: fuelTypeLabel(vehicle.fuelType) },
    { icon: Briefcase, label: `${vehicle.luggage} bags` },
    ...(showDoors ? [{ icon: DoorOpen, label: `${vehicle.doors} doors` }] : []),
  ];
  return (
    <ul className={cn("flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-ink-600", className)}>
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <i.icon className="size-4 text-ink-400" aria-hidden />
          {i.label}
        </li>
      ))}
    </ul>
  );
}
