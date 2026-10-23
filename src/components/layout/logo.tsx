import Link from "next/link";
import { cn } from "@/lib/cn";

export function Logo({ inverted = false, className }: { inverted?: boolean; className?: string }) {
  return (
    <Link href="/" className={cn("inline-flex items-center gap-2 rounded-lg", className)} aria-label="DriveEasy home">
      <span
        aria-hidden
        className="flex size-8 items-center justify-center rounded-lg bg-gold-400 font-display text-sm font-black text-ink-950"
      >
        DE
      </span>
      <span
        className={cn(
          "font-display text-lg font-bold tracking-tight",
          inverted ? "text-white" : "text-ink-900",
        )}
      >
        Drive<span className={inverted ? "text-gold-300" : "text-gold-600"}>Easy</span>
      </span>
    </Link>
  );
}
