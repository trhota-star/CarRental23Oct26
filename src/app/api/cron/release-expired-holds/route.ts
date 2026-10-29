// POST|GET /api/cron/release-expired-holds — Vercel Cron (GET) or any scheduler (POST).
// Requires `Authorization: Bearer ${CRON_SECRET}`. Idempotent and parallel-safe.

import { isAuthorizedCronRequest } from "@/server/jobs/cron-auth";
import { log } from "@/server/log";
import { releaseExpiredReservationHolds } from "@/server/reservations";

async function run(request: Request): Promise<Response> {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await releaseExpiredReservationHolds({ now: new Date() });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    log.error("cron.release_expired_holds.failed", { error });
    return Response.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}

export const POST = run;
export const GET = run;
