import "server-only";
import { notFound } from "next/navigation";
import { requireUser, toActor, type CurrentUser } from "@/server/auth/session";
import { isDomainError } from "@/server/errors";
import { getReservationForUser, type ReservationView } from "./server-api";

/**
 * Loads a reservation the signed-in user may see (owner or admin). Anything
 * else — wrong owner, bad id — renders the 404 page, so ids can't be probed.
 */
export async function loadOwnedReservation(
  id: string,
  nextPath: string,
): Promise<{ user: CurrentUser; reservation: ReservationView }> {
  const user = await requireUser(nextPath);
  try {
    const reservation = await getReservationForUser(toActor(user), id);
    return { user, reservation };
  } catch (e) {
    if (isDomainError(e) && (e.code === "NOT_FOUND" || e.code === "VALIDATION" || e.code === "FORBIDDEN")) notFound();
    throw e;
  }
}
