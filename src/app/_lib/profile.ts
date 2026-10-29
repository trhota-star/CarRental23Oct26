import "server-only";
import type { DriverProfileValues } from "@/components/profile/driver-profile-form";
import { formatDate } from "@/lib/format";
import type { CurrentUser } from "@/server/auth/session";
import { toActor } from "@/server/auth/session";
import { getDriverProfile } from "./server-api";

/** URL of the authorised file route for a private storage key. */
export function fileUrl(key: string): string {
  return `/files/${key.split("/").map(encodeURIComponent).join("/")}`;
}

/** The signed-in user's driver profile mapped to form values, plus readiness. */
export async function loadDriverProfileForm(
  user: CurrentUser,
): Promise<{ values: Partial<DriverProfileValues>; complete: boolean }> {
  const p = await getDriverProfile(toActor(user));
  if (!p) return { values: { fullName: user.name, hasLicence: false }, complete: false };
  return {
    values: {
      fullName: p.fullName,
      phone: p.phone,
      dateOfBirth: p.dateOfBirth,
      nationality: p.nationality,
      licenceNumber: p.licenceNumber,
      licenceCountry: p.licenceCountry,
      licenceExpiry: p.licenceExpiry,
      hasLicence: Boolean(p.licenceFileKey),
      licenceUploadedLabel: p.licenceUploadedAt ? formatDate(p.licenceUploadedAt) : null,
      licenceUrl: p.licenceFileKey ? fileUrl(p.licenceFileKey) : null,
    },
    complete: Boolean(p.licenceFileKey),
  };
}
