import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminForm } from "@/components/admin/admin-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ListSkeleton } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { Container, PageHeader } from "@/components/ui/page";
import { filsToInput, formatAed } from "@/lib/format";
import { requireAdmin, toActor } from "@/server/auth/session";
import {
  listBranches,
  listCategories,
  listExtras,
  listPricingRules,
  type Branch,
  type Extra,
  type PricingRule,
  type VehicleCategory,
} from "../../_lib/server-api";
import { saveCategoryAction, saveExtraAction, savePricingRuleAction } from "../actions";

export const metadata: Metadata = { title: "Pricing & extras" };

const KINDS = [
  { value: "DAILY_RATE", label: "Daily rate", help: "Per day for a category. The rule with the highest min. days ≤ rental days wins." },
  { value: "ONE_WAY_FEE", label: "One-way fee", help: "Charged when the return branch differs. Most specific from/to wins." },
  { value: "VAT", label: "VAT", help: "Percentage applied to the subtotal." },
  { value: "DEPOSIT", label: "Security deposit", help: "Held on the card, per category (blank = default)." },
  { value: "LATE_RETURN", label: "Late return", help: "Per started hour after the grace period, capped at the daily rate." },
] as const;

export default function PricingPage() {
  return (
    <Container className="py-8">
      <PageHeader
        title="Pricing & extras"
        description="Amounts in AED. Changes apply to new quotes immediately; existing bookings keep their price."
      />
      <Suspense fallback={<ListSkeleton rows={8} />}>
        <PricingContent />
      </Suspense>
    </Container>
  );
}

async function PricingContent() {
  const user = await requireAdmin("/admin/pricing");
  const [rules, categories, branches, extras] = await Promise.all([
    listPricingRules(toActor(user)),
    listCategories(),
    listBranches({ includeInactive: true }),
    listExtras({ includeInactive: true }),
  ]);
  const catName = (id: string | null) => (id ? (categories.find((c) => c.id === id)?.name ?? "?") : "Any");
  const brName = (id: string | null) => (id ? (branches.find((b) => b.id === id)?.code ?? "?") : "Any");

  return (
    <div className="space-y-10">
      <section aria-labelledby="rules-title" className="space-y-4">
        <h2 id="rules-title" className="text-lg font-semibold text-ink-900">
          Pricing rules
        </h2>
        {KINDS.map((k) => {
          const list = rules.filter((r) => r.kind === k.value);
          return (
            <Card key={k.value}>
              <CardHeader>
                <CardTitle>{k.label}</CardTitle>
                <p className="text-sm text-ink-600">{k.help}</p>
              </CardHeader>
              <CardBody className="space-y-2">
                {list.length === 0 ? <p className="text-sm text-ink-600">No rules.</p> : null}
                {list.map((r) => (
                  <details key={r.id} className="group rounded-xl border border-ink-100">
                    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 text-sm [&::-webkit-details-marker]:hidden">
                      <span className="font-medium text-ink-900">{r.name}</span>
                      <span className="text-ink-600">{summary(r, catName, brName)}</span>
                      {!r.isActive ? <Badge>inactive</Badge> : null}
                      <span className="ml-auto font-medium text-ink-700 underline underline-offset-4 group-open:hidden">Edit</span>
                    </summary>
                    <div className="border-t border-ink-100 p-3">
                      <AdminForm action={savePricingRuleAction} hidden={{ id: r.id, kind: r.kind }} submitLabel="Save rule">
                        <RuleFields rule={r} kind={r.kind} categories={categories} branches={branches} prefix={`r-${r.id.slice(0, 8)}`} />
                      </AdminForm>
                    </div>
                  </details>
                ))}
              </CardBody>
            </Card>
          );
        })}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="size-5 text-gold-600" aria-hidden /> Add pricing rule
            </CardTitle>
          </CardHeader>
          <CardBody>
            <AdminForm action={savePricingRuleAction} submitLabel="Add rule" resetOnSuccess>
              <Field label="Kind" htmlFor="nr-kind">
                <Select id="nr-kind" name="kind" defaultValue="DAILY_RATE">
                  {KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <RuleFields categories={categories} branches={branches} prefix="nr" />
            </AdminForm>
          </CardBody>
        </Card>
      </section>

      <section aria-labelledby="extras-title" className="space-y-4">
        <h2 id="extras-title" className="text-lg font-semibold text-ink-900">
          Extras
        </h2>
        <Card>
          <CardBody className="space-y-2">
            {extras.map((x) => (
              <details key={x.id} className="group rounded-xl border border-ink-100">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 text-sm [&::-webkit-details-marker]:hidden">
                  <span className="font-medium text-ink-900">{x.name}</span>
                  <span className="text-ink-600">
                    {formatAed(x.priceFils)} {x.chargeType === "PER_DAY" ? "per day" : "per rental"} · max {x.maxQuantity}
                  </span>
                  {!x.isActive ? <Badge>inactive</Badge> : null}
                  <span className="ml-auto font-medium text-ink-700 underline underline-offset-4 group-open:hidden">Edit</span>
                </summary>
                <div className="border-t border-ink-100 p-3">
                  <AdminForm action={saveExtraAction} hidden={{ id: x.id }} submitLabel="Save extra">
                    <ExtraFields x={x} prefix={`x-${x.code}`} />
                  </AdminForm>
                </div>
              </details>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="size-5 text-gold-600" aria-hidden /> Add extra
            </CardTitle>
          </CardHeader>
          <CardBody>
            <AdminForm action={saveExtraAction} submitLabel="Add extra" resetOnSuccess>
              <ExtraFields prefix="x-new" />
            </AdminForm>
          </CardBody>
        </Card>
      </section>

      <section aria-labelledby="cats-title" className="space-y-4">
        <h2 id="cats-title" className="text-lg font-semibold text-ink-900">
          Vehicle categories
        </h2>
        <Card>
          <CardBody className="space-y-2">
            {categories.map((c) => (
              <details key={c.id} className="group rounded-xl border border-ink-100">
                <summary className="flex cursor-pointer list-none items-center gap-4 px-3 py-2.5 text-sm [&::-webkit-details-marker]:hidden">
                  <span className="font-mono text-xs">{c.code}</span>
                  <span className="font-medium text-ink-900">{c.name}</span>
                  <span className="ml-auto font-medium text-ink-700 underline underline-offset-4 group-open:hidden">Edit</span>
                </summary>
                <div className="border-t border-ink-100 p-3">
                  <AdminForm action={saveCategoryAction} hidden={{ id: c.id }} submitLabel="Save category">
                    <CategoryFields c={c} prefix={`c-${c.code}`} />
                  </AdminForm>
                </div>
              </details>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="size-5 text-gold-600" aria-hidden /> Add category
            </CardTitle>
          </CardHeader>
          <CardBody>
            <AdminForm action={saveCategoryAction} submitLabel="Add category" resetOnSuccess>
              <CategoryFields prefix="c-new" />
            </AdminForm>
          </CardBody>
        </Card>
      </section>
    </div>
  );
}

function summary(r: PricingRule, cat: (id: string | null) => string, br: (id: string | null) => string): string {
  switch (r.kind) {
    case "DAILY_RATE":
      return `${cat(r.categoryId)} · ${r.minDays}+ days · ${formatAed(r.amountFils ?? 0)}/day`;
    case "ONE_WAY_FEE":
      return `${br(r.fromBranchId)} → ${br(r.toBranchId)} · ${formatAed(r.amountFils ?? 0)}`;
    case "VAT":
      return `${(r.rateBps ?? 0) / 100}%`;
    case "DEPOSIT":
      return `${cat(r.categoryId)} · ${formatAed(r.amountFils ?? 0)}`;
    case "LATE_RETURN":
      return `${cat(r.categoryId)} · ${formatAed(r.amountFils ?? 0)}/hour after ${r.graceMinutes} min`;
    default:
      return "";
  }
}

function RuleFields({
  rule,
  kind,
  categories,
  branches,
  prefix,
}: {
  rule?: PricingRule;
  kind?: PricingRule["kind"];
  categories: VehicleCategory[];
  branches: Branch[];
  prefix: string;
}) {
  const show = (k: PricingRule["kind"][]) => !kind || k.includes(kind);
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Name" htmlFor={`${prefix}-name`}>
        <Input id={`${prefix}-name`} name="name" required maxLength={120} defaultValue={rule?.name} />
      </Field>
      {show(["DAILY_RATE", "DEPOSIT", "LATE_RETURN"]) ? (
        <Field label="Category" htmlFor={`${prefix}-cat`} hint={kind === "DAILY_RATE" ? undefined : "Blank = all categories"}>
          <Select id={`${prefix}-cat`} name="categoryId" defaultValue={rule?.categoryId ?? ""}>
            <option value="">Any / default</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {show(["ONE_WAY_FEE"]) ? (
        <>
          <Field label="From branch" htmlFor={`${prefix}-from`}>
            <Select id={`${prefix}-from`} name="fromBranchId" defaultValue={rule?.fromBranchId ?? ""}>
              <option value="">Any</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="To branch" htmlFor={`${prefix}-to`}>
            <Select id={`${prefix}-to`} name="toBranchId" defaultValue={rule?.toBranchId ?? ""}>
              <option value="">Any</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code}
                </option>
              ))}
            </Select>
          </Field>
        </>
      ) : null}
      {show(["DAILY_RATE"]) ? (
        <Field label="Minimum days" htmlFor={`${prefix}-min`}>
          <Input id={`${prefix}-min`} name="minDays" type="number" min={1} max={365} defaultValue={rule?.minDays ?? 1} />
        </Field>
      ) : null}
      {show(["DAILY_RATE", "ONE_WAY_FEE", "DEPOSIT", "LATE_RETURN"]) ? (
        <Field label={kind === "LATE_RETURN" ? "Amount per hour (AED)" : "Amount (AED)"} htmlFor={`${prefix}-amt`}>
          <Input id={`${prefix}-amt`} name="amount" inputMode="decimal" defaultValue={rule?.amountFils != null ? filsToInput(rule.amountFils) : ""} placeholder="0.00" />
        </Field>
      ) : null}
      {show(["VAT"]) ? (
        <Field label="Rate (%)" htmlFor={`${prefix}-rate`}>
          <Input id={`${prefix}-rate`} name="ratePercent" inputMode="decimal" defaultValue={rule?.rateBps != null ? String(rule.rateBps / 100) : ""} placeholder="5" />
        </Field>
      ) : null}
      {show(["LATE_RETURN"]) ? (
        <Field label="Grace (minutes)" htmlFor={`${prefix}-grace`}>
          <Input id={`${prefix}-grace`} name="graceMinutes" type="number" min={0} max={1440} defaultValue={rule?.graceMinutes ?? 0} />
        </Field>
      ) : null}
      <Field label="Priority" htmlFor={`${prefix}-prio`} hint="Higher wins on ties.">
        <Input id={`${prefix}-prio`} name="priority" type="number" min={-1000} max={1000} defaultValue={rule?.priority ?? 0} />
      </Field>
      <label className="flex items-center gap-2 self-end pb-3 text-sm text-ink-800">
        <Checkbox name="isActive" defaultChecked={rule ? rule.isActive : true} /> Active
      </label>
    </div>
  );
}

function ExtraFields({ x, prefix }: { x?: Extra; prefix: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Code" htmlFor={`${prefix}-code`}>
        <Input id={`${prefix}-code`} name="code" required maxLength={30} defaultValue={x?.code} className="uppercase" />
      </Field>
      <Field label="Name" htmlFor={`${prefix}-name`}>
        <Input id={`${prefix}-name`} name="name" required maxLength={80} defaultValue={x?.name} />
      </Field>
      <Field label="Description" htmlFor={`${prefix}-desc`} optional>
        <Input id={`${prefix}-desc`} name="description" maxLength={300} defaultValue={x?.description ?? ""} />
      </Field>
      <Field label="Charged" htmlFor={`${prefix}-type`}>
        <Select id={`${prefix}-type`} name="chargeType" defaultValue={x?.chargeType ?? "PER_DAY"}>
          <option value="PER_DAY">Per day</option>
          <option value="PER_RENTAL">Per rental</option>
        </Select>
      </Field>
      <Field label="Price (AED)" htmlFor={`${prefix}-price`}>
        <Input id={`${prefix}-price`} name="price" inputMode="decimal" required defaultValue={x ? filsToInput(x.priceFils) : ""} placeholder="0.00" />
      </Field>
      <Field label="Max quantity" htmlFor={`${prefix}-max`}>
        <Input id={`${prefix}-max`} name="maxQuantity" type="number" min={1} max={10} defaultValue={x?.maxQuantity ?? 1} />
      </Field>
      <label className="flex items-center gap-2 text-sm text-ink-800">
        <Checkbox name="isActive" defaultChecked={x ? x.isActive : true} /> Offered to customers
      </label>
    </div>
  );
}

function CategoryFields({ c, prefix }: { c?: VehicleCategory; prefix: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Code" htmlFor={`${prefix}-code`}>
        <Input id={`${prefix}-code`} name="code" required maxLength={20} defaultValue={c?.code} className="uppercase" />
      </Field>
      <Field label="Name" htmlFor={`${prefix}-name`}>
        <Input id={`${prefix}-name`} name="name" required maxLength={80} defaultValue={c?.name} />
      </Field>
      <Field label="Description" htmlFor={`${prefix}-desc`} optional>
        <Input id={`${prefix}-desc`} name="description" maxLength={500} defaultValue={c?.description ?? ""} />
      </Field>
      <Field label="Sort order" htmlFor={`${prefix}-sort`}>
        <Input id={`${prefix}-sort`} name="sortOrder" type="number" min={0} max={1000} defaultValue={c?.sortOrder ?? 0} />
      </Field>
    </div>
  );
}
