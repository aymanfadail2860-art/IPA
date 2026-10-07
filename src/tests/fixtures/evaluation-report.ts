import fs from "node:fs";
import path from "node:path";

import { checksumOf, configurationFingerprint, gateSetChecksum } from "../../../evals/engine/checksum.ts";
import { checkTypeMinimums, decide, evaluateHardGates, evaluateQualityGates, tierFor } from "../../../evals/engine/gates.ts";
import { computeMetrics } from "../../../evals/engine/metrics.ts";
import { caseQualityFailures, ENGINE_VERSION, NOT_PRODUCTION_REASON, REPORT_SCHEMA_VERSION, reportChecksum, type EvaluationReport, type Failure } from "../../../evals/engine/runner.ts";
import { validateGateSet } from "../../../evals/engine/schema.ts";
import { CASE_TYPES, type CaseObservation, type CaseType, type ConfigurationInput, type GateSet, type RerankerComparison, type Violation } from "../../../evals/engine/types.ts";

import { fixtureMaterial } from "./production-config";

/**
 * ⚠ TEST FIXTURE — an evaluation report in the REAL I1 format (runner.ts, reportSchema 3) for a
 * production-grade fixture configuration, assembled with the engine's own functions so that
 * verifyReport and knowledge.record_evaluation_run both recompute it exactly (8B-I6).
 *
 * The default is the smallest set that PASSES without any "uncertain" gate under the locked
 * thresholds (gates-v1, Wilson 95 %): 83 answerable and 16 abstaining questions — 99 in all,
 * so tier "pilot". Fewer answerable questions make Q1 uncertain even at 100 % (docs/08b §21.9).
 * Fictional: no documents, no AWS, no evaluation environment.
 */

export const GATES_V1: GateSet = validateGateSet(
  JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../evals/retrieval/gates/gates-v1.json"), "utf8")),
);

export const PASSING_COUNTS: Readonly<Record<CaseType, number>> = Object.freeze({
  direct: 75,
  multi_chunk: 0,
  historical: 3,
  conflict: 2,
  distractor: 3,
  unanswerable: 6,
  permission: 10,
  filter: 0,
});

const ABSTAINING: readonly CaseType[] = ["unanswerable", "permission"];

export interface ReportOptions {
  configuration?: ConfigurationInput;
  runtime?: ConfigurationInput;
  label?: string;
  runId?: string;
  environment?: "evaluation" | "fixture";
  documentTypes?: string[];
  counts?: Partial<Record<CaseType, number>>;
  gates?: GateSet;
  startedAt?: string;
  /** Changes observations before anything is computed (so the report stays consistent). */
  observe?: (cases: CaseObservation[]) => void;
  violations?: Violation[];
  withoutReranker?: { passage_recall_at_k: number | null; mrr_at_k: number | null };
}

function observation(id: string, type: CaseType): CaseObservation {
  if (ABSTAINING.includes(type)) {
    return {
      caseId: id, type, split: "dev", outcome: "insufficient", itemCount: 0, empty: true, sourceRank: null, firstGrade3Rank: null,
      requiredCovered: 0, requiredTotal: 0, gainsByRank: [], idealGains: [], itemsWithinK: 0, distractorItems: 0, violations: [], error: null,
    };
  }
  const items = type === "distractor" ? 12 : 1;
  return {
    caseId: id, type, split: "dev", outcome: "evidence", itemCount: items, empty: false, sourceRank: 1, firstGrade3Rank: 1,
    requiredCovered: 1, requiredTotal: 1, gainsByRank: [3], idealGains: [3], itemsWithinK: items, distractorItems: 0, violations: [], error: null,
  };
}

/** A report exactly as runEvaluation would write it for these observations. */
export function buildReport(options: ReportOptions = {}): EvaluationReport {
  const gates = options.gates ?? GATES_V1;
  const counts = { ...PASSING_COUNTS, ...options.counts };
  const cases: CaseObservation[] = CASE_TYPES.flatMap((type) => Array.from({ length: counts[type] }, (_, i) => observation(`${type}-${String(i + 1).padStart(3, "0")}`, type)));
  options.observe?.(cases);
  const declared = options.configuration ?? fixtureMaterial();
  const runtime = options.runtime ?? declared;
  const declaredFingerprint = configurationFingerprint(declared);
  const runtimeFingerprint = configurationFingerprint(runtime);
  const environment = options.environment ?? "evaluation";

  const runViolations: Violation[] = [...(options.violations ?? [])];
  if (runtimeFingerprint !== declaredFingerprint) runViolations.push({ gate: "H6", caseId: null, explanation: "Runtime-fingeraftrykket matcher ikke den evaluerede konfiguration." });
  if (environment !== "evaluation") runViolations.push({ gate: "H7", caseId: null, explanation: `Kørslen er ikke foretaget i evalueringsmiljøet (miljø: "${environment}").` });

  const metrics = computeMetrics(cases);
  const comparison: RerankerComparison = {
    available: true,
    withReranker: { passage_recall_at_k: metrics.passage_recall_at_k.value, mrr_at_k: metrics.mrr_at_k.value },
    withoutReranker: options.withoutReranker ?? { passage_recall_at_k: metrics.passage_recall_at_k.value, mrr_at_k: metrics.mrr_at_k.value },
  };
  const violations = [...runViolations, ...cases.flatMap((entry) => entry.violations)];
  const hardGates = evaluateHardGates(violations);
  const qualityGates = evaluateQualityGates(metrics, comparison, gates);
  const minimums = checkTypeMinimums(cases);
  const decision = decide(hardGates, qualityGates, minimums);
  const errors = cases.filter((entry) => entry.error !== null);
  const valid = decision.valid && errors.length === 0;
  const failures: Failure[] = [
    ...violations.map((violation) => ({ caseId: violation.caseId, gate: violation.gate, explanation: violation.explanation, rootCauseNote: null })),
    ...caseQualityFailures(cases),
  ];
  const byType = Object.fromEntries(CASE_TYPES.map((type) => [type, cases.filter((entry) => entry.type === type).length])) as Record<CaseType, number>;
  const results = {
    metrics,
    rerankerComparison: comparison,
    hardGates,
    qualityGates,
    minimums,
    tier: tierFor(cases.length),
    verdict: valid ? decision.verdict : ("fail" as const),
    valid,
    invalidReasons: [...decision.invalidReasons, ...(errors.length > 0 ? [`Retrieval fejlede for ${errors.length} spørgsmål.`] : [])],
    failures,
    cases,
  };
  const startedAt = options.startedAt ?? "2026-10-05T08:00:00.000Z";
  const report: EvaluationReport = {
    reportSchema: REPORT_SCHEMA_VERSION,
    kind: "retrieval-evaluation",
    engine: ENGINE_VERSION,
    runId: options.runId ?? "f6000000-0000-4000-8000-0000000000aa",
    startedAt,
    finishedAt: startedAt.replace("08:00:00", "08:05:00"),
    evalSet: {
      setId: "fixture-pilot",
      version: 1,
      caseSchema: 1,
      checksum: "c".repeat(64),
      activeCases: cases.length,
      retiredCases: 0,
      byType,
      bySplit: { dev: cases.length, holdout: 0 },
    },
    gateSet: { id: gates.id, version: gates.version, decision: gates.decision, k: gates.k, checksum: gateSetChecksum(gates) },
    configuration: {
      label: options.label ?? "fixture-bedrock",
      adapter: "fixture-evaluation",
      environment,
      declared,
      declaredFingerprint,
      runtime,
      runtimeFingerprint,
      matches: declaredFingerprint === runtimeFingerprint,
    },
    corpus: { checksumBefore: "d".repeat(64), checksumAfter: "d".repeat(64), documentTypes: [...new Set(options.documentTypes ?? ["terms"])].sort() },
    ...results,
    verdict: results.verdict,
    production: { eligible: false, reason: NOT_PRODUCTION_REASON },
    checksums: { results: checksumOf(results), report: "" },
  };
  report.checksums.report = reportChecksum(report);
  return report;
}

/** Re-seals a report after a change, as a forger with a text editor would. */
export function reseal(report: EvaluationReport): EvaluationReport {
  const rest = report;
  const results = {
    metrics: rest.metrics,
    rerankerComparison: rest.rerankerComparison,
    hardGates: rest.hardGates,
    qualityGates: rest.qualityGates,
    minimums: rest.minimums,
    tier: rest.tier,
    verdict: rest.verdict,
    valid: rest.valid,
    invalidReasons: rest.invalidReasons,
    failures: rest.failures,
    cases: rest.cases,
  };
  const sealed: EvaluationReport = { ...structuredClone(report), checksums: { results: checksumOf(results), report: "" } };
  sealed.checksums.report = reportChecksum(sealed);
  return sealed;
}
