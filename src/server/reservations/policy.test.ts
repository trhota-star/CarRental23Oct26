import { describe, expect, it } from "vitest";
import { computeCancellation } from "./policy";

const pickupAt = new Date("2031-01-10T06:00:00Z");
const base = { status: "CONFIRMED", pickupAt, paidFils: 31500, dailyRateFils: 10000, vatRateBps: 500, isAdmin: false };

describe("computeCancellation", () => {
  it("is free ≥ 48h before pick-up", () => {
    expect(computeCancellation({ ...base, now: new Date(pickupAt.getTime() - 48 * 3_600_000) })).toMatchObject({ cancellable: true, refundFils: 31500, feeFils: 0 });
  });
  it("keeps one day + VAT within 48h", () => {
    expect(computeCancellation({ ...base, now: new Date(pickupAt.getTime() - 3_600_000) })).toMatchObject({ refundFils: 21000, feeFils: 10500 });
  });
  it("blocks customers after pick-up time but lets admins mark a no-show", () => {
    const now = new Date(pickupAt.getTime() + 1000);
    expect(computeCancellation({ ...base, now }).cancellable).toBe(false);
    expect(computeCancellation({ ...base, now, isAdmin: true })).toMatchObject({ cancellable: true, refundFils: 0 });
  });
  it("PENDING is free; returned is not cancellable", () => {
    expect(computeCancellation({ ...base, status: "PENDING", now: pickupAt })).toMatchObject({ cancellable: true, refundFils: 31500 });
    expect(computeCancellation({ ...base, status: "RETURNED", now: pickupAt }).cancellable).toBe(false);
  });
});
