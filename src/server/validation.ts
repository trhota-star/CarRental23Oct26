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
