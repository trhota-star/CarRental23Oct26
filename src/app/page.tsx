import { BadgeCheck, CalendarCheck2, CarFront, Clock3, KeyRound, MapPin, ShieldCheck, Wallet } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { SearchForm } from "@/components/search/search-form";
import { CarArt } from "@/components/vehicle/car-art";
import { EmptyState, Skeleton } from "@/components/ui/feedback";
import { Container } from "@/components/ui/page";
import { defaultSearchDates, toQueryString } from "@/lib/search-params";
import { getActiveBranches, getCategories } from "./_lib/catalog";

export default function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden bg-ink-950 text-white">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(220,174,79,0.28),transparent_55%),radial-gradient(ellipse_at_bottom_left,rgba(56,85,123,0.55),transparent_60%)]"
        />
        <Container className="relative pt-12 pb-10 sm:pt-20 sm:pb-14">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-gold-300">
            <BadgeCheck className="size-3.5" aria-hidden /> Dubai · Abu Dhabi · Sharjah
          </p>
          <h1 className="mt-5 max-w-3xl font-display text-4xl leading-tight font-semibold tracking-tight sm:text-5xl lg:text-6xl">
            The easy way to rent a <span className="text-gold-300">premium car</span> in the UAE.
          </h1>
          <p className="mt-4 max-w-2xl text-base text-ink-200 sm:text-lg">
            Transparent AED pricing with VAT shown up front, a refundable deposit, and pick-up in minutes.
          </p>
          <div className="mt-8 rounded-card bg-white p-4 text-ink-900 shadow-lift sm:p-6">
            <Suspense fallback={<SearchFormSkeleton />}>
              <HeroSearch />
            </Suspense>
          </div>
        </Container>
      </section>

      <section className="py-14 sm:py-20" aria-labelledby="categories-title">
        <Container>
          <SectionHeading
            id="categories-title"
            eyebrow="Our fleet"
            title="A car for every trip"
            description="From city runabouts to seven-seat SUVs for the desert road."
          />
          <Suspense fallback={<CardsSkeleton count={4} />}>
            <Categories />
          </Suspense>
        </Container>
      </section>

      <section className="bg-white py-14 sm:py-20" aria-labelledby="how-title">
        <Container>
          <SectionHeading id="how-title" eyebrow="How it works" title="Booked in four steps" />
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((s, i) => (
              <li key={s.title} className="rounded-card border border-ink-100 bg-sand-50 p-5">
                <span className="flex size-10 items-center justify-center rounded-xl bg-ink-900 text-gold-300">
                  <s.icon className="size-5" aria-hidden />
                </span>
                <p className="mt-4 text-xs font-semibold tracking-wide text-gold-700 uppercase">Step {i + 1}</p>
                <h3 className="mt-1 font-semibold text-ink-900">{s.title}</h3>
                <p className="mt-1 text-sm text-ink-600">{s.text}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      <section className="py-14 sm:py-20" aria-labelledby="branches-title">
        <Container>
          <SectionHeading
            id="branches-title"
            eyebrow="Branches"
            title="Pick up where it suits you"
            description="Return to the same branch, or drop off elsewhere for a one-way fee shown before you pay."
          />
          <Suspense fallback={<CardsSkeleton count={3} />}>
            <Branches />
          </Suspense>
        </Container>
      </section>

      <section className="bg-ink-50 py-12" aria-label="Why DriveEasy">
        <Container className="grid gap-6 sm:grid-cols-3">
          {promises.map((p) => (
            <div key={p.title} className="flex gap-3">
              <p.icon className="mt-0.5 size-5 shrink-0 text-gold-600" aria-hidden />
              <div>
                <h3 className="font-semibold text-ink-900">{p.title}</h3>
                <p className="text-sm text-ink-600">{p.text}</p>
              </div>
            </div>
          ))}
        </Container>
      </section>
    </>
  );
}

const steps = [
  { icon: MapPin, title: "Choose branch & dates", text: "Pick-up and return times are in the branch's local time." },
  { icon: CarFront, title: "Pick your car", text: "Filter by category, gearbox, seats, fuel and price." },
  { icon: Wallet, title: "Add extras & pay", text: "See every fee, VAT and the deposit before you pay." },
  { icon: KeyRound, title: "Show your voucher", text: "Your reference and QR code get you on the road fast." },
];

const promises = [
  { icon: ShieldCheck, title: "No hidden fees", text: "Daily rate, extras, one-way fee and 5% VAT itemised." },
  { icon: CalendarCheck2, title: "Flexible bookings", text: "Change dates or cancel from My rentals, per our policy." },
  { icon: Clock3, title: "Fast pick-up", text: "Upload your licence once and skip the paperwork at the desk." },
];

async function HeroSearch() {
  await connection();
  const branches = await getActiveBranches();
  if (branches.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-ink-600">
        Online booking opens as soon as our branches are listed. Please check back shortly.
      </p>
    );
  }
  const dates = defaultSearchDates(new Date(), branches[0]?.timezone);
  return (
    <SearchForm
      branches={branches.map((b) => ({ id: b.id, name: b.name, city: b.city }))}
      defaults={{ ...dates, pickupBranchId: branches[0]?.id }}
    />
  );
}

async function Categories() {
  await connection();
  const categories = await getCategories();
  if (categories.length === 0) {
    return <EmptyState icon={CarFront} title="Our fleet is being prepared" description="Vehicle categories will appear here soon." />;
  }
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {categories.map((c) => (
        <li key={c.id}>
          <Link
            href={`/search?${toQueryString({ category: c.id })}`}
            className="group block overflow-hidden rounded-card border border-ink-100 bg-white shadow-card transition-shadow hover:shadow-lift"
          >
            <CarArt category={c.name} className="aspect-[16/9]" color={categoryColor(c.code)} />
            <div className="p-4">
              <h3 className="font-semibold text-ink-900 group-hover:underline">{c.name}</h3>
              {c.description ? <p className="mt-1 line-clamp-2 text-sm text-ink-600">{c.description}</p> : null}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function categoryColor(code: string) {
  const colors = ["White", "Silver", "Black", "Blue", "Pearl", "Grey"];
  let h = 0;
  for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return colors[h % colors.length];
}

async function Branches() {
  await connection();
  const branches = await getActiveBranches();
  if (branches.length === 0) {
    return <EmptyState icon={MapPin} title="No branches listed yet" description="Our locations will appear here soon." />;
  }
  return (
    <>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {branches.map((b) => (
          <li key={b.id} className="rounded-card border border-ink-100 bg-white p-5 shadow-card">
            <p className="text-xs font-semibold tracking-wide text-gold-700 uppercase">{b.city}</p>
            <h3 className="mt-1 font-semibold text-ink-900">{b.name}</h3>
            <p className="mt-1 text-sm text-ink-600">{b.address}</p>
            {b.openingHours ? (
              <p className="mt-3 flex items-center gap-1.5 text-sm text-ink-700">
                <Clock3 className="size-4 text-ink-400" aria-hidden /> {b.openingHours}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="mt-6">
        <Link href="/branches" className="text-sm font-semibold text-ink-900 underline underline-offset-4">
          View all branches
        </Link>
      </p>
    </>
  );
}

function SectionHeading({
  id,
  eyebrow,
  title,
  description,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-8 max-w-2xl">
      <p className="text-xs font-semibold tracking-[0.14em] text-gold-700 uppercase">{eyebrow}</p>
      <h2 id={id} className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">
        {title}
      </h2>
      {description ? <p className="mt-2 text-ink-600">{description}</p> : null}
    </div>
  );
}

function SearchFormSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-[1.5fr_1fr_0.75fr_1fr_0.75fr_auto]" role="status">
      <span className="sr-only">Loading search…</span>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-11 w-full" />
        </div>
      ))}
    </div>
  );
}

function CardsSkeleton({ count }: { count: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" role="status">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-card border border-ink-100 bg-white p-4">
          <Skeleton className="aspect-[16/9] w-full" />
          <Skeleton className="mt-4 h-5 w-2/3" />
          <Skeleton className="mt-2 h-4 w-full" />
        </div>
      ))}
    </div>
  );
}
