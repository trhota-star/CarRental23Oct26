// Pure pricing engine: no database, no I/O, integer fils only.
// `quotePrice` (./quote.ts) loads rules from the database and calls `computeQuote`.

export const CURRENCY = "AED";
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export type PricingRuleKind = "DAILY_RATE" | "ONE_WAY_FEE" | "VAT" | "DEPOSIT" | "LATE_RETURN";

export type PricingRuleInput = {
  id: string;
  kind: PricingRuleKind;
  name: string;
  categoryId: string | null;
  fromBranchId: string | null;
  toBranchId: string | null;
  minDays: number;
  amountFils: number | null;
  rateBps: number | null;
  graceMinutes: number;
  priority: number;
  validFrom: Date | null;
  validTo: Date | null;
  isActive: boolean;
};

export type ExtraInput = {
  id: string;
  code: string;
  name: string;
  chargeType: "PER_DAY" | "PER_RENTAL";
  priceFils: number;
  maxQuantity: number;
  isActive: boolean;
};

export type QuoteInput = {
  categoryId: string;
  pickupBranchId: string;
  returnBranchId: string;
  pickupAt: Date;
  returnAt: Date;
  extras: { extra: ExtraInput; quantity: number }[];
  rules: PricingRuleInput[];
};

export type QuoteExtraLine = {
  extraId: string;
  code: string;
  name: string;
  chargeType: "PER_DAY" | "PER_RENTAL";
  quantity: number;
  unitPriceFils: number;
  totalFils: number;
};

export type QuoteLineItem = {
  kind: "BASE" | "EXTRA" | "ONE_WAY_FEE" | "VAT";
  label: string;
  amountFils: number;
};

export type Quote = {
  currency: typeof CURRENCY;
  pickupAt: string;
  returnAt: string;
  rentalDays: number;
  dailyRateFils: number;
  baseFils: number;
  extras: QuoteExtraLine[];
  extrasFils: number;
  oneWayFeeFils: number;
  subtotalFils: number;
  vatRateBps: number;
  vatFils: number;
  /** Amount charged now = subtotal + VAT. The deposit is held separately. */
  totalFils: number;
  depositFils: number;
  /** Display-ready breakdown, in order. Sum equals totalFils. */
  lineItems: QuoteLineItem[];
  appliedRuleIds: string[];
};

export class PricingRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PricingRuleError";
  }
}

/** Number of charged rental days: every started 24 hours counts, minimum 1. */
export function rentalDays(pickupAt: Date, returnAt: Date): number {
  const ms = returnAt.getTime() - pickupAt.getTime();
  if (!(ms > 0)) throw new PricingRuleError("Return must be after pick-up");
  return Math.max(1, Math.ceil(ms / DAY_MS));
}

/** VAT (or any basis-point rate) on an integer amount, rounded half up. */
export function applyRate(amountFils: number, rateBps: number): number {
  assertInt(amountFils, "amount");
  assertInt(rateBps, "rate");
  return Math.floor((amountFils * rateBps + 5000) / 10000);
}

function assertInt(n: number, what: string) {
  if (!Number.isSafeInteger(n) || n < 0) throw new PricingRuleError(`${what} must be a non-negative integer`);
}

function applies(rule: PricingRuleInput, kind: PricingRuleKind, at: Date): boolean {
  return (
    rule.isActive &&
    rule.kind === kind &&
    (rule.validFrom === null || rule.validFrom.getTime() <= at.getTime()) &&
    (rule.validTo === null || at.getTime() < rule.validTo.getTime())
  );
}

function best<T extends PricingRuleInput>(candidates: { rule: T; score: number }[]): T | undefined {
  candidates.sort((a, b) => b.score - a.score || b.rule.priority - a.rule.priority || a.rule.id.localeCompare(b.rule.id));
  return candidates[0]?.rule;
}

/** Daily rate for a category: highest min_days ≤ days wins, then priority. */
export function selectDailyRate(rules: PricingRuleInput[], categoryId: string, days: number, at: Date) {
  return best(
    rules
      .filter((r) => applies(r, "DAILY_RATE", at) && r.categoryId === categoryId && r.minDays <= days)
      .map((rule) => ({ rule, score: rule.minDays })),
  );
}

/** Category-specific rule beats a default (category_id null) rule. */
export function selectCategoryRule(
  rules: PricingRuleInput[],
  kind: "DEPOSIT" | "LATE_RETURN",
  categoryId: string,
  at: Date,
) {
  return best(
    rules
      .filter((r) => applies(r, kind, at) && (r.categoryId === null || r.categoryId === categoryId))
      .map((rule) => ({ rule, score: rule.categoryId ? 1 : 0 })),
  );
}

/** Exact from/to pair beats from-only beats to-only beats any→any. */
export function selectOneWayFee(rules: PricingRuleInput[], fromBranchId: string, toBranchId: string, at: Date) {
  return best(
    rules
      .filter(
        (r) =>
          applies(r, "ONE_WAY_FEE", at) &&
          (r.fromBranchId === null || r.fromBranchId === fromBranchId) &&
          (r.toBranchId === null || r.toBranchId === toBranchId),
      )
      .map((rule) => ({ rule, score: (rule.fromBranchId ? 2 : 0) + (rule.toBranchId ? 1 : 0) })),
  );
}

export function selectVat(rules: PricingRuleInput[], at: Date) {
  return best(rules.filter((r) => applies(r, "VAT", at)).map((rule) => ({ rule, score: 0 })));
}

export function computeQuote(input: QuoteInput): Quote {
  const { pickupAt, returnAt, rules } = input;
  const days = rentalDays(pickupAt, returnAt);
  const applied: string[] = [];

  const rateRule = selectDailyRate(rules, input.categoryId, days, pickupAt);
  if (!rateRule || rateRule.amountFils === null) throw new PricingRuleError("No daily rate is set for this vehicle category");
  applied.push(rateRule.id);
  const dailyRateFils = rateRule.amountFils;
  const baseFils = dailyRateFils * days;

  const seen = new Set<string>();
  const extras: QuoteExtraLine[] = input.extras.map(({ extra, quantity }) => {
    if (seen.has(extra.id)) throw new PricingRuleError(`Extra ${extra.code} listed twice`);
    seen.add(extra.id);
    if (!extra.isActive) throw new PricingRuleError(`Extra ${extra.code} is not available`);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > extra.maxQuantity) {
      throw new PricingRuleError(`Quantity for ${extra.name} must be between 1 and ${extra.maxQuantity}`);
    }
    const units = extra.chargeType === "PER_DAY" ? quantity * days : quantity;
    return {
      extraId: extra.id,
      code: extra.code,
      name: extra.name,
      chargeType: extra.chargeType,
      quantity,
      unitPriceFils: extra.priceFils,
      totalFils: extra.priceFils * units,
    };
  });
  const extrasFils = extras.reduce((sum, e) => sum + e.totalFils, 0);

  let oneWayFeeFils = 0;
  if (input.pickupBranchId !== input.returnBranchId) {
    const feeRule = selectOneWayFee(rules, input.pickupBranchId, input.returnBranchId, pickupAt);
    if (!feeRule || feeRule.amountFils === null) {
      throw new PricingRuleError("One-way rentals are not offered between these branches");
    }
    applied.push(feeRule.id);
    oneWayFeeFils = feeRule.amountFils;
  }

  const vatRule = selectVat(rules, pickupAt);
  if (!vatRule || vatRule.rateBps === null) throw new PricingRuleError("No VAT rule is configured");
  applied.push(vatRule.id);
  const vatRateBps = vatRule.rateBps;

  const subtotalFils = baseFils + extrasFils + oneWayFeeFils;
  const vatFils = applyRate(subtotalFils, vatRateBps);
  const totalFils = subtotalFils + vatFils;

  const depositRule = selectCategoryRule(rules, "DEPOSIT", input.categoryId, pickupAt);
  const depositFils = depositRule?.amountFils ?? 0;
  if (depositRule) applied.push(depositRule.id);

  const lineItems: QuoteLineItem[] = [
    { kind: "BASE", label: `${formatAed(dailyRateFils)} × ${days} day${days === 1 ? "" : "s"}`, amountFils: baseFils },
    ...extras.map((e) => ({
      kind: "EXTRA" as const,
      label: e.chargeType === "PER_DAY" ? `${e.name} × ${e.quantity} × ${days} day${days === 1 ? "" : "s"}` : `${e.name} × ${e.quantity}`,
      amountFils: e.totalFils,
    })),
    ...(oneWayFeeFils > 0 ? [{ kind: "ONE_WAY_FEE" as const, label: "One-way fee", amountFils: oneWayFeeFils }] : []),
    { kind: "VAT", label: `VAT ${vatRateBps / 100}%`, amountFils: vatFils },
  ];

  return {
    currency: CURRENCY,
    pickupAt: pickupAt.toISOString(),
    returnAt: returnAt.toISOString(),
    rentalDays: days,
    dailyRateFils,
    baseFils,
    extras,
    extrasFils,
    oneWayFeeFils,
    subtotalFils,
    vatRateBps,
    vatFils,
    totalFils,
    depositFils,
    lineItems,
    appliedRuleIds: applied,
  };
}

export type LateFee = {
  lateMinutes: number;
  chargeableHours: number;
  feeFils: number;
  vatFils: number;
  totalFils: number;
};

/**
 * Late-return charge. Within the grace period: free. After it, every started hour
 * costs the LATE_RETURN hourly amount, but each 24h block is capped at the daily rate.
 * VAT is added at the given rate.
 */
export function computeLateFee(input: {
  scheduledReturnAt: Date;
  actualReturnAt: Date;
  dailyRateFils: number;
  hourlyFils: number;
  graceMinutes: number;
  vatRateBps: number;
}): LateFee {
  const lateMs = input.actualReturnAt.getTime() - input.scheduledReturnAt.getTime();
  const lateMinutes = lateMs > 0 ? Math.ceil(lateMs / 60000) : 0;
  if (lateMinutes <= input.graceMinutes) return { lateMinutes, chargeableHours: 0, feeFils: 0, vatFils: 0, totalFils: 0 };
  const chargeableHours = Math.ceil(lateMs / HOUR_MS);
  const fullDays = Math.floor(chargeableHours / 24);
  const remHours = chargeableHours % 24;
  const feeFils = fullDays * input.dailyRateFils + Math.min(remHours * input.hourlyFils, input.dailyRateFils);
  const vatFils = applyRate(feeFils, input.vatRateBps);
  return { lateMinutes, chargeableHours, feeFils, vatFils, totalFils: feeFils + vatFils };
}

/** "AED 1,234.50" — formatting helper; never used for arithmetic. */
export function formatAed(fils: number): string {
  const sign = fils < 0 ? "-" : "";
  const abs = Math.abs(fils);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}AED ${whole}.${String(abs % 100).padStart(2, "0")}`;
}
