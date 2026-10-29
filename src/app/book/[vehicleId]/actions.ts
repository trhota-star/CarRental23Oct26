"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { actionError, formString, type ActionState } from "@/app/_lib/action-result";
import { parseExtraSelections } from "@/lib/extras";
import { zonedToUtc } from "@/lib/format";
import { getCurrentUser, toActor } from "@/server/auth/session";
import { createReservationHold, getBranch } from "@/app/_lib/server-api";

const schema = z.object({
  vehicleId: z.uuid(),
  pickupBranchId: z.uuid(),
  returnBranchId: z.uuid(),
  pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pickupTime: z.string().regex(/^\d{2}:\d{2}$/),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  returnTime: z.string().regex(/^\d{2}:\d{2}$/),
  idempotencyKey: z.string().min(8).max(200),
});

/** Creates the PENDING hold (price is re-quoted on the server) and moves to checkout. */
export async function reserveAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const parsed = schema.safeParse({
    vehicleId: formString(form, "vehicleId"),
    pickupBranchId: formString(form, "pickupBranchId"),
    returnBranchId: formString(form, "returnBranchId"),
    pickupDate: formString(form, "pickupDate"),
    pickupTime: formString(form, "pickupTime"),
    returnDate: formString(form, "returnDate"),
    returnTime: formString(form, "returnTime"),
    idempotencyKey: formString(form, "idempotencyKey"),
  });
  if (!parsed.success) return { error: "Your trip details are incomplete. Please start your search again." };
  const d = parsed.data;
  const extras = parseExtraSelections(Object.fromEntries(form.entries()));

  let reservationId: string;
  try {
    const [pickupBranch, returnBranch] = await Promise.all([getBranch(d.pickupBranchId), getBranch(d.returnBranchId)]);
    const pickupAt = zonedToUtc(d.pickupDate, d.pickupTime, pickupBranch.timezone);
    const returnAt = zonedToUtc(d.returnDate, d.returnTime, returnBranch.timezone);
    if (!pickupAt || !returnAt) return { error: "Please choose valid dates and times." };
    const reservation = await createReservationHold(toActor(user), {
      vehicleId: d.vehicleId,
      pickupBranchId: pickupBranch.id,
      returnBranchId: returnBranch.id,
      pickupAt,
      returnAt,
      extras,
      idempotencyKey: d.idempotencyKey,
    });
    reservationId = reservation.id;
  } catch (error) {
    return actionError("app.book.reserve_failed", error);
  }
  redirect(`/checkout/${reservationId}`);
}
