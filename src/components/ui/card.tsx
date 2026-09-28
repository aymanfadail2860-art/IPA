import * as React from "react";
import Link from "next/link";

import { STATUSES, type Status } from "@/config/status";
import { cn } from "@/lib/utils";

/**
 * Cards (docs/04-ui-ux-design.md §3.6): surface.raised, radius.lg, border.subtle and no
 * shadow at rest. Three variants:
 *  - Card            static content
 *  - InteractiveCard the whole card is a link; hover raises it slightly (shadow.sm)
 *  - StatusCard      left edge in a knowledge/feedback status colour
 */
function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn("rounded-lg border border-border-subtle bg-surface-raised p-6", className)}
      {...props}
    />
  );
}

function InteractiveCard({
  className,
  href,
  ...props
}: React.ComponentProps<typeof Link> & { href: string }) {
  return (
    <Link
      data-slot="card"
      href={href}
      className={cn(
        "block rounded-lg border border-border-subtle bg-surface-raised p-6 transition-shadow hover:border-border-strong/50 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
        className,
      )}
      {...props}
    />
  );
}

function StatusCard({
  className,
  status,
  ...props
}: React.ComponentProps<"div"> & { status: Status }) {
  return (
    <div
      data-slot="card"
      data-status={status}
      className={cn(
        "rounded-lg border border-l-4 border-border-subtle bg-surface-raised p-6",
        STATUSES[status].edgeClass,
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mb-4 flex items-start justify-between gap-4", className)} {...props} />;
}

function CardTitle({
  className,
  as: Heading = "h3",
  ...props
}: React.ComponentProps<"h3"> & { as?: "h2" | "h3" | "h4" }) {
  return <Heading className={cn("text-heading-3 text-fg-primary", className)} {...props} />;
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-body text-fg-secondary", className)} {...props} />;
}

export { Card, CardDescription, CardHeader, CardTitle, InteractiveCard, StatusCard };
