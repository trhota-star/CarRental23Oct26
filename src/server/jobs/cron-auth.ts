import { timingSafeEqual } from "node:crypto";

/** True when the request carries `Authorization: Bearer ${CRON_SECRET}`. Fails closed if the secret is unset. */
export function isAuthorizedCronRequest(authorization: string | null, secret = process.env.CRON_SECRET): boolean {
  if (!secret || !authorization) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(authorization);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
