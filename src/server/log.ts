// Structured JSON logger. One JSON object per line on stdout/stderr.
//   log.info("reservation.hold.created", { reservationId, vehicleId });
// Never log secrets, card data, licence contents or full webhook bodies.

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function minLevel(): number {
  const configured = (process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "warn" : "info")) as Level;
  return ORDER[configured] ?? ORDER.info;
}

function serialiseError(error: unknown): unknown {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, code: (error as { code?: unknown }).code, stack: error.stack };
  }
  return error;
}

function write(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  if (ORDER[level] < minLevel()) return;
  const entry: Record<string, unknown> = { time: new Date().toISOString(), level, event };
  for (const [key, value] of Object.entries(fields)) {
    entry[key] = key === "error" || value instanceof Error ? serialiseError(value) : value;
  }
  const line = JSON.stringify(entry);
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (event: string, fields?: Record<string, unknown>) => write("debug", event, fields),
  info: (event: string, fields?: Record<string, unknown>) => write("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => write("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => write("error", event, fields),
};
