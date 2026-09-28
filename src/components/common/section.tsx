import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Section — a titled group on a page. Space is the primary separator (space.10+ between
 * sections, docs/04-ui-ux-design.md §3.2), not lines.
 */
export function Section({
  title,
  description,
  action,
  children,
  className,
  titleId,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  titleId?: string;
}) {
  const id = titleId ?? `section-${title.toLowerCase().replace(/[^a-zæøå0-9]+/g, "-")}`;
  return (
    <section aria-labelledby={id} className={cn("space-y-4", className)}>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 id={id} className="text-label font-semibold tracking-wide text-fg-tertiary uppercase">
            {title}
          </h2>
          {description ? <p className="mt-1 text-body text-fg-secondary">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
