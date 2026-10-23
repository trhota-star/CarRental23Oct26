// Time-zone helpers. All instants are stored and passed around as UTC; branch-local
// wall-clock times are converted with the branch's IANA zone (e.g. Asia/Dubai).

import { TZDate } from "@date-fns/tz";

/** "2030-01-01T10:00" (wall clock in `timeZone`) → UTC Date. */
export function zonedLocalToUtc(local: string, timeZone: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local);
  if (!m) throw new Error(`Invalid local date-time: ${local}`);
  const [, y, mo, d, h, mi, s] = m;
  const tz = new TZDate(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0), timeZone);
  return new Date(tz.getTime());
}

/** UTC Date → "2030-01-01T10:00" wall clock in `timeZone`. */
export function utcToZonedLocal(date: Date, timeZone: string): string {
  const tz = new TZDate(date.getTime(), timeZone);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${tz.getFullYear()}-${p(tz.getMonth() + 1)}-${p(tz.getDate())}T${p(tz.getHours())}:${p(tz.getMinutes())}`;
}

/** Display format in the branch zone, e.g. "Tue 1 Jan 2030, 10:00 (Asia/Dubai)". */
export function formatInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(date);
}
