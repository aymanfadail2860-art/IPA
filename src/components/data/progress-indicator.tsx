import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

/**
 * ProgressIndicator — progress always accompanied by text ("Modul 4 af 11"), never a bar
 * alone. Progress is not the primary motivator (§2), so the bar stays thin and calm.
 */
export function ProgressIndicator({
  value,
  max = 100,
  label,
  valueText,
  className,
}: {
  value: number;
  max?: number;
  label: string;
  valueText: string;
  className?: string;
}) {
  const percent = Math.round((value / max) * 100);
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3 text-label">
        <span className="text-fg-secondary">{label}</span>
        <span className="tabular font-medium text-fg-primary">{valueText}</span>
      </div>
      <Progress value={percent} aria-label={label} aria-valuetext={valueText} className="h-1.5" />
    </div>
  );
}
