import { describe, expect, it } from "vitest";
import {
  applyRate,
  computeLateFee,
  computeQuote,
  formatAed,
  PricingRuleError,
  rentalDays,
  type ExtraInput,
  type PricingRuleInput,
} from "./engine";

const base: Omit<PricingRuleInput, "id" | "kind" | "name"> = {
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
};
const rule = (r: Partial<PricingRuleInput> & Pick<PricingRuleInput, "id" | "kind">): PricingRuleInput => ({
  ...base,
  name: r.id,
  ...r,
});

const rules: PricingRuleInput[] = [
  rule({ id: "rate1", kind: "DAILY_RATE", categoryId: "eco", amountFils: 10000 }),
  rule({ id: "rate7", kind: "DAILY_RATE", categoryId: "eco", minDays: 7, amountFils: 8500 }),
  rule({ id: "rateSuv", kind: "DAILY_RATE", categoryId: "suv", amountFils: 30000 }),
  rule({ id: "vat", kind: "VAT", rateBps: 500 }),
  rule({ id: "dep", kind: "DEPOSIT", amountFils: 100000 }),
  rule({ id: "depSuv", kind: "DEPOSIT", categoryId: "suv", amountFils: 250000 }),
  rule({ id: "owAny", kind: "ONE_WAY_FEE", amountFils: 15000 }),
  rule({ id: "owDxbAuh", kind: "ONE_WAY_FEE", fromBranchId: "dxb", toBranchId: "auh", amountFils: 25000 }),
];

const gps: ExtraInput = { id: "gps", code: "GPS", name: "GPS", chargeType: "PER_DAY", priceFils: 1500, maxQuantity: 1, isActive: true };
const seat: ExtraInput = { id: "seat", code: "CHILD_SEAT", name: "Child seat", chargeType: "PER_DAY", priceFils: 2000, maxQuantity: 3, isActive: true };
const clean: ExtraInput = { id: "clean", code: "CLEAN", name: "Cleaning", chargeType: "PER_RENTAL", priceFils: 5000, maxQuantity: 1, isActive: true };

const at = (iso: string) => new Date(iso);

describe("rentalDays", () => {
  it("counts every started 24h, minimum 1", () => {
    expect(rentalDays(at("2030-01-01T10:00Z"), at("2030-01-01T12:00Z"))).toBe(1);
    expect(rentalDays(at("2030-01-01T10:00Z"), at("2030-01-02T10:00Z"))).toBe(1);
    expect(rentalDays(at("2030-01-01T10:00Z"), at("2030-01-02T10:01Z"))).toBe(2);
  });
  it("rejects non-positive periods", () => {
    expect(() => rentalDays(at("2030-01-02Z"), at("2030-01-01Z"))).toThrow(PricingRuleError);
  });
});

describe("applyRate", () => {
  it("rounds half up in integer fils", () => {
    expect(applyRate(10000, 500)).toBe(500);
    expect(applyRate(10, 500)).toBe(1); // 0.5 → 1
    expect(applyRate(9, 500)).toBe(0); // 0.45 → 0
  });
});

describe("computeQuote", () => {
  it("prices a 3-day round trip with extras and VAT", () => {
    const q = computeQuote({
      categoryId: "eco",
      pickupBranchId: "dxb",
      returnBranchId: "dxb",
      pickupAt: at("2030-01-01T10:00Z"),
      returnAt: at("2030-01-04T10:00Z"),
      extras: [
        { extra: gps, quantity: 1 },
        { extra: seat, quantity: 2 },
        { extra: clean, quantity: 1 },
      ],
      rules,
    });
    expect(q.rentalDays).toBe(3);
    expect(q.baseFils).toBe(30000);
    expect(q.extrasFils).toBe(1500 * 3 + 2000 * 2 * 3 + 5000);
    expect(q.oneWayFeeFils).toBe(0);
    expect(q.subtotalFils).toBe(30000 + 21500);
    expect(q.vatFils).toBe(2575);
    expect(q.totalFils).toBe(51500 + 2575);
    expect(q.depositFils).toBe(100000);
    expect(q.lineItems.reduce((s, l) => s + l.amountFils, 0)).toBe(q.totalFils);
  });

  it("uses the weekly tier and the most specific one-way fee and deposit", () => {
    const q = computeQuote({
      categoryId: "eco",
      pickupBranchId: "dxb",
      returnBranchId: "auh",
      pickupAt: at("2030-01-01T10:00Z"),
      returnAt: at("2030-01-08T10:00Z"),
      extras: [],
      rules,
    });
    expect(q.dailyRateFils).toBe(8500);
    expect(q.oneWayFeeFils).toBe(25000);
    const other = computeQuote({ ...{ categoryId: "suv", pickupBranchId: "shj", returnBranchId: "auh" }, pickupAt: at("2030-01-01Z"), returnAt: at("2030-01-02Z"), extras: [], rules });
    expect(other.oneWayFeeFils).toBe(15000);
    expect(other.depositFils).toBe(250000);
  });

  it("ignores inactive and out-of-window rules", () => {
    const seasonal = rule({
      id: "summer",
      kind: "DAILY_RATE",
      categoryId: "eco",
      amountFils: 7000,
      priority: 10,
      validFrom: at("2030-06-01Z"),
      validTo: at("2030-09-01Z"),
    });
    const inactive = rule({ id: "off", kind: "DAILY_RATE", categoryId: "eco", amountFils: 1, priority: 99, isActive: false });
    const winter = computeQuote({ categoryId: "eco", pickupBranchId: "a", returnBranchId: "a", pickupAt: at("2030-01-01Z"), returnAt: at("2030-01-02Z"), extras: [], rules: [...rules, seasonal, inactive] });
    const summer = computeQuote({ categoryId: "eco", pickupBranchId: "a", returnBranchId: "a", pickupAt: at("2030-07-01Z"), returnAt: at("2030-07-02Z"), extras: [], rules: [...rules, seasonal, inactive] });
    expect(winter.dailyRateFils).toBe(10000);
    expect(summer.dailyRateFils).toBe(7000);
  });

  it("rejects bad extras and missing rules", () => {
    const input = { categoryId: "eco", pickupBranchId: "a", returnBranchId: "a", pickupAt: at("2030-01-01Z"), returnAt: at("2030-01-02Z"), rules };
    expect(() => computeQuote({ ...input, extras: [{ extra: gps, quantity: 2 }] })).toThrow(PricingRuleError);
    expect(() => computeQuote({ ...input, extras: [{ extra: { ...gps, isActive: false }, quantity: 1 }] })).toThrow(PricingRuleError);
    expect(() => computeQuote({ ...input, categoryId: "none", extras: [] })).toThrow(/daily rate/);
    expect(() => computeQuote({ ...input, extras: [], rules: rules.filter((r) => r.kind !== "VAT") })).toThrow(/VAT/);
    expect(() =>
      computeQuote({ ...input, returnBranchId: "b", extras: [], rules: rules.filter((r) => r.kind !== "ONE_WAY_FEE") }),
    ).toThrow(/One-way/);
  });
});

describe("computeLateFee", () => {
  const scheduled = at("2030-01-05T10:00Z");
  const args = { scheduledReturnAt: scheduled, dailyRateFils: 10000, hourlyFils: 2500, graceMinutes: 59, vatRateBps: 500 };
  it("is free within grace", () => {
    expect(computeLateFee({ ...args, actualReturnAt: at("2030-01-05T10:59Z") }).totalFils).toBe(0);
    expect(computeLateFee({ ...args, actualReturnAt: at("2030-01-05T09:00Z") }).lateMinutes).toBe(0);
  });
  it("charges per started hour, capped per day at the daily rate, plus VAT", () => {
    const twoHours = computeLateFee({ ...args, actualReturnAt: at("2030-01-05T11:30Z") });
    expect(twoHours.chargeableHours).toBe(2);
    expect(twoHours.feeFils).toBe(5000);
    expect(twoHours.vatFils).toBe(250);
    const tenHours = computeLateFee({ ...args, actualReturnAt: at("2030-01-05T20:00Z") });
    expect(tenHours.feeFils).toBe(10000);
    const dayAndOne = computeLateFee({ ...args, actualReturnAt: at("2030-01-06T11:00Z") });
    expect(dayAndOne.feeFils).toBe(10000 + 2500);
  });
});

describe("formatAed", () => {
  it("formats fils", () => {
    expect(formatAed(123456)).toBe("AED 1,234.56");
    expect(formatAed(5)).toBe("AED 0.05");
  });
});
