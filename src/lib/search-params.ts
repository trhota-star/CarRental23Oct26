import { z } from "zod";
import { DEFAULT_TIME_ZONE, utcToZonedParts, zonedToUtc } from "./format";

/** Raw `searchParams` value → first string, or undefined. */
export function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const optionalText = z
  .string()
  .trim()
  .max(64)
  .optional()
  .transform((v) => (v ? v : undefined));

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const timeStr = z.string().regex(/^\d{2}:(00|30)$/, "Choose a time");

export const searchQuerySchema = z.object({
  pickupBranchId: z.uuid("Choose a pick-up branch"),
  returnBranchId: z
    .union([z.uuid(), z.literal("")])
    .optional()
    .transform((v) => (v ? v : undefined)),
  pickupDate: dateStr,
  pickupTime: timeStr,
  returnDate: dateStr,
  returnTime: timeStr,
  category: optionalText,
  transmission: z.enum(["AUTOMATIC", "MANUAL"]).optional().catch(undefined),
  fuelType: z.enum(["PETROL", "DIESEL", "HYBRID", "ELECTRIC"]).optional().catch(undefined),
  seats: z.coerce.number().int().min(1).max(15).optional().catch(undefined),
  /** Max daily rate in whole AED (converted to fils on the server). */
  maxPrice: z.coerce.number().int().min(1).max(100_000).optional().catch(undefined),
  sort: z.enum(["price_asc", "price_desc", "seats_desc"]).optional().catch(undefined),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const SEARCH_KEYS = [
  "pickupBranchId",
  "returnBranchId",
  "pickupDate",
  "pickupTime",
  "returnDate",
  "returnTime",
  "category",
  "transmission",
  "fuelType",
  "seats",
  "maxPrice",
  "sort",
] as const;

export function pickSearchParams(sp: Record<string, string | string[] | undefined>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const k of SEARCH_KEYS) out[k] = first(sp[k]);
  return out;
}

/** Converts the wall-clock fields to UTC instants in the pick-up branch's zone. */
export function searchPeriod(q: SearchQuery, pickupZone: string, returnZone: string) {
  const pickupAt = zonedToUtc(q.pickupDate, q.pickupTime, pickupZone);
  const returnAt = zonedToUtc(q.returnDate, q.returnTime, returnZone);
  return { pickupAt, returnAt };
}

/** Builds a query string from a SearchQuery-like object, dropping empty values. */
export function toQueryString(params: Record<string, string | number | undefined | null>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") usp.set(k, String(v));
  }
  return usp.toString();
}

/** Default search window: tomorrow 10:00 → three days later 10:00, branch-local. */
export function defaultSearchDates(now: Date, timeZone = DEFAULT_TIME_ZONE) {
  const day = 24 * 60 * 60 * 1000;
  const today = utcToZonedParts(now, timeZone).date;
  const pickup = utcToZonedParts(new Date(now.getTime() + day), timeZone).date;
  const ret = utcToZonedParts(new Date(now.getTime() + 4 * day), timeZone).date;
  return { minDate: today, pickupDate: pickup, pickupTime: "10:00", returnDate: ret, returnTime: "10:00" };
}
