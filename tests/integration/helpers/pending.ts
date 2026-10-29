// Loads server functions that may not have landed yet (docs/server-api.md 🚧).
// Tests using them are skipped (not failed) until the export exists, and the
// skip reason names the missing function.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Fn = (...args: any[]) => Promise<any>;

export async function loadFns<const N extends string>(modules: string[], names: readonly N[]) {
  const found: Partial<Record<N, Fn>> = {};
  for (const m of modules) {
    let mod: Record<string, unknown>;
    try {
      mod = await import(/* @vite-ignore */ m);
    } catch {
      continue;
    }
    for (const n of names) if (!found[n] && typeof mod[n] === "function") found[n] = mod[n] as Fn;
  }
  const missing = names.filter((n) => !found[n]);
  return { fns: found as Record<N, Fn>, missing, ready: missing.length === 0 };
}
