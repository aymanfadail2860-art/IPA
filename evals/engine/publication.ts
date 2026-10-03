import { checksumOf, gateSetChecksum } from "./checksum.ts";
import { checkTypeMinimums, decide, evaluateHardGates, evaluateQualityGates, tierFor } from "./gates.ts";
import { computeMetrics } from "./metrics.ts";
import { reportChecksum, type EvaluationReport } from "./runner.ts";
import { HARD_GATE_IDS, type GateSet, type HardGateId, type Violation } from "./types.ts";

/**
 * The separation between an evaluation RUN and a PUBLISHED evaluation result (docs/08b §4.5,
 * D-7, D-18).
 *
 * A report is a file anyone can write. It only becomes a published result when the separate
 * identity `evaluation_publisher` registers it through `knowledge.record_evaluation_run`, which
 * recomputes every gate from the report's own observations and refuses a report that does not
 * add up. An administrator can neither insert nor change a run.
 *
 * 8B-I1 implements the CONTRACT and the recomputation, not the identity: the database role,
 * `knowledge.evaluation_runs` and the SQL function belong with the configuration register
 * (docs/08b §10, §20 step 3) and are deferred to that step. Until then there is no publisher,
 * and nothing can obtain a PublishedEvaluationRun.
 */

declare const published: unique symbol;

/** A run registered by evaluation_publisher. Obtainable ONLY from an EvaluationPublisher. */
export type PublishedEvaluationRun = { readonly runId: string; readonly reportChecksum: string; readonly registeredAt: string } & {
  readonly [published]: true;
};

export interface EvaluationPublisher {
  /**
   * Registers a report as a published run. An implementation MUST run as the
   * evaluation_publisher identity, re-verify the report with verifyReport and refuse it on any
   * problem. It never approves or activates a configuration — that takes a human (§10.2).
   */
  publish(report: EvaluationReport, gates: GateSet): Promise<PublishedEvaluationRun>;
}

export class PublisherUnavailableError extends Error {
  constructor() {
    super("Der findes ingen evaluation_publisher endnu (8B-I1). En evalueringskørsel kan ikke publiceres eller registreres.");
    this.name = "PublisherUnavailableError";
  }
}

/** The only publisher in 8B-I1: it refuses everything. */
export const unavailablePublisher: EvaluationPublisher = Object.freeze({
  async publish(): Promise<PublishedEvaluationRun> {
    throw new PublisherUnavailableError();
  },
});

export type VerificationResult = { ok: true } | { ok: false; problems: string[] };

/**
 * Recomputes a report from its own observations and the gate set it names, and lists every
 * discrepancy. This is the logic `knowledge.record_evaluation_run` must mirror. A report whose
 * verdict, gates, metrics or checksums were edited by hand does not verify.
 */
export function verifyReport(report: EvaluationReport, gates: GateSet): VerificationResult {
  const problems: string[] = [];
  const same = (a: unknown, b: unknown) => checksumOf(a) === checksumOf(b);

  if (report.checksums.report !== reportChecksum(report)) problems.push("Rapportens checksum stemmer ikke med indholdet.");
  if (gateSetChecksum(gates) !== report.gateSet.checksum) problems.push("Rapporten er ikke lavet med dette gate-sæt.");
  if (report.production.eligible !== false) problems.push("En rapport fra 8B-I1 kan aldrig være production-egnet.");
  if (report.configuration.declaredFingerprint !== report.configuration.runtimeFingerprint && report.configuration.matches) {
    problems.push("Rapporten påstår, at fingeraftrykkene matcher, men det gør de ikke.");
  }

  const metrics = computeMetrics(report.cases);
  if (!same(metrics, report.metrics)) problems.push("Metrikkerne kan ikke genberegnes fra observationerne.");
  const { withReranker } = report.rerankerComparison;
  if (withReranker.passage_recall_at_k !== metrics.passage_recall_at_k.value || withReranker.mrr_at_k !== metrics.mrr_at_k.value) {
    problems.push("Sammenligningen med kørslen uden reranker bruger andre tal end metrikkerne.");
  }

  const isHard = (gate: string): gate is HardGateId => (HARD_GATE_IDS as readonly string[]).includes(gate);
  const caseViolations = report.cases.flatMap((observation) => observation.violations);
  const runViolations: Violation[] = report.failures
    .filter((failure) => failure.caseId === null && isHard(failure.gate))
    .map((failure) => ({ gate: failure.gate as HardGateId, caseId: null, explanation: failure.explanation }));
  const reportedHard = report.failures.filter((failure) => isHard(failure.gate)).length;
  if (reportedHard !== caseViolations.length + runViolations.length) problems.push("Bruddene på de hårde gates stemmer ikke med observationerne.");

  const hardGates = evaluateHardGates([...runViolations, ...caseViolations]);
  if (!same(hardGates, report.hardGates)) problems.push("De hårde gates kan ikke genberegnes.");
  const qualityGates = evaluateQualityGates(metrics, report.rerankerComparison, gates);
  if (!same(qualityGates, report.qualityGates)) problems.push("Kvalitetsgates kan ikke genberegnes med gate-sættet.");
  const minimums = checkTypeMinimums(report.cases);
  if (!same(minimums, report.minimums)) problems.push("Minimum pr. type kan ikke genberegnes.");
  if (report.evalSet.activeCases !== report.cases.length) problems.push("Antallet af spørgsmål stemmer ikke med observationerne.");
  if (tierFor(report.cases.length) !== report.tier) problems.push("Tier stemmer ikke med antallet af spørgsmål.");

  const decision = decide(hardGates, qualityGates, minimums);
  const errors = report.cases.filter((observation) => observation.error !== null).length;
  const valid = decision.valid && errors === 0;
  const verdict = valid ? decision.verdict : "fail";
  if (report.valid !== valid || report.verdict !== verdict) problems.push(`Afgørelsen stemmer ikke: rapporten siger "${report.verdict}", genberegnet "${verdict}".`);

  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}
