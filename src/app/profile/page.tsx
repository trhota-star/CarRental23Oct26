import { IdCard, UserRound } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { DriverProfileForm } from "@/components/profile/driver-profile-form";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, PageSkeleton } from "@/components/ui/feedback";
import { Container, DescriptionList, PageHeader } from "@/components/ui/page";
import { first } from "@/lib/search-params";
import { requireUser } from "@/server/auth/session";
import { loadDriverProfileForm } from "../_lib/profile";

export const metadata: Metadata = { title: "Profile" };

export default function ProfilePage(props: PageProps<"/profile">) {
  return (
    <Container className="py-8 sm:py-12">
      <PageHeader eyebrow="Your account" title="Profile & licence" />
      <Suspense fallback={<PageSkeleton rows={1} label="Loading profile" />}>
        <ProfileContent {...props} />
      </Suspense>
    </Container>
  );
}

async function ProfileContent({ searchParams }: PageProps<"/profile">) {
  const sp = await searchParams;
  const user = await requireUser("/profile");
  const profile = await loadDriverProfileForm(user);
  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
      <Card className="self-start">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserRound className="size-5 text-gold-600" aria-hidden /> Account
          </CardTitle>
        </CardHeader>
        <CardBody>
          <DescriptionList
            items={[
              { term: "Name", detail: user.name },
              { term: "Email", detail: user.email },
              { term: "Account type", detail: user.role === "admin" ? "Administrator" : "Customer" },
            ]}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <IdCard className="size-5 text-gold-600" aria-hidden /> Driver details
          </CardTitle>
          <p className="text-sm text-ink-600">Required before your first pick-up. Saved for future bookings.</p>
        </CardHeader>
        <CardBody className="space-y-4">
          {first(sp.welcome) === "1" ? (
            <Alert tone="success" title="Welcome to DriveEasy!">
              Add your driver details now to make checkout faster, or do it when you book.
            </Alert>
          ) : null}
          {!profile.complete ? (
            <Alert tone="info">You haven&apos;t added your licence yet.</Alert>
          ) : null}
          <DriverProfileForm initial={profile.values} />
        </CardBody>
      </Card>
    </div>
  );
}
