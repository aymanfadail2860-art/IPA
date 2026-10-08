import { StatusBadge } from "@/components/status/status-badge";
import { Card } from "@/components/ui/card";
import type { SystemStatusView } from "@/lib/observability/system-status";

const TONE = { success: "success", warning: "warning", danger: "error", neutral: "neutral" } as const;
const TONE_LABEL = { success: "OK", warning: "Kræver opmærksomhed", danger: "Fejl", neutral: "—" } as const;

/**
 * Systemstatus (docs/08b §14, 8B-I7): queue, failures, scanner, configuration, evaluation and
 * performance as counts and ids from the database. Alarms are sent by the worker's scheduled
 * check; this is the same picture for the administrator. No content, no queries, no persons.
 */
export function SystemStatus({ status }: { status: SystemStatusView | null }) {
  if (!status) {
    return <Card className="text-body text-fg-secondary">Systemstatus kunne ikke læses fra databasen.</Card>;
  }
  return (
    <Card className="p-0">
      <p className="px-6 pt-4 text-caption text-fg-secondary">Miljø: {status.environment}</p>
      <ul className="divide-y divide-border-subtle">
        {status.rows.map((row) => (
          <li key={row.label} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
            <span>
              <span className="block text-body text-fg-primary">{row.label}</span>
              <span className="block text-caption text-fg-secondary">{row.value}</span>
            </span>
            <StatusBadge status={TONE[row.tone]} label={TONE_LABEL[row.tone]} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
