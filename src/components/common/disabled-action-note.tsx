import { Lock } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Visible explanation next to disabled actions (docs/04 §3.6). Used instead of a tooltip
 * where the actions are disabled on touch devices, which have no hover.
 */
export function DisabledActionNote({ id, reason, className }: { id?: string; reason: string; className?: string }) {
  return (
    <p id={id} className={cn("flex items-center gap-1.5 text-caption text-fg-secondary", className)}>
      <Lock className="size-3.5 shrink-0" aria-hidden />
      {reason}
    </p>
  );
}
