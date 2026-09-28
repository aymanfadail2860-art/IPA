import { SearchX } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * InsufficientEvidence — the "no documentation" answer. Designed as a competent answer,
 * not as an error: it must never look like ErrorState (docs/04-ui-ux-design.md §16).
 * It contains no professional claims, and offers ways forward.
 */
export function InsufficientEvidence({
  title = "Der findes ikke tilstrækkelig dokumentation",
  children,
  actions,
  className,
}: {
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label="Utilstrækkeligt grundlag"
      className={cn(
        "rounded-lg border border-l-4 border-border-subtle border-l-knowledge-insufficient bg-knowledge-insufficient-subtle p-5",
        className,
      )}
    >
      <p className="mb-2 flex items-center gap-2 text-label font-semibold text-knowledge-insufficient">
        <SearchX className="size-4" aria-hidden />
        Utilstrækkeligt grundlag
      </p>
      <h3 className="text-heading-3 text-fg-primary">{title}</h3>
      <div className="mt-2 space-y-2 text-body text-fg-secondary">{children}</div>
      {actions ? <div className="mt-4 flex flex-wrap gap-2">{actions}</div> : null}
    </section>
  );
}
