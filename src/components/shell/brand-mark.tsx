import { cn } from "@/lib/utils";

/** Insurance Partners word mark — the product's own identity, not an insurer's brand. */
export function BrandMark({ collapsed = false, className }: { collapsed?: boolean; className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <span
        aria-hidden
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-brand text-label font-bold tracking-tight text-fg-inverse"
      >
        IP
      </span>
      <span className={cn("leading-tight", collapsed && "sr-only")}>
        <span className="block text-label font-semibold text-fg-primary">Insurance Partners</span>
      </span>
    </span>
  );
}
