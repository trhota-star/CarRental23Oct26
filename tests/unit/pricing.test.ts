// QA-2 pricing: hand-computed expected values, all in integer fils.
// Inputs (fils):
//   daily rate 1+ days 15,000 (AED 150) · 7+ days 12,000 · other category 30,000
//   VAT 500 bps (5%) · one-way DXB→AUH 25,000, any→any 40,000
//   deposit default 100,000, this category 150,000
//   late return 3,000 / started hour, 59 min grace, capped at the daily rate per 24h
//   extras: GPS 2,500 /day · child seat 2,000 /day (max 2) · full insurance 5,000 /rental

import { describe, expect, it } from "vitest";
import {
  applyRate,
  computeLateFee,
  computeQuote,
  rentalDays,
  type ExtraInput,
  type PricingRuleInput,
} from "@/server/pricing/engine";

const CAT = "cat-economy";
const OTHER = "cat-suv";
const DXB = "br-dxb";
const AUH = "br-auh";
const SHJ = "br-shj";

const rule = (r: Partial<PricingRuleInput> & Pick<PricingRuleInput, "id" | "kind">): PricingRuleInput => ({
  name: r.id,
  categoryId: null,
  fromBranchId: null,
  toBranchId: null,
  minDays: 1,
  amountFils: null,
  rateBps: null,
  graceMinutes: 0,
  priority: 0,
  validFrom: null,
  validTo: null,
  isActive: true,
  ...r,
});

const RULES: PricingRuleInput[] = [
  rule({ id: "rate-1", kind: "DAILY_RATE", categoryId: CAT, minDays: 1, amountFils: 15_000 }),
  rule({ id: "rate-7", kind: "DAILY_RATE", categoryId: CAT, minDays: 7, amountFils: 12_000 }),
  rule({ id: "rate-suv", kind: "DAILY_RATE", categoryId: OTHER, minDays: 1, amountFils: 30_000 }),
  rule({ id: "vat", kind: "VAT", rateBps: 500 }),
  rule({ id: "ow-dxb-auh", kind: "ONE_WAY_FEE", fromBranchId: DXB, toBranchId: AUH, amountFils: 25_000 }),
  rule({ id: "ow-any", kind: "ONE_WAY_FEE", amountFils: 40_000 }),
  rule({ id: "dep-default", kind: "DEPOSIT", amountFils: 100_000 }),
  rule({ id: "dep-cat", kind: "DEPOSIT", categoryId: CAT, amountFils: 150_000 }),
  rule({ id: "late", kind: "LATE_RETURN", amountFils: 3_000, graceMinutes: 59 }),
];

const extra = (e: Partial<ExtraInput> & Pick<ExtraInput, "id" | "chargeType" | "priceFils">): ExtraInput => ({
  code: e.id.toUpperCase(),
  name: e.id,
  maxQuantity: 1,
  isActive: true,
  ...e,
});
const GPS = extra({ id: "gps", chargeType: "PER_DAY", priceFils: 2_500 });
const SEAT = extra({ id: "seat", chargeType: "PER_DAY", priceFils: 2_000, maxQuantity: 2 });
const INSURANCE = extra({ id: "insurance", chargeType: "PER_RENTAL", priceFils: 5_000 });

const T0 = new Date("2030-03-01T06:00:00Z"); // 10:00 Asia/Dubai
const hours = (h: number) => new Date(T0.getTime() + h * 3_600_000);

const quote = (o: Partial<Parameters<typeof computeQuote>[0]> = {}) =>
  computeQuote({
    categoryId: CAT,
    pickupBranchId: DXB,
    returnBranchId: DXB,
    pickupAt: T0,
    returnAt: hours(72),
    extras: [],
    rules: RULES,
    ...o,
  });

describe("rental days", () => {
  it("counts every started 24h, minimum 1", () => {
    expect(rentalDays(T0, hours(1))).toBe(1);
    expect(rentalDays(T0, hours(24))).toBe(1);
    expect(rentalDays(T0, new Date(hours(24).getTime() + 60_000))).toBe(2);
    expect(rentalDays(T0, hours(72))).toBe(3);
  });
  it("rejects zero or negative periods", () => {
    expect(() => rentalDays(T0, T0)).toThrow();
    expect(() => rentalDays(T0, hours(-1))).toThrow();
  });
});

describe("quote", () => {
  it("3 days, same branch, no extras", () => {
    const q = quote();
    // 3 × 15,000 = 45,000; VAT 2,250; total 47,250
    expect(q).toMatchObject({
      currency: "AED",
      rentalDays: 3,
      dailyRateFils: 15_000,
      baseFils: 45_000,
      extrasFils: 0,
      oneWayFeeFils: 0,
      subtotalFils: 45_000,
      vatRateBps: 500,
      vatFils: 2_250,
      totalFils: 47_250,
      depositFils: 150_000,
    });
  });

  it("3 days one-way DXB→AUH with per-day and per-rental extras", () => {
    const q = quote({
      returnBranchId: AUH,
      extras: [
        { extra: GPS, quantity: 1 }, // 2,500 × 1 × 3 = 7,500
        { extra: SEAT, quantity: 2 }, // 2,000 × 2 × 3 = 12,000
        { extra: INSURANCE, quantity: 1 }, // 5,000
      ],
    });
    // base 45,000 + extras 24,500 + one-way 25,000 = 94,500; VAT 4,725; total 99,225
    expect(q.extras.map((e) => [e.extraId, e.totalFils])).toEqual([
      ["gps", 7_500],
      ["seat", 12_000],
      ["insurance", 5_000],
    ]);
    expect(q).toMatchObject({
      baseFils: 45_000,
      extrasFils: 24_500,
      oneWayFeeFils: 25_000,
      subtotalFils: 94_500,
      vatFils: 4_725,
      totalFils: 99_225,
      depositFils: 150_000,
    });
    expect(q.lineItems.reduce((s, l) => s + l.amountFils, 0)).toBe(q.totalFils);
  });

  it("falls back to the any→any one-way fee for other pairs", () => {
    const q = quote({ returnBranchId: SHJ });
    // 45,000 + 40,000 = 85,000; VAT 4,250; total 89,250
    expect(q).toMatchObject({ oneWayFeeFils: 40_000, subtotalFils: 85_000, vatFils: 4_250, totalFils: 89_250 });
  });

  it("72h + 1 minute charges a 4th day", () => {
    const q = quote({ returnAt: new Date(hours(72).getTime() + 60_000) });
    // 4 × 15,000 = 60,000; VAT 3,000
    expect(q).toMatchObject({ rentalDays: 4, baseFils: 60_000, vatFils: 3_000, totalFils: 63_000 });
  });

  it("7+ days uses the weekly tier", () => {
    const q = quote({ returnAt: hours(7 * 24) });
    // 7 × 12,000 = 84,000; VAT 4,200
    expect(q).toMatchObject({ rentalDays: 7, dailyRateFils: 12_000, baseFils: 84_000, vatFils: 4_200, totalFils: 88_200 });
  });

  it("uses the default deposit for a category without its own rule", () => {
    const q = quote({ categoryId: OTHER, returnAt: hours(24) });
    // 30,000; VAT 1,500; deposit 100,000
    expect(q).toMatchObject({ baseFils: 30_000, vatFils: 1_500, totalFils: 31_500, depositFils: 100_000 });
  });

  it("ignores inactive and out-of-validity rules", () => {
    const rules = [
      ...RULES,
      rule({ id: "promo-inactive", kind: "DAILY_RATE", categoryId: CAT, minDays: 1, amountFils: 1_000, priority: 99, isActive: false }),
      rule({
        id: "promo-expired",
        kind: "DAILY_RATE",
        categoryId: CAT,
        minDays: 1,
        amountFils: 2_000,
        priority: 99,
        validFrom: new Date("2029-01-01T00:00:00Z"),
        validTo: new Date("2030-01-01T00:00:00Z"),
      }),
    ];
    expect(quote({ rules }).dailyRateFils).toBe(15_000);
  });

  it("rejects bad extras: over max quantity, inactive, duplicated", () => {
    expect(() => quote({ extras: [{ extra: GPS, quantity: 2 }] })).toThrow();
    expect(() => quote({ extras: [{ extra: { ...GPS, isActive: false }, quantity: 1 }] })).toThrow();
    expect(() => quote({ extras: [{ extra: GPS, quantity: 1 }, { extra: GPS, quantity: 1 }] })).toThrow();
    expect(() => quote({ extras: [{ extra: SEAT, quantity: 0 }] })).toThrow();
  });

  it("refuses to quote with no daily rate or no VAT rule", () => {
    expect(() => quote({ categoryId: "no-such-category" })).toThrow();
    expect(() => quote({ rules: RULES.filter((r) => r.kind !== "VAT") })).toThrow();
  });

  it("only produces integers", () => {
    const q = quote({ returnBranchId: AUH, extras: [{ extra: SEAT, quantity: 1 }], returnAt: hours(50) });
    for (const v of [q.baseFils, q.extrasFils, q.oneWayFeeFils, q.subtotalFils, q.vatFils, q.totalFils, q.depositFils]) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});

describe("VAT rounding (half up, integer fils)", () => {
  it.each([
    [10_000, 500],
    [10_009, 500], // 500.45
    [10_010, 501], // 500.50
    [10_011, 501], // 500.55
    [1, 0], // 0.05
    [10, 1], // 0.5
    [0, 0],
  ])("5%% of %i fils = %i", (amount, vat) => {
    expect(applyRate(amount, 500)).toBe(vat);
  });
});

describe("late-return charge", () => {
  const scheduled = hours(72);
  const late = (minutes: number) =>
    computeLateFee({
      scheduledReturnAt: scheduled,
      actualReturnAt: new Date(scheduled.getTime() + minutes * 60_000),
      dailyRateFils: 15_000,
      hourlyFils: 3_000,
      graceMinutes: 59,
      vatRateBps: 500,
    });

  it("on time or early: nothing", () => {
    expect(late(0).totalFils).toBe(0);
    expect(late(-120).totalFils).toBe(0);
  });
  it("within grace (59 min): nothing", () => {
    expect(late(59)).toMatchObject({ lateMinutes: 59, feeFils: 0, totalFils: 0 });
  });
  it("61 min late: 2 started hours = 6,000 + VAT 300", () => {
    expect(late(61)).toMatchObject({ chargeableHours: 2, feeFils: 6_000, vatFils: 300, totalFils: 6_300 });
  });
  it("6 hours late: 18,000 capped at the daily rate 15,000 + VAT 750", () => {
    expect(late(360)).toMatchObject({ chargeableHours: 6, feeFils: 15_000, vatFils: 750, totalFils: 15_750 });
  });
  it("25 hours late: one full day 15,000 + 1 hour 3,000 = 18,000 + VAT 900", () => {
    expect(late(25 * 60)).toMatchObject({ chargeableHours: 25, feeFils: 18_000, vatFils: 900, totalFils: 18_900 });
  });
});
