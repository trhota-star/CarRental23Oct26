import { TZDate } from "@date-fns/tz";

/** Default zone for the UAE; every branch carries its own IANA zone. */
export const DEFAULT_TIME_ZONE = "Asia/Dubai";

const aed = new Intl.NumberFormat("en-AE", {
  style: "currency",
  currency: "AED",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formats integer fils (AED minor units) as "AED 1,234.50". Display only — never used for arithmetic. */
export function formatAed(fils: number | bigint): string {
  const n = typeof fils === "bigint" ? Number(fils) : fils;
  return aed.format(n / 100);
}

/** Parses a user-typed AED amount ("1,234.5") into integer fils without float drift. */
export function parseAedToFils(input: string): number | null {
  const clean = input.replace(/[,\s]/g, "").replace(/^AED/i, "");
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(clean);
  if (!m) return null;
  const whole = Number(m[1]);
  const frac = Number((m[2] ?? "").padEnd(2, "0"));
  const fils = whole * 100 + frac;
  return Number.isSafeInteger(fils) ? fils : null;
}

/** fils → "1234.50" for pre-filling admin inputs. */
export function filsToInput(fils: number): string {
  const sign = fils < 0 ? "-" : "";
  const abs = Math.abs(fils);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

type DateInput = Date | string | number;

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

/** "Fri, 24 Oct 2026, 10:00" in the given zone. */
export function formatDateTime(value: DateInput, timeZone = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(toDate(value));
}

export function formatDate(value: DateInput, timeZone = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(toDate(value));
}

export function formatTime(value: DateInput, timeZone = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(toDate(value));
}

/** Short zone label such as "GST" or "GMT+4" for the given zone. */
export function zoneLabel(timeZone = DEFAULT_TIME_ZONE, at: DateInput = 0): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(toDate(at));
  return parts.find((p) => p.type === "timeZoneName")?.value ?? timeZone;
}

/**
 * Converts a wall-clock date ("2026-10-24") and time ("10:00") in a branch's
 * zone to the UTC instant. Returns null for malformed input.
 */
export function zonedToUtc(date: string, time: string, timeZone = DEFAULT_TIME_ZONE): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const [y, mo, da, h, mi] = [Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2])];
  if (mo > 11 || da < 1 || da > 31 || h > 23 || mi > 59) return null;
  const local = new TZDate(y, mo, da, h, mi, 0, timeZone);
  // Reject roll-overs such as 31 Feb.
  if (local.getDate() !== da || local.getMonth() !== mo) return null;
  return new Date(local.getTime());
}

/** UTC instant → { date: "YYYY-MM-DD", time: "HH:mm" } in the zone, for pre-filling pickers. */
export function utcToZonedParts(value: DateInput, timeZone = DEFAULT_TIME_ZONE): { date: string; time: string } {
  const z = new TZDate(toDate(value).getTime(), timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${z.getFullYear()}-${pad(z.getMonth() + 1)}-${pad(z.getDate())}`,
    time: `${pad(z.getHours())}:${pad(z.getMinutes())}`,
  };
}

/** Half-hour slots "00:00" … "23:30" for time pickers. */
export const TIME_SLOTS: readonly string[] = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, "0");
  return `${h}:${i % 2 ? "30" : "00"}`;
});

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
