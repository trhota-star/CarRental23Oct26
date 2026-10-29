import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminForm } from "@/components/admin/admin-form";
import { VehicleFields } from "@/components/admin/vehicle-fields";
import { Card, CardBody } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/feedback";
import { Container, PageHeader } from "@/components/ui/page";
import { requireAdmin } from "@/server/auth/session";
import { listBranches, listCategories, listFeatures } from "../../../_lib/server-api";
import { saveVehicleAction } from "../../actions";

export const metadata: Metadata = { title: "Add vehicle" };

export default function NewVehiclePage() {
  return (
    <Container className="py-8">
      <Link href="/admin/fleet" className="inline-flex items-center gap-1 text-sm font-medium text-ink-600 hover:text-ink-900">
        <ArrowLeft className="size-4" aria-hidden /> Fleet
      </Link>
      <PageHeader title="Add vehicle" className="mt-3" />
      <Suspense fallback={<PageSkeleton rows={1} />}>
        <NewVehicleForm />
      </Suspense>
    </Container>
  );
}

async function NewVehicleForm() {
  await requireAdmin("/admin/fleet/new");
  const [branches, categories, features] = await Promise.all([
    listBranches({ includeInactive: true }),
    listCategories(),
    listFeatures(),
  ]);
  return (
    <Card>
      <CardBody>
        <AdminForm action={saveVehicleAction} submitLabel="Add vehicle" pendingLabel="Adding…">
          <VehicleFields branches={branches} categories={categories} features={features} />
        </AdminForm>
      </CardBody>
    </Card>
  );
}
