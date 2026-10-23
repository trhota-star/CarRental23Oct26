// Server-side price quotes backed by the database. The client never computes prices.

import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Executor } from "../db";
import { branches, extras, pricingRules, vehicles } from "../db/schema";
import { NotFoundError, PricingError, ValidationError } from "../errors";
import { instant, parseInput } from "../validation";
import { computeQuote, PricingRuleError, type ExtraInput, type PricingRuleInput, type Quote } from "./engine";

export const MAX_RENTAL_DAYS = 90;

export const extraSelectionSchema = z
  .array(z.object({ extraId: z.uuid(), quantity: z.number().int().min(1).max(10) }))
  .max(20)
  .default([]);

export const quoteInputSchema = z
  .object({
    vehicleId: z.uuid(),
    pickupBranchId: z.uuid(),
    returnBranchId: z.uuid(),
    pickupAt: instant,
    returnAt: instant,
    extras: extraSelectionSchema,
  })
  .refine((v) => v.returnAt.getTime() > v.pickupAt.getTime(), { message: "Return must be after pick-up", path: ["returnAt"] })
  .refine((v) => v.returnAt.getTime() - v.pickupAt.getTime() <= MAX_RENTAL_DAYS * 86_400_000, {
    message: `Rentals are limited to ${MAX_RENTAL_DAYS} days`,
    path: ["returnAt"],
  });
export type QuoteRequest = z.input<typeof quoteInputSchema>;

export async function loadPricingRules(db: Executor = getDb()): Promise<PricingRuleInput[]> {
  return db.select().from(pricingRules).where(eq(pricingRules.isActive, true));
}

async function loadExtras(db: Executor, ids: string[]): Promise<Map<string, ExtraInput>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select().from(extras).where(inArray(extras.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Quote inside an existing executor (used by the reservation transaction).
 * Validates the vehicle, branches and extras exist and are usable.
 */
export async function quoteWith(
  db: Executor,
  input: z.output<typeof quoteInputSchema>,
  opts: { rules?: PricingRuleInput[] } = {},
): Promise<Quote & { categoryId: string }> {
  const [vehicle] = await db
    .select({ id: vehicles.id, categoryId: vehicles.categoryId, status: vehicles.status })
    .from(vehicles)
    .where(eq(vehicles.id, input.vehicleId));
  if (!vehicle) throw new NotFoundError("Vehicle");

  const branchRows = await db
    .select({ id: branches.id, isActive: branches.isActive })
    .from(branches)
    .where(inArray(branches.id, [input.pickupBranchId, input.returnBranchId]));
  for (const id of [input.pickupBranchId, input.returnBranchId]) {
    const b = branchRows.find((r) => r.id === id);
    if (!b) throw new NotFoundError("Branch");
    if (!b.isActive) throw new ValidationError("This branch is not currently accepting rentals");
  }

  const extraMap = await loadExtras(db, input.extras.map((e) => e.extraId));
  const selected = input.extras.map((e) => {
    const extra = extraMap.get(e.extraId);
    if (!extra) throw new NotFoundError("Extra");
    return { extra, quantity: e.quantity };
  });

  try {
    const quote = computeQuote({
      categoryId: vehicle.categoryId,
      pickupBranchId: input.pickupBranchId,
      returnBranchId: input.returnBranchId,
      pickupAt: input.pickupAt,
      returnAt: input.returnAt,
      extras: selected,
      rules: opts.rules ?? (await loadPricingRules(db)),
    });
    return { ...quote, categoryId: vehicle.categoryId };
  } catch (error) {
    if (error instanceof PricingRuleError) throw new PricingError(error.message);
    throw error;
  }
}

/** Price breakdown for a vehicle, branches, dates and extras (all amounts in fils). */
export async function quotePrice(input: QuoteRequest): Promise<Quote> {
  const parsed = parseInput(quoteInputSchema, input);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { categoryId, ...quote } = await quoteWith(getDb(), parsed);
  return quote;
}
