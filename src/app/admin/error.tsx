"use client";

import { RotateCcw } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";

export default function AdminError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-16">
      <Alert tone="danger" title="This admin page failed to load">
        Please retry. If it keeps failing, check the server logs
        {error instanceof Error && "digest" in error ? ` (reference ${String(error.digest)})` : ""}.
      </Alert>
      <Button className="mt-4" onClick={() => retry()}>
        <RotateCcw className="size-4" aria-hidden /> Retry
      </Button>
    </div>
  );
}
