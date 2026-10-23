import { Skeleton } from "@/components/ui/feedback";

export default function Loading() {
  return (
    <div className="flex flex-1 justify-center px-4 py-12 sm:py-20" role="status">
      <span className="sr-only">Loading…</span>
      <div className="w-full max-w-md space-y-4 rounded-card border border-ink-100 bg-white p-8">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  );
}
