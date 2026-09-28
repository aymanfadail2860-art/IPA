import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** EmptyState — explanation + one concrete action. Never just "Ingen data" (§3.7). */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-start gap-3 rounded-lg border border-border-subtle bg-surface-raised p-6", className)}>
      {Icon ? (
        <span className="inline-flex size-9 items-center justify-center rounded-md bg-surface-sunken text-fg-secondary">
          <Icon className="size-4" aria-hidden />
        </span>
      ) : null}
      <div>
        <p className="text-heading-3 text-fg-primary">{title}</p>
        {children ? <div className="mt-1 max-w-prose text-body text-fg-secondary">{children}</div> : null}
      </div>
      {action}
    </div>
  );
}
