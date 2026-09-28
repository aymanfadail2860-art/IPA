import { CircleCheck, CircleDot, Circle } from "lucide-react";

import { cn } from "@/lib/utils";

export interface RetrievalStep {
  label: string;
  state: "done" | "active" | "pending";
}

/**
 * RetrievalProgress — three explicit steps instead of a spinner while an answer is formed
 * (docs/04-ui-ux-design.md §8.4). Announced to screen readers through a polite live region.
 * The active step uses a static icon, so nothing moves when motion is reduced.
 */
export function RetrievalProgress({ steps, className }: { steps: readonly RetrievalStep[]; className?: string }) {
  return (
    <ol aria-live="polite" aria-label="Status for opslag i vidensgrundlaget" className={cn("space-y-1.5", className)}>
      {steps.map((step) => {
        const Icon = step.state === "done" ? CircleCheck : step.state === "active" ? CircleDot : Circle;
        return (
          <li
            key={step.label}
            className={cn(
              "flex items-center gap-2 text-body",
              step.state === "done" && "text-fg-secondary",
              step.state === "active" && "font-medium text-fg-primary",
              step.state === "pending" && "text-fg-tertiary",
            )}
          >
            <Icon
              className={cn("size-4 shrink-0", step.state === "done" && "text-success", step.state === "active" && "text-brand")}
              aria-hidden
            />
            <span>
              {step.label}
              <span className="sr-only">
                {step.state === "done" ? " — færdig" : step.state === "active" ? " — i gang" : " — venter"}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
