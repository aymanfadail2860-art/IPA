import { CircleX, Lock } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * ErrorState — answers: what happened, is my work safe, what can I do now (§18.2).
 * Variant "access" never reveals the content the user cannot see.
 * Visually distinct from InsufficientEvidence, which is a valid answer, not a failure.
 */
export function ErrorState({
  variant = "component",
  title,
  children,
  workSafety,
  actions,
  className,
}: {
  variant?: "component" | "page" | "access";
  title: string;
  children?: ReactNode;
  /** E.g. "Din besvarelse er gemt." — required in Advise and active Assessment. */
  workSafety?: string;
  actions?: ReactNode;
  className?: string;
}) {
  const Icon = variant === "access" ? Lock : CircleX;
  return (
    <div
      role={variant === "access" ? "status" : "alert"}
      className={cn(
        "flex flex-col items-start gap-3 rounded-lg border p-6",
        variant === "access"
          ? "border-border-subtle bg-surface-raised"
          : "border-error/30 bg-error-subtle",
        variant === "page" && "mx-auto mt-10 max-w-xl",
        className,
      )}
    >
      <p className={cn("flex items-center gap-2 text-label font-semibold", variant === "access" ? "text-fg-secondary" : "text-error")}>
        <Icon className="size-4" aria-hidden />
        {variant === "access" ? "Ingen adgang" : "Fejl"}
      </p>
      <div>
        <p className="text-heading-3 text-fg-primary">{title}</p>
        {children ? <div className="mt-1 text-body text-fg-secondary">{children}</div> : null}
        {workSafety ? <p className="mt-2 text-body font-medium text-fg-primary">{workSafety}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
