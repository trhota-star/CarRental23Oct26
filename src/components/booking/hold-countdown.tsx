"use client";

import { Timer } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

/** Shows how long the car stays held. Refreshes the page when the hold lapses. */
export function HoldCountdown({ expiresAt }: { expiresAt: string }) {
  const router = useRouter();
  const end = Date.parse(expiresAt);
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => {
      const ms = end - Date.now();
      setLeft(ms);
      if (ms <= 0) {
        clearInterval(id);
        router.refresh();
      }
    };
    const id = setInterval(tick, 1000);
    tick();
    return () => clearInterval(id);
  }, [end, router]);

  if (left === null) {
    return <p className="text-sm text-ink-600">We&apos;re holding this car for you.</p>;
  }
  const secs = Math.max(0, Math.floor(left / 1000));
  const label = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  return (
    <p
      className={cn(
        "flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium",
        secs < 120 ? "bg-danger-50 text-danger-700" : "bg-gold-50 text-gold-700",
      )}
      role="timer"
      aria-live="off"
    >
      <Timer className="size-4" aria-hidden />
      {secs > 0 ? (
        <>
          Car held for <span className="tabular-nums">{label}</span> — complete payment before it&apos;s released.
        </>
      ) : (
        "Your hold has expired."
      )}
    </p>
  );
}
