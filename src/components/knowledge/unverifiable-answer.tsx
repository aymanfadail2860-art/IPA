import { FileSearch } from "lucide-react";
import type { ReactNode } from "react";

import { UNVERIFIABLE_BODY, UNVERIFIABLE_TITLE } from "@/lib/ai/outcome";
import { cn } from "@/lib/utils";

/**
 * UnverifiableAnswer — the fourth state (B-016, docs/08 §4.4): sources were found, but the
 * model's answer could not be checked against them, so it is NEVER shown — not even with a
 * warning. Not "insufficient documentation" (the documentation existed) and not a system
 * failure (the system worked). It has its own wording and look: a neutral frame, the
 * file-search icon, no model text, no grounding line — and the sources, so the user can read
 * them.
 */
export function UnverifiableAnswer({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <section aria-label="Svaret kan ikke dokumenteres" className={cn("rounded-lg border-2 border-border-strong bg-surface-raised p-5", className)}>
      <p className="mb-2 flex items-center gap-2 text-label font-semibold text-fg-secondary">
        <FileSearch className="size-4" aria-hidden />
        Kan ikke dokumenteres
      </p>
      <h3 className="text-heading-3 text-fg-primary">{UNVERIFIABLE_TITLE}</h3>
      <p className="mt-2 text-body text-fg-secondary">{UNVERIFIABLE_BODY}</p>
      {children ? <div className="mt-4 space-y-2">{children}</div> : null}
    </section>
  );
}
