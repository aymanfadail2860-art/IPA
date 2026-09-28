import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * LoadingState — skeletons shaped like the coming content. No spinners for page content
 * (§3.7). Shimmer is disabled by the global reduced-motion rule.
 */
export function LoadingState({
  variant = "page",
  label = "Indlæser indhold",
  className,
}: {
  variant?: "page" | "cards" | "list";
  label?: string;
  className?: string;
}) {
  return (
    <div role="status" aria-live="polite" className={cn("space-y-6", className)}>
      <span className="sr-only">{label}</span>
      {variant === "page" ? (
        <div className="space-y-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-9 w-80 max-w-full" />
          <Skeleton className="h-4 w-full max-w-xl" />
        </div>
      ) : null}
      {variant !== "list" ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="space-y-3 rounded-lg border border-border-subtle bg-surface-raised p-6">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-2 w-full" />
            </div>
          ))}
        </div>
      ) : null}
      {variant === "list" ? (
        <div className="divide-y divide-border-subtle rounded-lg border border-border-subtle bg-surface-raised">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="flex items-center gap-4 p-4">
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
