import { CircleCheck, CircleDashed, CircleDot, TriangleAlert, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import type { WorkArea, WorkAreaState } from "@/types/domain";

const STATE: Record<WorkAreaState, { icon: LucideIcon; label: string; className: string }> = {
  notStarted: { icon: CircleDashed, label: "Ikke påbegyndt", className: "text-fg-tertiary" },
  inProgress: { icon: CircleDot, label: "I gang", className: "text-brand" },
  complete: { icon: CircleCheck, label: "Udfyldt", className: "text-success" },
  attention: { icon: TriangleAlert, label: "Kræver opmærksomhed", className: "text-warning" },
};

/**
 * StepRail — the seven Advise work areas. Free navigation: any area can be opened.
 * The rail shows COMPLETENESS per area, not a linear progress bar (§10.1).
 * Below the desktop breakpoint it is replaced by a select (see StepRailSelect).
 */
export function StepRail({
  areas,
  currentId,
  hrefFor,
  label = "Arbejdsområder",
}: {
  areas: readonly WorkArea[];
  currentId: string;
  hrefFor: (area: WorkArea) => string;
  label?: string;
}) {
  return (
    <nav aria-label={label}>
      <ol className="space-y-0.5">
        {areas.map((area) => {
          const state = STATE[area.state];
          const Icon = state.icon;
          const current = area.id === currentId;
          return (
            <li key={area.id}>
              <Link
                href={hrefFor(area)}
                aria-current={current ? "step" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-body transition-colors",
                  current ? "bg-accent-subtle font-medium text-fg-primary" : "text-fg-secondary hover:bg-surface-sunken hover:text-fg-primary",
                )}
              >
                <Icon className={cn("size-4 shrink-0", state.className)} aria-hidden />
                <span className="flex-1">{area.name}</span>
                <span className="sr-only">, {state.label}</span>
                {area.openItems ? (
                  <span className="tabular rounded-full bg-warning-subtle px-1.5 text-caption font-medium text-warning">
                    {area.openItems}
                    <span className="sr-only"> åbne punkter</span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function workAreaStateLabel(state: WorkAreaState): string {
  return STATE[state].label;
}
