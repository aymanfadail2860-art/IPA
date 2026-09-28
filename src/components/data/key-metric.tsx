import { cn } from "@/lib/utils";

/** KeyMetric — a figure is always paired with an explaining text ("68 % gennemført"). */
export function KeyMetric({
  label,
  value,
  explanation,
  className,
}: {
  label: string;
  value: string;
  explanation: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-border-subtle bg-surface-raised p-5", className)}>
      <p className="text-label text-fg-secondary">{label}</p>
      <p className="tabular mt-2 text-heading-1 text-fg-primary">{value}</p>
      <p className="mt-1 text-caption text-fg-secondary">{explanation}</p>
    </div>
  );
}
