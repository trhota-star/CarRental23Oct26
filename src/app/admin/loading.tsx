import { ListSkeleton, Skeleton } from "@/components/ui/feedback";
import { Container } from "@/components/ui/page";

export default function Loading() {
  return (
    <Container className="py-8">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="mt-3 mb-8 h-4 w-72" />
      <ListSkeleton rows={6} />
    </Container>
  );
}
