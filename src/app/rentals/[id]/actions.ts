"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { actionError, formString, type ActionState } from "@/app/_lib/action-result";
import { cancelReservation, getReservationForUser, modifyReservationDates } from "@/app/_lib/server-api";
import { zonedToUtc } from "@/lib/format";
import { getCurrentUser, toActor } from "@/server/auth/session";

const cancelSchema = z.object({
  reservationId: z.uuid(),
  reason: z.string().trim().max(500).optional(),
  confirm: z.literal("yes", { message: "Tick the box to confirm the cancellation." }),
});

export async function cancelAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/rentals");
  const parsed = cancelSchema.safeParse({
    reservationId: formString(form, "reservationId"),
    reason: formString(form, "reason") || undefined,
    confirm: formString(form, "confirm"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  try {
    await cancelReservation(toActor(user), { reservationId: parsed.data.reservationId, reason: parsed.data.reason });
  } catch (error) {
    return actionError("app.rentals.cancel_failed", error);
  }
  refresh();
  return { ok: true, message: "Your booking has been cancelled. Any refund goes back to your card." };
}

const PAYMENT_METHODS = {
  success: "pm_fake_success",
  decline: "pm_fake_decline",
  cancel: "pm_fake_cancel",
} as const;

const modifySchema = z.object({
  reservationId: z.uuid(),
  pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pickupTime: z.string().regex(/^\d{2}:\d{2}$/),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  returnTime: z.string().regex(/^\d{2}:\d{2}$/),
  outcome: z.enum(["success", "decline", "cancel"]).optional(),
  idempotencyKey: z.string().min(8).max(200),
});

/** Applies new dates after the customer has seen the server preview. */
export async function modifyAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/rentals");
  const parsed = modifySchema.safeParse({
    reservationId: formString(form, "reservationId"),
    pickupDate: formString(form, "pickupDate"),
    pickupTime: formString(form, "pickupTime"),
    returnDate: formString(form, "returnDate"),
    returnTime: formString(form, "returnTime"),
    outcome: formString(form, "outcome") || undefined,
    idempotencyKey: formString(form, "idempotencyKey"),
  });
  if (!parsed.success) return { error: "Please choose valid dates and times." };
  const d = parsed.data;
  try {
    const actor = toActor(user);
    // Branch time zones come from the reservation itself (owner/admin checked there).
    const r = await getReservationForUser(actor, d.reservationId);
    const pickupAt = zonedToUtc(d.pickupDate, d.pickupTime, r.pickupBranch.timezone);
    const returnAt = zonedToUtc(d.returnDate, d.returnTime, r.returnBranch.timezone);
    if (!pickupAt || !returnAt) return { error: "Please choose valid dates and times." };
    await modifyReservationDates(actor, {
      reservationId: d.reservationId,
      pickupAt,
      returnAt,
      paymentMethod: d.outcome ? PAYMENT_METHODS[d.outcome] : undefined,
      idempotencyKey: d.idempotencyKey,
    });
  } catch (error) {
    return actionError("app.rentals.modify_failed", error);
  }
  redirect(`/rentals/${d.reservationId}?changed=1`);
}
