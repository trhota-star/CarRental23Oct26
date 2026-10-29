/** Extras are carried in forms/URLs as `x.<extraId>=<quantity>`. */
export const EXTRA_PREFIX = "x.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseExtraSelections(
  entries: Record<string, FormDataEntryValue | string | string[] | undefined>,
): Array<{ extraId: string; quantity: number }> {
  const out: Array<{ extraId: string; quantity: number }> = [];
  for (const [key, raw] of Object.entries(entries)) {
    if (!key.startsWith(EXTRA_PREFIX)) continue;
    const extraId = key.slice(EXTRA_PREFIX.length);
    const value = Array.isArray(raw) ? raw[0] : raw;
    const quantity = typeof value === "string" ? Number.parseInt(value, 10) : NaN;
    if (!UUID.test(extraId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 10) continue;
    out.push({ extraId, quantity });
  }
  return out.slice(0, 20);
}

export function extrasToParams(sel: Array<{ extraId: string; quantity: number }>): Record<string, string> {
  return Object.fromEntries(sel.map((s) => [`${EXTRA_PREFIX}${s.extraId}`, String(s.quantity)]));
}
