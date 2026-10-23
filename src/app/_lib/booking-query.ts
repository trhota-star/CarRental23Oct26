import "server-only";
import { searchQuerySchema, searchPeriod, pickSearchParams, type SearchQuery } from "@/lib/search-params";
import type { Branch } from "./server-api";

export type ResolvedSearch =
  | { status: "incomplete"; raw: Record<string, string | undefined> }
  | { status: "invalid"; raw: Record<string, string | undefined>; errors: string[] }
  | {
      status: "ok";
      raw: Record<string, string | undefined>;
      q: SearchQuery;
      pickupBranch: Branch;
      returnBranch: Branch;
      pickupAt: Date;
      returnAt: Date;
    };

/**
 * Validates the shared where/when query (?pickupBranchId&pickupDate&…) and
 * resolves branch-local times to UTC using each branch's time zone.
 */
export function resolveSearch(
  sp: Record<string, string | string[] | undefined>,
  branches: Branch[],
  now: Date,
): ResolvedSearch {
  const raw = pickSearchParams(sp);
  if (!raw.pickupBranchId || !raw.pickupDate || !raw.returnDate) return { status: "incomplete", raw };
  const parsed = searchQuerySchema.safeParse({
    ...raw,
    pickupTime: raw.pickupTime ?? "10:00",
    returnTime: raw.returnTime ?? "10:00",
  });
  if (!parsed.success) {
    return { status: "invalid", raw, errors: [...new Set(parsed.error.issues.map((i) => i.message))] };
  }
  const q = parsed.data;
  const pickupBranch = branches.find((b) => b.id === q.pickupBranchId);
  const returnBranch = branches.find((b) => b.id === (q.returnBranchId ?? q.pickupBranchId));
  if (!pickupBranch || !returnBranch) {
    return { status: "invalid", raw, errors: ["That branch isn't available. Please choose another."] };
  }
  const { pickupAt, returnAt } = searchPeriod(q, pickupBranch.timezone, returnBranch.timezone);
  if (!pickupAt || !returnAt) return { status: "invalid", raw, errors: ["Please choose valid dates and times."] };
  if (pickupAt.getTime() < now.getTime()) {
    return { status: "invalid", raw, errors: ["Pick-up time has already passed. Choose a later time."] };
  }
  if (returnAt.getTime() <= pickupAt.getTime()) {
    return { status: "invalid", raw, errors: ["Return must be after pick-up."] };
  }
  return { status: "ok", raw, q, pickupBranch, returnBranch, pickupAt, returnAt };
}

/** The where/when part of the query, for links between search → vehicle → booking. */
export function tripParams(r: Extract<ResolvedSearch, { status: "ok" }>): Record<string, string> {
  return {
    pickupBranchId: r.pickupBranch.id,
    returnBranchId: r.returnBranch.id,
    pickupDate: r.q.pickupDate,
    pickupTime: r.q.pickupTime,
    returnDate: r.q.returnDate,
    returnTime: r.q.returnTime,
  };
}
