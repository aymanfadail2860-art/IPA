import { STATUSES, type Status } from "@/config/status";
import { cn } from "@/lib/utils";

/**
 * StatusBadge — colour + icon + text, always. Colour never carries the meaning alone
 * (docs/04-ui-ux-design.md §3.3, §20). Badges are read-only status; clickable filters
 * are chips.
 */
export function StatusBadge({
  status,
  label,
  className,
}: {
  status: Status;
  /** Overrides the default label, e.g. "Gældende fra 1. juli 2025". */
  label?: string;
  className?: string;
}) {
  const definition = STATUSES[status];
  const Icon = definition.icon;
  return (
    <span
      data-status={status}
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-sm px-2 py-0.5 text-label whitespace-nowrap",
        definition.textClass,
        definition.subtleClass,
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span>{label ?? definition.label}</span>
    </span>
  );
}

/** Compact inline status: icon + text in the status colour, without background. */
export function StatusText({
  status,
  label,
  className,
}: {
  status: Status;
  label?: string;
  className?: string;
}) {
  const definition = STATUSES[status];
  const Icon = definition.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-label", definition.textClass, className)}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span>{label ?? definition.label}</span>
    </span>
  );
}
