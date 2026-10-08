import type { EvidenceSet } from "../knowledge/core/evidence.ts";
import type { RetrievalObserver, RetrievalStep } from "../knowledge/retrieval-core.ts";

import { createAlert, type AlertCode, type AlertSink, type LineWriter } from "./alerts.ts";

/**
 * Retrieval telemetry in the application (docs/08b §12, §14; 8B-I7).
 *
 *   * One JSON line per retrieval (event "retrieval"): the outcome, the grade, the unmet
 *     conditions, the configuration id and the duration of each step (§12: the whole chain,
 *     query embedding, database search, reranking). Never the query, a title or any content.
 *   * Alarms: retrieval unavailable (a system failure, B-007) and a runtime fingerprint that
 *     does not match the active configuration (P4 unmet while a configuration is in service).
 *     At most one per alarm code per 10 minutes and process — a burst of failing requests is
 *     one alarm, not hundreds.
 */

export const ALERT_COOLDOWN_MS = 10 * 60 * 1000;

export interface RetrievalTelemetryDeps {
  sink: AlertSink;
  write?: LineWriter;
  now?: () => number;
}

export interface RetrievalTelemetry {
  /** Pass as the retrieval pipeline's observe hook (RetrievalDeps.observe). */
  observe: RetrievalObserver;
  /** After a retrieval that produced a set. */
  succeeded(set: EvidenceSet): Promise<void>;
  /** After a retrieval that failed; `code` is the RetrievalError code (or "error"). */
  failed(code: string): Promise<void>;
}

const lastAlert = new Map<AlertCode, number>();

/** Only for tests: forget the cooldowns. */
export function resetTelemetryCooldowns(): void {
  lastAlert.clear();
}

export function createRetrievalTelemetry(deps: RetrievalTelemetryDeps): RetrievalTelemetry {
  const write = deps.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = deps.now ?? Date.now;
  const steps: Partial<Record<RetrievalStep, number>> = {};
  const failedSteps: RetrievalStep[] = [];

  async function alert(code: AlertCode, details: Record<string, unknown>): Promise<void> {
    const at = now();
    const last = lastAlert.get(code);
    if (last !== undefined && at - last < ALERT_COOLDOWN_MS) return;
    lastAlert.set(code, at);
    await deps.sink.send(createAlert(code, details, () => new Date(at)));
  }

  const line = (fields: Record<string, unknown>) => {
    try {
      write(JSON.stringify({ event: "retrieval", at: new Date(now()).toISOString(), ...fields, steps_ms: steps, ...(failedSteps.length ? { failed_steps: failedSteps } : {}) }));
    } catch {
      // Telemetry never fails a request.
    }
  };

  return {
    observe(step, milliseconds, ok) {
      steps[step] = Math.round(milliseconds);
      if (!ok) failedSteps.push(step);
    },
    async succeeded(set) {
      const { retrieval } = set;
      line({
        outcome: set.items.length > 0 ? "evidence" : "insufficient",
        grade: retrieval.grade,
        unmet: retrieval.unmet,
        configuration_id: retrieval.configuration?.id ?? null,
        items: set.items.length,
        candidates: retrieval.candidateCount,
      });
      if (retrieval.configuration && retrieval.unmet.includes("P4")) {
        await alert("configuration_mismatch", { configuration_id: retrieval.configuration.id, configuration_fingerprint: retrieval.configuration.fingerprint });
      }
    },
    async failed(code) {
      line({ outcome: "error", error_code: code });
      if (code === "unavailable" || code === "error") {
        await alert("retrieval_unavailable", { error_code: code, failed_steps: failedSteps.join(",") });
      }
    },
  };
}
