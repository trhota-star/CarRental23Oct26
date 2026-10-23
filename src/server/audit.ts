import { getDb, type Executor } from "./db";
import { auditLogs } from "./db/schema";

/** Appends an audit log row (inside the caller's transaction when given one). */
export async function audit(
  db: Executor | undefined,
  entry: { actorId: string | null; action: string; entityType: string; entityId?: string | null; data?: Record<string, unknown> },
): Promise<void> {
  await (db ?? getDb()).insert(auditLogs).values({
    actorId: entry.actorId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    data: entry.data ?? {},
  });
}
