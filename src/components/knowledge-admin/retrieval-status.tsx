import { ErrorState } from "@/components/states/error-state";
import { StatusBadge } from "@/components/status/status-badge";
import { Card } from "@/components/ui/card";
import type { RetrievalAvailability } from "@/lib/knowledge/retrieval-availability";
import { UNAVAILABLE_TITLE } from "@/lib/knowledge/result-presentation";

/**
 * Retrieval's state for the administrator (docs/07 §20.2): an unavailable retrieval is shown
 * as a system error in Admin — not only in the server log — and never as missing knowledge.
 */
export function RetrievalStatus({ availability }: { availability: RetrievalAvailability }) {
  if (availability.state === "unavailable") {
    return (
      <ErrorState title={UNAVAILABLE_TITLE}>
        {availability.reason} Søgninger giver en systemfejl, indtil konfigurationen er rettet. Det er ikke det samme som manglende dokumentation.
      </ErrorState>
    );
  }
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-body">
        <span className="font-medium text-fg-primary">Retrieval er tilgængelig.</span>{" "}
        <span className="text-fg-secondary">
          Reranker: {availability.reranker.id} · embedding-model: {availability.embeddingModel?.label ?? "ingen aktiv model (kun leksikalsk søgning)"}
          {availability.configuration
            ? ` · konfiguration: ${availability.configuration.label} v${availability.configuration.version} (${availability.configuration.status === "active" ? "aktiv" : "suspenderet"}${availability.configuration.tier === "pilot" ? ", pilot-godkendelse" : ""}, ${availability.configuration.fingerprint.slice(0, 12)}…)`
            : " · ingen retrieval-konfiguration i drift"}
        </span>
        {availability.productionUnavailable ? <span className="block text-fg-secondary">{availability.productionUnavailable}</span> : null}
      </span>
      {availability.grade === "development" ? (
        <StatusBadge status="warning" label="Udviklingsgrad — ikke produktionsevidens" />
      ) : (
        <StatusBadge status="success" label="Produktionsgrad" />
      )}
    </Card>
  );
}
