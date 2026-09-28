import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** PageHeader — page title (text.heading.1, or text.display on Home and module fronts). */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  display = false,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  display?: boolean;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-4 md:flex-row md:items-end md:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1 text-label text-fg-tertiary">{eyebrow}</p> : null}
        <h1 className={cn("text-fg-primary", display ? "text-display" : "text-heading-1")}>{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-body text-fg-secondary">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}
