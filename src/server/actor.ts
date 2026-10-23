// Who is calling a server function. The App builds this from the better-auth
// session on the server (never from client input).

import { z } from "zod";
import { ForbiddenError } from "./errors";

export const actorSchema = z.object({
  userId: z.uuid(),
  role: z.enum(["customer", "admin"]),
});
export type Actor = z.infer<typeof actorSchema>;

export function parseActor(actor: unknown): Actor {
  const parsed = actorSchema.safeParse(actor);
  if (!parsed.success) throw new ForbiddenError("Sign in to continue");
  return parsed.data;
}

export function isAdmin(actor: Actor): boolean {
  return actor.role === "admin";
}

export function assertAdmin(actor: unknown): Actor {
  const a = parseActor(actor);
  if (a.role !== "admin") throw new ForbiddenError("Admins only");
  return a;
}

/** Owner or admin. */
export function assertOwnerOrAdmin(actor: Actor, ownerUserId: string): void {
  if (actor.role !== "admin" && actor.userId !== ownerUserId) throw new ForbiddenError();
}
