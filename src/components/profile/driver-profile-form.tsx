"use client";

import { FileCheck2, Upload } from "lucide-react";
import { useActionState } from "react";
import type { ActionState } from "@/app/_lib/action-result";
import { saveDriverProfileAction, type ProfileField } from "@/app/profile/actions";
import { Alert } from "@/components/ui/feedback";
import { describedBy, Field, Input } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";

export type DriverProfileValues = {
  fullName: string;
  phone: string;
  dateOfBirth: string;
  nationality: string;
  licenceNumber: string;
  licenceCountry: string;
  licenceExpiry: string;
  hasLicence: boolean;
  licenceUploadedLabel?: string | null;
  /** Authorised URL for the owner to view their licence (served by /files). */
  licenceUrl?: string | null;
};

export function DriverProfileForm({
  initial,
  submitLabel = "Save driver details",
}: {
  initial: Partial<DriverProfileValues>;
  submitLabel?: string;
}) {
  const [state, action, pending] = useActionState<ActionState<ProfileField>, FormData>(saveDriverProfileAction, {});
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-5" noValidate>
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.ok && state.message ? <Alert tone="success">{state.message}</Alert> : null}
      <input type="hidden" name="hasLicence" value={initial.hasLicence ? "1" : "0"} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name (as on licence)" htmlFor="fullName" error={fe.fullName} className="sm:col-span-2">
          <Input
            {...describedBy("fullName", fe.fullName)}
            name="fullName"
            autoComplete="name"
            defaultValue={initial.fullName}
            required
          />
        </Field>
        <Field label="Mobile number" htmlFor="phone" error={fe.phone}>
          <Input
            {...describedBy("phone", fe.phone)}
            name="phone"
            type="tel"
            autoComplete="tel"
            placeholder="+971 50 123 4567"
            defaultValue={initial.phone}
            required
          />
        </Field>
        <Field label="Date of birth" htmlFor="dateOfBirth" error={fe.dateOfBirth} hint="Drivers must be 21 or older.">
          <Input
            {...describedBy("dateOfBirth", fe.dateOfBirth, true)}
            name="dateOfBirth"
            type="date"
            autoComplete="bday"
            defaultValue={initial.dateOfBirth}
            required
          />
        </Field>
        <Field label="Nationality" htmlFor="nationality" error={fe.nationality}>
          <Input
            {...describedBy("nationality", fe.nationality)}
            name="nationality"
            defaultValue={initial.nationality}
            required
          />
        </Field>
        <Field label="Licence number" htmlFor="licenceNumber" error={fe.licenceNumber}>
          <Input
            {...describedBy("licenceNumber", fe.licenceNumber)}
            name="licenceNumber"
            defaultValue={initial.licenceNumber}
            required
          />
        </Field>
        <Field label="Licence issuing country" htmlFor="licenceCountry" error={fe.licenceCountry}>
          <Input
            {...describedBy("licenceCountry", fe.licenceCountry)}
            name="licenceCountry"
            defaultValue={initial.licenceCountry}
            required
          />
        </Field>
        <Field
          label="Licence expiry date"
          htmlFor="licenceExpiry"
          error={fe.licenceExpiry}
          hint="Must be valid until your return date."
        >
          <Input
            {...describedBy("licenceExpiry", fe.licenceExpiry, true)}
            name="licenceExpiry"
            type="date"
            defaultValue={initial.licenceExpiry}
            required
          />
        </Field>
      </div>
      <Field
        label={initial.hasLicence ? "Replace licence photo" : "Licence photo"}
        htmlFor="licenceFile"
        error={fe.licenceFile}
        optional={initial.hasLicence}
        hint="JPEG, PNG or WebP, up to 5 MB. Stored privately: only you and DriveEasy staff can view it."
      >
        {initial.hasLicence ? (
          <p className="mb-2 flex flex-wrap items-center gap-2 rounded-xl bg-success-50 px-3 py-2 text-sm text-success-700">
            <FileCheck2 className="size-4" aria-hidden />
            Licence on file{initial.licenceUploadedLabel ? ` (uploaded ${initial.licenceUploadedLabel})` : ""}.
            {initial.licenceUrl ? (
              <a href={initial.licenceUrl} target="_blank" rel="noreferrer" className="font-semibold underline">
                View
              </a>
            ) : null}
          </p>
        ) : null}
        <div className="flex items-center gap-3 rounded-xl border border-dashed border-ink-300 bg-ink-50 px-3 py-3">
          <Upload className="size-5 shrink-0 text-ink-500" aria-hidden />
          <input
            {...describedBy("licenceFile", fe.licenceFile, true)}
            name="licenceFile"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            required={!initial.hasLicence}
            className="block w-full text-sm text-ink-700 file:mr-3 file:rounded-lg file:border-0 file:bg-ink-900 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-ink-800"
          />
        </div>
      </Field>
      <SubmitButton pending={pending} pendingLabel="Saving…" size="lg">
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
