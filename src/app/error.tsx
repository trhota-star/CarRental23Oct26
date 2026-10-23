"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { Button, LinkButton } from "@/components/ui/button";

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const digest = error instanceof Error && "digest" in error ? String(error.digest) : undefined;
  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center px-4 py-20 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-danger-50 text-danger-700">
        <TriangleAlert className="size-7" aria-hidden />
      </span>
      <h1 className="mt-5 font-display text-2xl font-semibold text-ink-900">Something went wrong</h1>
      <p className="mt-2 text-sm text-ink-600">
        We couldn&apos;t load this page. Nothing was charged. Please try again in a moment.
      </p>
      {digest ? <p className="mt-2 font-mono text-xs text-ink-400">Reference: {digest}</p> : null}
      <div className="mt-6 flex gap-3">
        <Button onClick={() => retry()}>
          <RotateCcw className="size-4" aria-hidden /> Try again
        </Button>
        <LinkButton href="/" variant="secondary">
          Go home
        </LinkButton>
      </div>
    </div>
  );
}
