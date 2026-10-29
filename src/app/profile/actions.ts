"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { actionError, fieldErrorsOf, formString, readImageUpload, type ActionState } from "@/app/_lib/action-result";
import { saveLicenceFile, upsertDriverProfile } from "@/app/_lib/server-api";
import { getCurrentUser, toActor } from "@/server/auth/session";

export type ProfileField =
  | "fullName"
  | "phone"
  | "dateOfBirth"
  | "nationality"
  | "licenceNumber"
  | "licenceCountry"
  | "licenceExpiry"
  | "licenceFile";

const dateField = (label: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `Enter your ${label}.`);

const schema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name as on your licence.").max(120),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a phone number, e.g. +971 50 123 4567."),
  dateOfBirth: dateField("date of birth"),
  nationality: z.string().trim().min(2, "Enter your nationality.").max(60),
  licenceNumber: z.string().trim().min(3, "Enter your licence number.").max(40),
  licenceCountry: z.string().trim().min(2, "Enter the issuing country.").max(60),
  licenceExpiry: dateField("licence expiry date"),
});

/**
 * Saves driver details and, optionally, a new licence photo. A photo is
 * required when none is on file; the DB layer also enforces readiness
 * (profile + licence + age + expiry) before any payment.
 */
export async function saveDriverProfileAction(
  _prev: ActionState<ProfileField>,
  form: FormData,
): Promise<ActionState<ProfileField>> {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/profile");

  const parsed = schema.safeParse({
    fullName: formString(form, "fullName"),
    phone: formString(form, "phone"),
    dateOfBirth: formString(form, "dateOfBirth"),
    nationality: formString(form, "nationality"),
    licenceNumber: formString(form, "licenceNumber"),
    licenceCountry: formString(form, "licenceCountry"),
    licenceExpiry: formString(form, "licenceExpiry"),
  });
  const upload = await readImageUpload(form.get("licenceFile"), {
    required: formString(form, "hasLicence") !== "1",
  });
  if (!parsed.success || !upload.ok) {
    return {
      error: "Please check the highlighted fields.",
      fieldErrors: {
        ...(parsed.success ? {} : fieldErrorsOf<ProfileField>(parsed.error)),
        ...(upload.ok ? {} : { licenceFile: [upload.error] }),
      },
    };
  }
  try {
    const actor = toActor(user);
    await upsertDriverProfile(actor, parsed.data);
    if (upload.body) await saveLicenceFile(actor, { body: upload.body, contentType: upload.contentType });
  } catch (error) {
    return actionError("app.profile.save_failed", error) as ActionState<ProfileField>;
  }
  refresh();
  return { ok: true, message: "Driver details saved." };
}
