import { CircleAlert, Info, Lightbulb, TriangleAlert, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { CalloutVariant } from "@/types/domain";

/**
 * CalloutBox — professional callouts in lessons with four fixed meanings: Vigtigt,
 * Undtagelse, Eksempel, Almindelig fejl. Left edge in status colour + icon + label —
 * never colour alone (docs/04-ui-ux-design.md §7.3).
 */
const VARIANTS: Record<CalloutVariant, { icon: LucideIcon; label: string; className: string; text: string }> = {
  important: { icon: Info, label: "Vigtigt", className: "border-l-info bg-info-subtle", text: "text-info" },
  exception: { icon: TriangleAlert, label: "Undtagelse", className: "border-l-warning bg-warning-subtle", text: "text-warning" },
  example: { icon: Lightbulb, label: "Eksempel", className: "border-l-brand bg-brand-subtle", text: "text-brand" },
  commonMistake: { icon: CircleAlert, label: "Almindelig fejl", className: "border-l-error bg-error-subtle", text: "text-error" },
};

export function CalloutBox({ variant, children }: { variant: CalloutVariant; children: React.ReactNode }) {
  const config = VARIANTS[variant];
  const Icon = config.icon;
  return (
    <aside
      aria-label={config.label}
      className={cn("my-6 rounded-md border-l-4 px-5 py-4", config.className)}
    >
      <p className={cn("mb-1 flex items-center gap-2 text-label font-semibold", config.text)}>
        <Icon className="size-4" aria-hidden />
        {config.label}
      </p>
      <div className="text-reading text-fg-primary">{children}</div>
    </aside>
  );
}
