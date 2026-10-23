// Typed domain errors. Every error has a stable `code` the UI can switch on and
// a safe, user-facing `message`. Anything else thrown is an internal error.

export type DomainErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "VEHICLE_UNAVAILABLE"
  | "INVALID_STATE"
  | "IDEMPOTENCY_CONFLICT"
  | "PRICING"
  | "PAYMENT_FAILED"
  | "DRIVER_PROFILE_INCOMPLETE"
  | "POLICY";

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("VALIDATION", message, details);
    this.name = "ValidationError";
  }
}
export class NotFoundError extends DomainError {
  constructor(what: string) {
    super("NOT_FOUND", `${what} not found`);
    this.name = "NotFoundError";
  }
}
export class ForbiddenError extends DomainError {
  constructor(message = "You are not allowed to do that") {
    super("FORBIDDEN", message);
    this.name = "ForbiddenError";
  }
}
/** The vehicle is no longer available for the requested period (SQLSTATE 23P01 or overlap check). */
export class VehicleUnavailableError extends DomainError {
  constructor(message = "This vehicle is no longer available for the selected dates") {
    super("VEHICLE_UNAVAILABLE", message);
    this.name = "VehicleUnavailableError";
  }
}
export class InvalidStateError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("INVALID_STATE", message, details);
    this.name = "InvalidStateError";
  }
}
export class IdempotencyConflictError extends DomainError {
  constructor() {
    super("IDEMPOTENCY_CONFLICT", "This request key was already used for a different request");
    this.name = "IdempotencyConflictError";
  }
}
export class PricingError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("PRICING", message, details);
    this.name = "PricingError";
  }
}
export class PaymentFailedError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("PAYMENT_FAILED", message, details);
    this.name = "PaymentFailedError";
  }
}
export class DriverProfileIncompleteError extends DomainError {
  constructor(message = "Add your driver details and upload your licence before paying") {
    super("DRIVER_PROFILE_INCOMPLETE", message);
    this.name = "DriverProfileIncompleteError";
  }
}
export class PolicyError extends DomainError {
  constructor(message: string) {
    super("POLICY", message);
    this.name = "PolicyError";
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

/** PostgreSQL SQLSTATE of a pg error (also looks through Drizzle's wrapped `cause`). */
export function pgErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let i = 0; i < 4 && current; i++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Name of the violated constraint for a pg error, if any. */
export function pgConstraint(error: unknown): string | undefined {
  let current: unknown = error;
  for (let i = 0; i < 4 && current; i++) {
    const c = (current as { constraint?: unknown }).constraint;
    if (typeof c === "string") return c;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export const PG_EXCLUSION_VIOLATION = "23P01";
export const PG_UNIQUE_VIOLATION = "23505";
export const PG_SERIALIZATION_FAILURE = "40001";
export const PG_DEADLOCK = "40P01";
