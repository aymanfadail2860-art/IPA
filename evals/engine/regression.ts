import { createAlert, type Alert } from "../../src/lib/observability/alerts.ts";

/**
 * Regression control (docs/08b §4.4, §10.2; 8B-I7, 8B-I7.1) — the alarms of a registered run.
 * Kept apart from the evaluation environment code, so the publication step (workers/evaluation)
 * depends on no application client at all.
 *
 * The DATABASE classifies a registered run (knowledge.evaluation_run_classification, returned by
 * knowledge.publish_evaluation_run): whether it is a baseline or a regression depends on the
 * configuration's status when the run was registered, never on what the CI job said. The mode the
 * job asked for (`requestedMode`) is diagnostic only: it is stored, logged and shown next to the
 * classification, and decides nothing — not the alarm code, not the severity, not suspension.
 */

/** What the CI job intended. Diagnostic only (8B-I7.1). */
export type EvaluationMode = "baseline" | "regression";

/** The database's classification of a registered run (8B-I7.1). */
export type RunClassification = "baseline" | "regression" | "hard_gate_regression" | "quality_regression";

const CLASSIFICATIONS: readonly RunClassification[] = ["baseline", "regression", "hard_gate_regression", "quality_regression"];

/** knowledge.evaluation_run_event: the registered run as the database sees it. */
export interface RegisteredRunEvent {
  id: string;
  runId: string;
  registeredAt: string;
  classification: RunClassification;
  requestedMode: EvaluationMode | null;
  /** The configuration's status in the database when the run was registered. */
  registeredWhile: string;
  outcome: string;
  configurationId: string;
  /** The configuration's status now (after a hard-gate regression: "suspended"). */
  configurationStatus: string;
  /** True when THIS run suspended the configuration. */
  suspended: boolean;
  evalSet: { id: string; version: number; checksum: string };
  gateSet: { id: string; version: number; checksum: string };
  runtimeFingerprint: string;
  corpusChecksum: string;
  failedHardGates: string[];
  failedQualityGates: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === "string" ? value : value instanceof Date ? value.toISOString() : "");
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);

/**
 * Reads the database's answer. An unknown or missing classification is an error, never a
 * baseline: a run that cannot be classified must not pass silently.
 */
export function parseRunEvent(data: unknown): RegisteredRunEvent {
  const event = typeof data === "string" ? (JSON.parse(data) as unknown) : data;
  if (!isRecord(event) || !CLASSIFICATIONS.includes(event.classification as RunClassification) || typeof event.id !== "string") {
    throw new Error("Databasens klassifikation af kørslen kunne ikke læses.");
  }
  const evalSet = isRecord(event.evalSet) ? event.evalSet : {};
  const gateSet = isRecord(event.gateSet) ? event.gateSet : {};
  return {
    id: event.id,
    runId: str(event.runId),
    registeredAt: str(event.registeredAt),
    classification: event.classification as RunClassification,
    requestedMode: event.requestedMode === "baseline" || event.requestedMode === "regression" ? event.requestedMode : null,
    registeredWhile: str(event.registeredWhile),
    outcome: str(event.outcome),
    configurationId: str(event.configurationId),
    configurationStatus: str(event.configurationStatus),
    suspended: event.suspended === true,
    evalSet: { id: str(evalSet.id), version: Number(evalSet.version) || 0, checksum: str(evalSet.checksum) },
    gateSet: { id: str(gateSet.id), version: Number(gateSet.version) || 0, checksum: str(gateSet.checksum) },
    runtimeFingerprint: str(event.runtimeFingerprint),
    corpusChecksum: str(event.corpusChecksum),
    failedHardGates: strings(event.failedHardGates),
    failedQualityGates: strings(event.failedQualityGates),
  };
}

/** Whether the job's intention agrees with the database (diagnostic, shown in the alarm). */
export function requestedModeMatches(event: Pick<RegisteredRunEvent, "classification" | "requestedMode">): boolean | null {
  if (event.requestedMode === null) return null;
  return (event.requestedMode === "baseline") === (event.classification === "baseline");
}

/**
 * The alarms of a registered run, from the database's classification only (§4.4, §10.2): a
 * hard-gate regression is critical (the database has suspended the configuration in the same
 * transaction — no fallback); a quality regression is a warning for review. A baseline and a
 * passing regression raise nothing. The alarm names the evaluation set, the gate set and the
 * runtime fingerprint, and shows the requested mode beside the classification.
 */
export function classificationAlerts(event: RegisteredRunEvent, now: () => Date = () => new Date()): Alert[] {
  if (event.classification !== "hard_gate_regression" && event.classification !== "quality_regression") return [];
  const matches = requestedModeMatches(event);
  const details = {
    run_id: event.runId,
    classification: event.classification,
    requested_mode: event.requestedMode ?? "none",
    requested_mode_matches: matches === null ? "unknown" : String(matches),
    outcome: event.outcome,
    configuration_id: event.configurationId,
    configuration_status: event.configurationStatus,
    suspended: String(event.suspended),
    eval_set: `${event.evalSet.id}@${event.evalSet.version}`,
    eval_set_checksum: event.evalSet.checksum,
    gate_set: `${event.gateSet.id}@${event.gateSet.version}`,
    gate_set_checksum: event.gateSet.checksum,
    runtime_fingerprint: event.runtimeFingerprint,
    corpus_checksum: event.corpusChecksum,
  };
  return event.classification === "hard_gate_regression"
    ? [createAlert("hard_gate_regression", { ...details, failed_hard_gates: event.failedHardGates.join(",") }, now)]
    : [createAlert("quality_regression", { ...details, failed_quality_gates: event.failedQualityGates.join(",") }, now)];
}

/** A run the database refused as invalid (H7, or H6 outside service): neither baseline nor pass. */
export function invalidRunAlert(runId: string, requestedMode: EvaluationMode | null, now: () => Date = () => new Date()): Alert {
  return createAlert("evaluation_invalid", { run_id: runId, requested_mode: requestedMode ?? "none", reason: "invalid_run" }, now);
}
