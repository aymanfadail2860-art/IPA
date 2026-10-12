/**
 * Systemindstillinger → Drift af retrieval (8B-I8 C2, docs/08b §10.2, §10.3, §21.15): which
 * human decisions the 8B lifecycle is waiting for. Pure mapping from the rows a settings
 * manager can read (RLS) to what the Admin section shows; the database decides every action
 * again. Never an evaluation result, a gate value or a fingerprint that a person could set.
 */

export interface OperationsGateSet {
  id: string;
  label: string;
  decision: string;
  checksum: string;
  registeredAt: string;
  approved: boolean;
}

export interface OperationsFailure {
  gate: string;
  caseId: string | null;
  explanation: string;
}

export interface OperationsRun {
  id: string;
  runId: string;
  outcome: "pass" | "pass_with_uncertainty" | "insufficient_certainty" | "fail";
  tier: "pilot" | "standard";
  registeredAt: string;
  registeredWhile: string;
  gateSetApproved: boolean;
  uncertaintyAccepted: boolean;
  failures: OperationsFailure[];
}

export type ConfigurationStatus = "candidate" | "approved" | "active" | "suspended" | "retired";

export interface OperationsConfiguration {
  id: string;
  label: string;
  version: number;
  fingerprint: string;
  status: ConfigurationStatus;
  tier: string | null;
  statusChangedAt: string;
  suspensionReason: string | null;
  runs: OperationsRun[];
}

export interface OperationsMeasurement {
  id: string;
  measurementId: string;
  configurationLabel: string;
  deviations: string[];
  measuredAt: string;
  accepted: boolean;
}

export interface OperationsModel {
  id: string;
  label: string;
  embeddings: number;
  publishedChunks: number;
}

export interface RetrievalOperationsView {
  gateSets: OperationsGateSet[];
  configurations: OperationsConfiguration[];
  measurements: OperationsMeasurement[];
  candidateModels: OperationsModel[];
}

export interface OperationsRows {
  gateSets: { id: string; gate_set_id: string; version: number; decision: string; checksum: string; registered_at: string; approved_at: string | null }[];
  configurations: {
    id: string;
    label: string;
    version: number;
    fingerprint: string;
    status: string;
    tier: string | null;
    status_changed_at: string;
    suspension_reason: string | null;
  }[];
  runs: {
    id: string;
    run_id: string;
    configuration_id: string;
    gate_set_id: string;
    outcome: string;
    tier: string;
    registered_at: string;
    registered_while: string;
    failures: unknown;
  }[];
  acceptedRuns: string[];
  measurements: { id: string; measurement_id: string; configuration_id: string; deviations: string[]; measured_at: string }[];
  acceptedMeasurements: string[];
  models: { id: string; label: string; status: string; embeddings: number }[];
  publishedChunks: number;
}

/** How many registered runs per configuration the section shows (newest first). */
export const RUNS_PER_CONFIGURATION = 5;

const OUTCOMES = new Set(["pass", "pass_with_uncertainty", "insufficient_certainty", "fail"]);
const STATUSES = new Set(["candidate", "approved", "active", "suspended", "retired"]);

function failuresOf(value: unknown): OperationsFailure[] {
  if (!Array.isArray(value)) return [];
  return value.map((failure) => {
    const row = (failure ?? {}) as Record<string, unknown>;
    return {
      gate: typeof row.gate === "string" ? row.gate : "ukendt",
      caseId: typeof row.caseId === "string" ? row.caseId : null,
      explanation: typeof row.explanation === "string" ? row.explanation.slice(0, 300) : "",
    };
  });
}

export function operationsView(rows: OperationsRows): RetrievalOperationsView {
  const approvedGateSets = new Set(rows.gateSets.filter((gate) => gate.approved_at !== null).map((gate) => gate.id));
  const acceptedRuns = new Set(rows.acceptedRuns);
  const acceptedMeasurements = new Set(rows.acceptedMeasurements);
  const labels = new Map(rows.configurations.map((configuration) => [configuration.id, `${configuration.label} v${configuration.version}`]));

  const runsByConfiguration = new Map<string, OperationsRun[]>();
  for (const run of [...rows.runs].sort((a, b) => b.registered_at.localeCompare(a.registered_at))) {
    if (!OUTCOMES.has(run.outcome)) continue;
    const list = runsByConfiguration.get(run.configuration_id) ?? [];
    if (list.length >= RUNS_PER_CONFIGURATION) continue;
    list.push({
      id: run.id,
      runId: run.run_id,
      outcome: run.outcome as OperationsRun["outcome"],
      tier: run.tier === "standard" ? "standard" : "pilot",
      registeredAt: run.registered_at,
      registeredWhile: run.registered_while,
      gateSetApproved: approvedGateSets.has(run.gate_set_id),
      uncertaintyAccepted: acceptedRuns.has(run.id),
      failures: failuresOf(run.failures),
    });
    runsByConfiguration.set(run.configuration_id, list);
  }

  return {
    gateSets: rows.gateSets
      .map((gate) => ({
        id: gate.id,
        label: `${gate.gate_set_id} v${gate.version}`,
        decision: gate.decision,
        checksum: gate.checksum,
        registeredAt: gate.registered_at,
        approved: gate.approved_at !== null,
      }))
      .sort((a, b) => Number(a.approved) - Number(b.approved) || b.registeredAt.localeCompare(a.registeredAt)),
    configurations: rows.configurations
      .filter((configuration) => STATUSES.has(configuration.status))
      .map((configuration) => ({
        id: configuration.id,
        label: configuration.label,
        version: configuration.version,
        fingerprint: configuration.fingerprint,
        status: configuration.status as ConfigurationStatus,
        tier: configuration.tier,
        statusChangedAt: configuration.status_changed_at,
        suspensionReason: configuration.suspension_reason,
        runs: runsByConfiguration.get(configuration.id) ?? [],
      })),
    measurements: rows.measurements
      .filter((measurement) => measurement.deviations.length > 0)
      .map((measurement) => ({
        id: measurement.id,
        measurementId: measurement.measurement_id,
        configurationLabel: labels.get(measurement.configuration_id) ?? measurement.configuration_id,
        deviations: measurement.deviations,
        measuredAt: measurement.measured_at,
        accepted: acceptedMeasurements.has(measurement.id),
      })),
    candidateModels: rows.models
      .filter((model) => model.status === "candidate")
      .map((model) => ({ id: model.id, label: model.label, embeddings: model.embeddings, publishedChunks: rows.publishedChunks })),
  };
}

/**
 * Which decisions the screen offers for a configuration. The database refuses anything that
 * does not hold (problems, scope, coverage, runs registered after a suspension); this only
 * avoids offering a button that can never work.
 */
export function configurationActions(configuration: OperationsConfiguration): { approve: boolean; activate: boolean; suspend: boolean; retire: boolean } {
  const approvableRun = configuration.runs.some((run) => run.outcome === "pass" || (run.outcome === "pass_with_uncertainty" && run.uncertaintyAccepted));
  return {
    approve: ["candidate", "suspended", "retired"].includes(configuration.status) && approvableRun,
    activate: configuration.status === "approved",
    suspend: configuration.status === "active",
    retire: ["candidate", "approved", "suspended"].includes(configuration.status),
  };
}

/** Minimum lengths the database enforces (docs/08b §10.2, B-030, B-032). Shown before the call. */
export const MIN_SUSPENSION_REASON = 10;
export const MIN_RETIREMENT_REASON = 10;
export const MIN_ROOT_CAUSE_NOTE = 10;
export const MIN_UNCERTAINTY_JUSTIFICATION = 20;
export const MIN_DEVIATION_JUSTIFICATION = 20;
