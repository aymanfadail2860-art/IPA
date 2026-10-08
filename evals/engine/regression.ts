import { createAlert, type Alert } from "../../src/lib/observability/alerts.ts";

import type { EvaluationReport } from "./runner.ts";

/**
 * Regression control (docs/08b §4.4, §10.2; 8B-I7) — the alarms of a registered run. Kept apart
 * from the evaluation environment code, so the publication step (workers/evaluation) depends on
 * no application client at all.
 */

export type EvaluationMode = "baseline" | "regression";

/**
 * The alarms of a registered regression run (§4.4, §10.2): a hard-gate breach is critical (the
 * database has suspended the configuration in the same transaction — no fallback); a failed
 * quality gate is a warning for review. The alarm names the evaluation set, the gate set and the
 * runtime fingerprint. A baseline run raises no regression alarm.
 */
export function regressionAlerts(report: EvaluationReport, mode: EvaluationMode, now: () => Date = () => new Date()): Alert[] {
  if (mode !== "regression") return [];
  const details = {
    run_id: report.runId,
    verdict: report.verdict,
    eval_set: `${report.evalSet.setId}@${report.evalSet.version}`,
    eval_set_checksum: report.evalSet.checksum,
    gate_set: `${report.gateSet.id}@${report.gateSet.version}`,
    gate_set_checksum: report.gateSet.checksum,
    runtime_fingerprint: report.configuration.runtimeFingerprint,
    corpus_checksum: report.corpus.checksumAfter,
  };
  const hard = report.hardGates.filter((gate) => gate.status === "fail").map((gate) => gate.id);
  if (hard.length > 0) return [createAlert("hard_gate_regression", { ...details, failed_hard_gates: hard.join(",") }, now)];
  const quality = report.qualityGates.filter((gate) => gate.status === "fail").map((gate) => gate.id);
  if (quality.length > 0) return [createAlert("quality_regression", { ...details, failed_quality_gates: quality.join(",") }, now)];
  return [];
}
