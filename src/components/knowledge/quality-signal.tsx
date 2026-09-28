import { ArrowRight } from "lucide-react";

import { STATUSES } from "@/config/status";
import { cn } from "@/lib/utils";

/**
 * QualitySignal — a proactive signal that points at a problem (missing information,
 * document conflicts, insufficient basis). It is NOT a suggestion and never looks like
 * one: status treatment (colour + icon + text), never the dashed AI signature (§10.4).
 */
export function QualitySignal({
  tone,
  title,
  detail,
  action,
  className,
}: {
  tone: "warning" | "info";
  title: string;
  detail?: string;
  action?: { label: string; onClick?: () => void; href?: string };
  className?: string;
}) {
  const definition = STATUSES[tone];
  const Icon = definition.icon;
  const actionClass = cn(
    "inline-flex shrink-0 items-center gap-1 text-label font-medium underline-offset-4 hover:underline",
    definition.textClass,
  );
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-l-4 border-border-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
        definition.edgeClass,
        definition.subtleClass,
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <Icon className={cn("mt-0.5 size-4 shrink-0", definition.textClass)} aria-hidden />
        <div>
          <p className="text-body font-semibold text-fg-primary">
            <span className="sr-only">{tone === "warning" ? "Advarsel: " : "Information: "}</span>
            {title}
          </p>
          {detail ? <p className="text-body text-fg-secondary">{detail}</p> : null}
        </div>
      </div>
      {action ? (
        action.href ? (
          <a href={action.href} className={actionClass}>
            {action.label}
            <ArrowRight className="size-3.5" aria-hidden />
          </a>
        ) : (
          <button type="button" onClick={action.onClick} className={actionClass}>
            {action.label}
            <ArrowRight className="size-3.5" aria-hidden />
          </button>
        )
      ) : null}
    </div>
  );
}
