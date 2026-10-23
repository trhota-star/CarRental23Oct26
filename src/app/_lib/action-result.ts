import "server-only";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { isDomainError, type DomainErrorCode } from "@/server/errors";
import { log } from "@/server/log";

/** Uniform result for form actions used with useActionState. */
export type ActionState<F extends string = string> = {
  ok?: boolean;
  message?: string;
  error?: string;
  code?: DomainErrorCode | "INTERNAL";
  fieldErrors?: Partial<Record<F, string[]>>;
};

export function fieldErrorsOf<F extends string>(error: z.ZodError): Partial<Record<F, string[]>> {
  return z.flattenError(error).fieldErrors as Partial<Record<F, string[]>>;
}

/**
 * Turns a thrown error into an ActionState. Domain errors carry safe messages;
 * anything else is logged and replaced with a generic message. Next.js control
 * flow (redirect/notFound) is re-thrown.
 */
export function actionError(event: string, error: unknown): ActionState {
  unstable_rethrow(error);
  if (isDomainError(error)) {
    return { error: error.message, code: error.code };
  }
  log.error(event, { error });
  return { error: "Something went wrong on our side. Please try again.", code: "INTERNAL" };
}

export function formString(form: FormData, key: string): string | undefined {
  const v = form.get(key);
  return typeof v === "string" ? v : undefined;
}

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;

/** Reads and checks an uploaded image (type allow-list, magic bytes, 5 MB cap). */
export async function readImageUpload(
  file: FormDataEntryValue | null,
  { required }: { required: boolean },
): Promise<{ ok: true; body: Uint8Array; contentType: string } | { ok: false; error: string } | { ok: true; body: null }> {
  if (!(file instanceof File) || file.size === 0) {
    return required ? { ok: false, error: "Choose a photo to upload." } : { ok: true, body: null };
  }
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: "Photos must be 5 MB or smaller." };
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, error: "Upload a JPEG, PNG, WebP or HEIC image." };
  }
  const body = new Uint8Array(await file.arrayBuffer());
  if (!looksLikeImage(body, file.type)) return { ok: false, error: "That file doesn't look like a valid image." };
  return { ok: true, body, contentType: file.type };
}

function looksLikeImage(b: Uint8Array, type: string): boolean {
  if (b.length < 12) return false;
  switch (type) {
    case "image/jpeg":
      return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case "image/png":
      return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    case "image/webp":
      return String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP";
    case "image/heic":
    case "image/heif":
      return String.fromCharCode(...b.slice(4, 8)) === "ftyp";
    default:
      return false;
  }
}
