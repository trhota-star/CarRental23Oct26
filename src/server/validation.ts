import { z } from "zod";
import { ValidationError } from "./errors";

/** Parses input with a Zod schema, throwing a ValidationError with field messages. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".") || "_";
      fields[key] ??= issue.message;
    }
    throw new ValidationError("Please check the highlighted fields", { fields });
  }
  return result.data;
}

/** ISO-8601 instant with an explicit offset or Z (e.g. 2030-01-01T10:00:00+04:00), or a Date. */
export const instant = z
  .union([z.date(), z.iso.datetime({ offset: true })])
  .transform((v) => (v instanceof Date ? v : new Date(v)))
  .refine((d) => !Number.isNaN(d.getTime()), "Invalid date");

export const fils = z.number().int().nonnegative().max(1_000_000_000);
export const uuid = z.uuid();

/**
 * Object-level check that `to` is after `from` and the span is ≤ maxMs.
 * Skips silently when either field already failed (so bad dates surface as
 * VALIDATION field errors, never as TypeErrors).
 */
export function checkRange<T extends Record<string, unknown>>(
  fromKey: keyof T & string,
  toKey: keyof T & string,
  maxMs: number,
  messages: { order: string; tooLong: string },
) {
  return (v: T, ctx: z.RefinementCtx) => {
    const from = v[fromKey];
    const to = v[toKey];
    if (!(from instanceof Date) || !(to instanceof Date) || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return;
    if (to.getTime() <= from.getTime()) ctx.addIssue({ code: "custom", message: messages.order, path: [toKey] });
    else if (to.getTime() - from.getTime() > maxMs) ctx.addIssue({ code: "custom", message: messages.tooLong, path: [toKey] });
  };
}
