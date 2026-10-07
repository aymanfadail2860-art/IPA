import { checksumOf, configurationFingerprint, gateSetChecksum } from "./checksum.ts";
import { checkTypeMinimums, decide, evaluateHardGates, evaluateQualityGates, tierFor } from "./gates.ts";
import { computeMetrics } from "./metrics.ts";
import { REPORT_SCHEMA_VERSION, reportChecksum, type EvaluationReport } from "./runner.ts";
import { HARD_GATE_IDS, type GateSet, type HardGateId, type Violation } from "./types.ts";

/**
 * The separation between an evaluation RUN and a PUBLISHED evaluation result (docs/08b §4.5,
 * D-7, D-18).
 *
 * A report is a file anyone can write. It only becomes a published result when the separate
 * identity `evaluation_publisher` registers it through `knowledge.record_evaluation_run`
 * (8B-I6). Both sides re-verify it:
 *
 *   * here, before anything is sent: verifyForPublication recomputes every metric from the
 *     report's own observations, every gate from the gate set, and checks checksums, the
 *     fingerprint, the environment and that no development implementation is involved;
 *   * in the database, independently: record_evaluation_run recomputes checksums, fingerprints,
 *     metrics, gates, minimums, tier and verdict in SQL and refuses anything that does not add
 *     up. An administrator can neither insert nor change a run.
 *
 * Publishing never approves or activates a configuration — that takes a human with
 * system.settings.manage (§10.2). The connection runs as evaluation_publisher_login and is
 * injected (D-19: the postgres driver lives only in workers/; CI passes its own client).
 */

declare const published: unique symbol;

/** A run registered by evaluation_publisher. Obtainable ONLY from an EvaluationPublisher. */
export type PublishedEvaluationRun = { readonly runId: string; readonly reportChecksum: string; readonly registeredAt: string } & {
  readonly [published]: true;
};

export interface EvaluationPublisher {
  /**
   * Registers a report as a published run. An implementation MUST run as the
   * evaluation_publisher identity, re-verify the report with verifyForPublication and refuse it
   * on any problem. It never approves or activates a configuration — that takes a human (§10.2).
   */
  publish(report: EvaluationReport, gates: GateSet): Promise<PublishedEvaluationRun>;
}

export class PublisherUnavailableError extends Error {
  constructor() {
    super("Der er ingen forbindelse som evaluation_publisher. En evalueringskørsel kan ikke publiceres eller registreres.");
    this.name = "PublisherUnavailableError";
  }
}

export class PublicationRefusedError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Rapporten kan ikke publiceres: ${problems.join(" ")}`);
    this.name = "PublicationRefusedError";
    this.problems = problems;
  }
}

/** Without a connection as evaluation_publisher, nothing can be published. */
export const unavailablePublisher: EvaluationPublisher = Object.freeze({
  async publish(): Promise<PublishedEvaluationRun> {
    throw new PublisherUnavailableError();
  },
});

/** The two database functions evaluation_publisher may call — nothing else. */
export interface PublisherConnection {
  /** knowledge.register_evaluation_gate_set (idempotent). Returns the gate set's id. */
  registerGateSet(gates: GateSet): Promise<string>;
  /** knowledge.record_evaluation_run. Returns the registered run's id and time. */
  recordRun(report: EvaluationReport): Promise<{ id: string; registeredAt: string }>;
}

/** The minimal SQL client the connection needs (e.g. postgres.js `sql.unsafe`). */
export interface SqlClient {
  unsafe(query: string, parameters?: unknown[]): PromiseLike<readonly Record<string, unknown>[]>;
}

export function sqlPublisherConnection(sql: SqlClient): PublisherConnection {
  return Object.freeze({
    async registerGateSet(gates: GateSet) {
      const rows = await sql.unsafe("select knowledge.register_evaluation_gate_set($1::text::jsonb) as id", [JSON.stringify(gates)]);
      return String(rows[0]?.id);
    },
    async recordRun(report: EvaluationReport) {
      const rows = await sql.unsafe("select knowledge.record_evaluation_run($1::text::jsonb) as id, now() as registered_at", [JSON.stringify(report)]);
      const registeredAt = rows[0]?.registered_at;
      return { id: String(rows[0]?.id), registeredAt: registeredAt instanceof Date ? registeredAt.toISOString() : String(registeredAt) };
    },
  });
}

/** The publisher (8B-I6): verify here, then register as evaluation_publisher, where it is verified again. */
export function createEvaluationPublisher(connection: PublisherConnection): EvaluationPublisher {
  return Object.freeze({
    async publish(report: EvaluationReport, gates: GateSet): Promise<PublishedEvaluationRun> {
      const verification = verifyForPublication(report, gates);
      if (!verification.ok) throw new PublicationRefusedError(verification.problems);
      await connection.registerGateSet(gates);
      const row = await connection.recordRun(report);
      return Object.freeze({ runId: row.id, reportChecksum: report.checksums.report, registeredAt: row.registeredAt }) as PublishedEvaluationRun;
    },
  });
}

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
  if (report.production.eligible !== false) problems.push("En rapport kan aldrig selv erklære sig production-egnet.");
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

/** A configuration with the test embedder or the "none" reranker can never be approved (§3.4, §10.2). */
export function isDevelopmentConfiguration(configuration: EvaluationReport["configuration"]["declared"]): boolean {
  return configuration.embedding === null || configuration.embedding.provider === "test" || configuration.reranker.id === "none" || configuration.reranker.model === "none";
}

/**
 * verifyReport plus what publication requires: the current report format, an unchanged result
 * checksum, the evaluation environment, a runtime that is exactly the declared configuration,
 * the evaluated corpus's document types, and no development implementation. A development or
 * fixture report can therefore never be published as a production approval.
 */
const SCOPE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A scope entry: the product's stable id (the identity), its name then (a snapshot), a document type (8B-I6.2). */
function validScopeEntry(entry: unknown): boolean {
  if (typeof entry !== "object" || entry === null) return false;
  const { productId, productName, documentType } = entry as Record<string, unknown>;
  return (
    Object.keys(entry).sort().join(",") === "documentType,productId,productName" &&
    typeof productId === "string" && SCOPE_UUID.test(productId) &&
    typeof productName === "string" && productName.length > 0 && productName.trim() === productName &&
    typeof documentType === "string" && documentType.length > 0
  );
}

export function verifyForPublication(report: EvaluationReport, gates: GateSet): VerificationResult {
  const verified = verifyReport(report, gates);
  const problems = verified.ok ? [] : [...verified.problems];
  if (report.reportSchema !== REPORT_SCHEMA_VERSION || report.kind !== "retrieval-evaluation") problems.push(`Rapporten har ikke formatet reportSchema ${REPORT_SCHEMA_VERSION}.`);
  const results = {
    metrics: report.metrics,
    rerankerComparison: report.rerankerComparison,
    hardGates: report.hardGates,
    qualityGates: report.qualityGates,
    minimums: report.minimums,
    tier: report.tier,
    verdict: report.verdict,
    valid: report.valid,
    invalidReasons: report.invalidReasons,
    failures: report.failures,
    cases: report.cases,
  };
  if (report.checksums.results !== checksumOf(results)) problems.push("Resultaternes checksum stemmer ikke.");
  if (report.configuration.environment !== "evaluation") problems.push(`Kørslen er ikke foretaget i evalueringsmiljøet (miljø: "${report.configuration.environment}").`);
  if (configurationFingerprint(report.configuration.declared) !== report.configuration.declaredFingerprint) problems.push("Det erklærede fingeraftryk stemmer ikke med konfigurationen.");
  if (configurationFingerprint(report.configuration.runtime) !== report.configuration.runtimeFingerprint) problems.push("Runtime-fingeraftrykket stemmer ikke med runtime-konfigurationen.");
  if (!report.configuration.matches || report.configuration.declaredFingerprint !== report.configuration.runtimeFingerprint) problems.push("Runtime er ikke den erklærede konfiguration.");
  if (isDevelopmentConfiguration(report.configuration.declared)) problems.push("Konfigurationen bruger en udviklingsimplementering (test-embedder eller \"none\").");
  const types = report.corpus.documentTypes;
  if (!Array.isArray(types) || types.length === 0 || types.join("\u0000") !== [...new Set(types)].sort().join("\u0000")) problems.push("Korpussets dokumenttyper mangler.");
  if (report.corpus.checksumBefore !== report.corpus.checksumAfter) problems.push("Korpusset ændrede sig under kørslen.");
  const scope = report.corpus.scope;
  if (!Array.isArray(scope) || scope.length === 0 || scope.some((entry) => !validScopeEntry(entry)) || new Set(scope.map((entry) => `${entry.productId}\u0000${entry.documentType}`)).size !== scope.length) {
    problems.push("Det evaluerede område (produkter og dokumenttyper) mangler.");
  } else if (Array.isArray(types) && [...new Set(scope.map((entry) => entry.documentType))].sort().join("\u0000") !== types.join("\u0000")) {
    problems.push("Dokumenttyperne stemmer ikke med det evaluerede område.");
  }
  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}
