"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Wraps a disabled control and explains WHY it is disabled (docs/04-ui-ux-design.md §3.6).
 * The wrapper is focusable so keyboard users get the explanation too.
 */
export function DisabledReason({ reason, children }: { reason: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex rounded-md" aria-label={reason}>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}
