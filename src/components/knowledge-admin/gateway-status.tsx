import { ErrorState } from "@/components/states/error-state";
import { StatusBadge } from "@/components/status/status-badge";
import { Card } from "@/components/ui/card";
import type { GatewayAvailability } from "@/lib/ai/gateway";
import { GATEWAY_UNAVAILABLE_TITLE } from "@/lib/ai/outcome";

/**
 * The AI Gateway's state for the administrator (docs/08 §12) — a readable state, like retrieval
 * (B-007). Unavailable is a system error, never missing knowledge.
 */
export function GatewayStatus({ availability }: { availability: GatewayAvailability }) {
  if (availability.state === "unavailable") {
    return (
      <ErrorState title={GATEWAY_UNAVAILABLE_TITLE}>
        {availability.reason} Copilot giver en systemfejl, indtil konfigurationen er rettet.
      </ErrorState>
    );
  }
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-body">
        <span className="font-medium text-fg-primary">AI Gateway er tilgængelig.</span>{" "}
        <span className="text-fg-secondary">Model: {availability.model.id}</span>
      </span>
      {availability.model.grade === "development" ? (
        <StatusBadge status="warning" label="Stub-model — ingen AI" />
      ) : (
        <StatusBadge status="success" label="Produktionsmodel" />
      )}
    </Card>
  );
}
