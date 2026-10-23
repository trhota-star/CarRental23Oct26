import { MapPinOff } from "lucide-react";
import { LinkButton } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center px-4 py-20 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-gold-50 text-gold-700">
        <MapPinOff className="size-7" aria-hidden />
      </span>
      <p className="mt-5 text-xs font-semibold tracking-[0.14em] text-gold-700 uppercase">Error 404</p>
      <h1 className="mt-1 font-display text-2xl font-semibold text-ink-900">We can&apos;t find that page</h1>
      <p className="mt-2 text-sm text-ink-600">
        The link may be wrong, or you may not have access to it.
      </p>
      <div className="mt-6 flex gap-3">
        <LinkButton href="/search">Find a car</LinkButton>
        <LinkButton href="/" variant="secondary">
          Go home
        </LinkButton>
      </div>
    </div>
  );
}
