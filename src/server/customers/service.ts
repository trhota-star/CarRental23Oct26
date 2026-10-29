// Driver profiles, licence uploads and private-file authorisation.
// Files live in private storage (getFileStorage()); keys are never public URLs.

import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { assertAdmin, isAdmin, parseActor, type Actor } from "../actor";
import { audit } from "../audit";
import { getDb, type Db } from "../db";
import { damageReports, driverProfiles, reservations } from "../db/schema";
import { DriverProfileIncompleteError, NotFoundError, ValidationError } from "../errors";
import { log } from "../log";
import { getFileStorage, type FileStorage } from "../storage";
import { parseInput } from "../validation";

export type DriverProfile = typeof driverProfiles.$inferSelect;
type Opts = { db?: Db; storage?: FileStorage; now?: Date };

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const UPLOAD_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
} as const;
export type UploadContentType = keyof typeof UPLOAD_TYPES;

/** Checks the declared type against the file's magic bytes. */
function sniff(body: Uint8Array, type: UploadContentType): boolean {
  const b = body;
  switch (type) {
    case "image/jpeg":
      return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case "image/png":
      return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    case "image/webp":
      return String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP";
    case "application/pdf":
      return String.fromCharCode(...b.slice(0, 4)) === "%PDF";
  }
}

const uploadSchema = z.object({
  body: z.instanceof(Uint8Array).refine((b) => b.byteLength > 0, "The file is empty").refine((b) => b.byteLength <= MAX_UPLOAD_BYTES, "Files must be 5 MB or smaller"),
  contentType: z.enum(Object.keys(UPLOAD_TYPES) as [UploadContentType, ...UploadContentType[]], { message: "Upload a JPEG, PNG, WebP or PDF file" }),
});

function validateUpload(input: unknown) {
  const data = parseInput(uploadSchema, input);
  if (!sniff(data.body, data.contentType)) throw new ValidationError("The file content doesn't match its type", { fields: { body: "Invalid file" } });
  return data;
}

// ---------------------------------------------------------------------------
// Driver profile
// ---------------------------------------------------------------------------

const dateString = z.iso.date();
export const driverProfileSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120),
    phone: z.string().trim().regex(/^\+?[0-9 ()-]{5,32}$/, "Enter a valid phone number"),
    dateOfBirth: dateString,
    nationality: z.string().trim().min(2).max(56),
    licenceNumber: z.string().trim().min(3).max(40),
    licenceCountry: z.string().trim().min(2).max(56),
    licenceExpiry: dateString,
  })
  .superRefine((v, ctx) => {
    const dob = Date.parse(`${v.dateOfBirth}T00:00:00Z`);
    const exp = Date.parse(`${v.licenceExpiry}T00:00:00Z`);
    if (Number.isNaN(dob) || Number.isNaN(exp)) return;
    if (dob > Date.now() - 18 * 365.25 * 86_400_000) ctx.addIssue({ code: "custom", path: ["dateOfBirth"], message: "Drivers must be at least 18" });
    if (exp <= dob) ctx.addIssue({ code: "custom", path: ["licenceExpiry"], message: "Expiry must be after date of birth" });
  });
export type DriverProfileInput = z.input<typeof driverProfileSchema>;

/** Own profile, or any user's profile for admins. Null if none yet. */
export async function getDriverProfile(actorInput: Actor, userId?: string, opts: Opts = {}): Promise<DriverProfile | null> {
  const actor = parseActor(actorInput);
  const target = userId ? parseInput(z.uuid(), userId) : actor.userId;
  if (target !== actor.userId && !isAdmin(actor)) throw new NotFoundError("Driver profile");
  const [row] = await (opts.db ?? getDb()).select().from(driverProfiles).where(eq(driverProfiles.userId, target));
  return row ?? null;
}

export async function upsertDriverProfile(actorInput: Actor, input: DriverProfileInput, opts: Opts = {}): Promise<DriverProfile> {
  const actor = parseActor(actorInput);
  const data = parseInput(driverProfileSchema, input);
  const db = opts.db ?? getDb();
  const [row] = await db
    .insert(driverProfiles)
    .values({ userId: actor.userId, ...data })
    .onConflictDoUpdate({ target: driverProfiles.userId, set: data })
    .returning();
  await audit(db, { actorId: actor.userId, action: "driver_profile.saved", entityType: "driver_profile", entityId: row.id });
  return row;
}

/** Stores a licence image/PDF privately and links it to the actor's profile (replacing any previous file). */
export async function saveLicenceFile(
  actorInput: Actor,
  input: { body: Uint8Array; contentType: string },
  opts: Opts = {},
): Promise<DriverProfile> {
  const actor = parseActor(actorInput);
  const data = validateUpload(input);
  const db = opts.db ?? getDb();
  const storage = opts.storage ?? getFileStorage();
  const [profile] = await db.select().from(driverProfiles).where(eq(driverProfiles.userId, actor.userId));
  if (!profile) throw new DriverProfileIncompleteError("Save your driver details before uploading a licence");
  const key = `licences/${actor.userId}/${randomUUID()}.${UPLOAD_TYPES[data.contentType]}`;
  await storage.put(key, data.body, data.contentType);
  const [row] = await db
    .update(driverProfiles)
    .set({ licenceFileKey: key, licenceContentType: data.contentType, licenceUploadedAt: opts.now ?? new Date() })
    .where(eq(driverProfiles.userId, actor.userId))
    .returning();
  if (profile.licenceFileKey && profile.licenceFileKey !== key) {
    await storage.delete(profile.licenceFileKey).catch((error) => log.warn("licence.old_file_delete_failed", { error }));
  }
  await audit(db, { actorId: actor.userId, action: "driver_profile.licence_uploaded", entityType: "driver_profile", entityId: row.id });
  return row;
}

/** Admin: uploads a damage photo; pass the returned key in createDamageReport/updateDamageReport photoKeys. */
export async function uploadDamagePhoto(
  actorInput: Actor,
  input: { body: Uint8Array; contentType: string },
  opts: Opts = {},
): Promise<{ key: string; contentType: string }> {
  assertAdmin(actorInput);
  const data = validateUpload(input);
  const key = `damage/${randomUUID()}.${UPLOAD_TYPES[data.contentType]}`;
  await (opts.storage ?? getFileStorage()).put(key, data.body, data.contentType);
  return { key, contentType: data.contentType };
}

// ---------------------------------------------------------------------------
// File authorisation
// ---------------------------------------------------------------------------

const keySchema = z.string().min(3).max(300).regex(/^[A-Za-z0-9][A-Za-z0-9_\-./]*$/);

/**
 * Who owns a private file. Licences → the profile's user. Damage photos → the
 * customer of the linked reservation (or null = admin-only). Unknown keys → null.
 */
export async function getFileOwnership(
  key: string,
  opts: Opts = {},
): Promise<{ ownerUserId: string | null; kind: "licence" | "damage" } | null> {
  const parsed = keySchema.safeParse(key);
  if (!parsed.success || key.split("/").includes("..")) return null;
  const db = opts.db ?? getDb();
  if (key.startsWith("licences/")) {
    const [p] = await db.select({ userId: driverProfiles.userId }).from(driverProfiles).where(eq(driverProfiles.licenceFileKey, key));
    return p ? { ownerUserId: p.userId, kind: "licence" } : null;
  }
  if (key.startsWith("damage/")) {
    const [d] = await db
      .select({ userId: reservations.userId })
      .from(damageReports)
      .leftJoin(reservations, eq(reservations.id, damageReports.reservationId))
      .where(sql`${key} = any(${damageReports.photoKeys})`)
      .limit(1);
    return d ? { ownerUserId: d.userId ?? null, kind: "damage" } : null;
  }
  return null;
}

/**
 * Null unless the actor may read the file (owner or admin) and it exists.
 * Route handlers should answer 404 on null (never 403, to avoid existence leaks).
 */
export async function authorizeFileAccess(actorInput: Actor, key: string, opts: Opts = {}): Promise<{ contentType: string } | null> {
  let actor: Actor;
  try {
    actor = parseActor(actorInput);
  } catch {
    return null;
  }
  const owner = await getFileOwnership(key, opts);
  if (!owner) return null;
  if (!isAdmin(actor) && owner.ownerUserId !== actor.userId) return null;
  const storage = opts.storage ?? getFileStorage();
  if (!(await storage.exists(key))) return null;
  const ext = key.split(".").pop() ?? "";
  const contentType = (Object.entries(UPLOAD_TYPES).find(([, e]) => e === ext)?.[0] as string | undefined) ?? "application/octet-stream";
  return { contentType };
}
