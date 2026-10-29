"use server";

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { actionError, formString, type ActionState } from "@/app/_lib/action-result";
import { payForReservation } from "@/app/_lib/server-api";
import { getCurrentUser, toActor } from "@/server/auth/session";

/** Test-mode outcomes the fake provider understands. */
const TEST_OUTCOMES = {
  success: "pm_fake_success",
  decline: "pm_fake_decline",
  cancel: "pm_fake_cancel",
  pending: "pm_fake_pending",
} as const;

export type PayState = ActionState & { nextKey?: string };

const schema = z.object({
  reservationId: z.uuid(),
  outcome: z.enum(["success", "decline", "cancel", "pending"], { message: "Choose a test outcome." }),
  idempotencyKey: z.string().min(8).max(200),
});

export async function payAction(_prev: PayState, form: FormData): Promise<PayState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const parsed = schema.safeParse({
    reservationId: formString(form, "reservationId"),
    outcome: formString(form, "outcome"),
    idempotencyKey: formString(form, "idempotencyKey"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid payment details." };
  const { reservationId, outcome, idempotencyKey } = parsed.data;

  let result;
  try {
    result = await payForReservation(toActor(user), {
      reservationId,
      paymentMethod: TEST_OUTCOMES[outcome],
      idempotencyKey,
    });
  } catch (error) {
    // A fresh key lets the customer try again after fixing the problem.
    return { ...actionError("app.checkout.pay_failed", error), nextKey: randomUUID() };
  }

  switch (result.outcome) {
    case "CONFIRMED":
    case "ALREADY_CONFIRMED":
      redirect(`/rentals/${reservationId}/voucher?new=1`);
    case "PAYMENT_PENDING":
      refresh();
      return { ok: true, message: result.message, nextKey: idempotencyKey };
    case "DEPOSIT_FAILED":
      // Same key: the rental charge is kept and only the deposit is retried.
      return { error: result.message, code: "PAYMENT_FAILED", nextKey: idempotencyKey };
    case "HOLD_EXPIRED":
      refresh();
      return { error: result.message, code: "INVALID_STATE" };
    case "PAYMENT_FAILED":
    default:
      return { error: result.message, code: "PAYMENT_FAILED", nextKey: randomUUID() };
  }
}
