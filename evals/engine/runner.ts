import { randomUUID } from "node:crypto";

import { checksumOf, configurationFingerprint, evalSetChecksum, gateSetChecksum } from "./checksum.ts";
import { checkTypeMinimums, decide, evaluateHardGates, evaluateQualityGates, tierFor, type MinimumResult } from "./gates.ts";
import { computeMetrics, coversAllRequired } from "./metrics.ts";
import { normalizeText, observeCase, type ObservationContext } from "./observe.ts";
import { EvalSetError, type SchemaError } from "./schema.ts";
import type {
  CaseObservation,
  CaseType,
  ConfigurationInput,
  EvalCase,
  EvalSet,
  GateSet,
  HardGateResult,
  Metrics,
  QualityGateResult,
  RerankerComparison,
  RetrievalUnderTest,
  Tier,
  Verdict,
  Violation,
} from "./types.ts";
import { CASE_TYPES } from "./types.ts";

/**
 * The evaluation run (docs/08b §4.5, 8B-I1). Takes a validated set, a validated gate set, the
 * configuration declared for evaluation and the retrieval under test, and produces a report.
 *
 * The report is data. Nothing here writes to a database, registers a run or changes any
 * configuration. A report never declares itself production eligible (`production.eligible` is
 * always false): only evaluation_publisher can register it, and only a human can then approve
 * and activate the configuration (publication.ts, docs/08b §10).
 */

/**
 * 2: Passage Recall uses the required passages as a set (no primaryPassageRank).
 * 3: the evaluated corpus names its document types (corpus.documentTypes) — the scope an
 *    approval is valid for (docs/08b §9, §4.4 pilot rule 5; 8B-I6).
 */
export const REPORT_SCHEMA_VERSION = 3;
export const ENGINE_VERSION = "8B-I6/3";

export interface Failure {
  caseId: string | null;
  gate: string;
  explanation: string;
  /** A written root-cause note is required for every failure before an approval (pilot rule 3). */
  rootCauseNote: null;
}

export interface EvaluationReport {
  reportSchema: typeof REPORT_SCHEMA_VERSION;
  kind: "retrieval-evaluation";
  engine: string;
  runId: string;
  startedAt: string;
  finishedAt: string;
  evalSet: {
    setId: string;
    version: number;
    caseSchema: number;
    checksum: string;
    activeCases: number;
    retiredCases: number;
    byType: Record<CaseType, number>;
    bySplit: { dev: number; holdout: number };
  };
  gateSet: { id: string; version: number; decision: string; k: number; checksum: string };
  configuration: {
    label: string;
    adapter: string;
    environment: string;
    declared: ConfigurationInput;
    declaredFingerprint: string;
    runtime: ConfigurationInput;
    runtimeFingerprint: string;
    matches: boolean;
  };
  /** The evaluated corpus: its checksum before and after the run, and its document types (sorted). */
  corpus: { checksumBefore: string; checksumAfter: string; documentTypes: string[] };
  metrics: Metrics;
  rerankerComparison: RerankerComparison;
  hardGates: HardGateResult[];
  qualityGates: QualityGateResult[];
  minimums: MinimumResult[];
  tier: Tier;
  verdict: Verdict;
  valid: boolean;
  invalidReasons: string[];
  failures: Failure[];
  cases: CaseObservation[];
  production: { eligible: false; reason: string };
  checksums: { results: string; report: string };
}

export interface RunOptions {
  set: EvalSet;
  gates: GateSet;
  /** The configuration that is being evaluated, as declared (e.g. a file under configurations/). */
  declared: { label: string; configuration: ConfigurationInput };
  retrieval: RetrievalUnderTest;
  now?: () => Date;
  runId?: string;
  /** Re-checks the inputs on disk at the end of the run (H7). Returns a reason, or null. */
  verifyInputsUnchanged?: () => string | null;
}

export const NOT_PRODUCTION_REASON =
  "En rapport er data og erklærer aldrig sig selv production-egnet. Kun evaluation_publisher kan registrere den (knowledge.record_evaluation_run), og kun et menneske med system.settings.manage kan derefter godkende og aktivere konfigurationen. Evidensens grad afgøres af P1–P9 ved hvert retrieval (docs/08b §9–§10).";

/** Every expected anchor must occur exactly once in its version (docs/08b §5.4). */
export function validateAnchors(set: EvalSet, retrieval: RetrievalUnderTest): void {
  const errors: SchemaError[] = [];
  for (const evalCase of set.cases) {
    if (evalCase.retired) continue;
    evalCase.expected.passages.forEach((passage, i) => {
      const path = `${evalCase.id}.expected.passages[${i}]`;
      const text = retrieval.versionText(passage.document, passage.version);
      if (text === null) {
        errors.push({ path, message: `teksten til ${passage.document} v${passage.version} er ikke tilgængelig, så ankret kan ikke efterprøves` });
        return;
      }
      const haystack = normalizeText(text);
      const anchor = normalizeText(passage.anchor);
      const first = haystack.indexOf(anchor);
      if (first === -1) errors.push({ path, message: `ankret findes ikke i ${passage.document} v${passage.version}` });
      else if (haystack.indexOf(anchor, first + 1) !== -1) errors.push({ path, message: `ankret findes flere gange i ${passage.document} v${passage.version} — gør det længere` });
    });
  }
  if (errors.length > 0) throw new EvalSetError(errors);
}

function errorObservation(evalCase: EvalCase, error: string): CaseObservation {
  // Worst case for every metric: an answerable question found nothing, an unanswerable one did
  // not abstain. A failing retrieval can never improve a number.
  return {
    caseId: evalCase.id,
    type: evalCase.type,
    split: evalCase.split,
    outcome: evalCase.expected.outcome,
    itemCount: 0,
    empty: evalCase.expected.outcome === "evidence",
    sourceRank: null,
    firstGrade3Rank: null,
    requiredCovered: 0,
    requiredTotal: evalCase.expected.passages.filter((passage) => passage.grade === 3).length,
    gainsByRank: [],
    idealGains: evalCase.expected.passages.map((passage) => passage.grade as number).sort((a, b) => b - a),
    itemsWithinK: 0,
    distractorItems: 0,
    violations: [],
    error,
  };
}

function contextFor(retrieval: RetrievalUnderTest, set: EvalSet, gates: GateSet, configuration: ConfigurationInput): ObservationContext {
  const texts = new Map<string, string | null>();
  return {
    manifest: set.manifest,
    binding: retrieval.binding(),
    configuration,
    k: gates.k,
    versionText(document, version) {
      const key = `${document}\u0000${version}`;
      if (!texts.has(key)) {
        const text = retrieval.versionText(document, version);
        texts.set(key, text === null ? null : normalizeText(text));
      }
      return texts.get(key)!;
    },
  };
}

async function observeAll(cases: readonly EvalCase[], retrieval: RetrievalUnderTest, context: ObservationContext): Promise<CaseObservation[]> {
  const observations: CaseObservation[] = [];
  for (const evalCase of cases) {
    try {
      const run = await retrieval.run(evalCase);
      const observation = observeCase(evalCase, run, context);
      if (run.actor !== evalCase.actor) {
        observation.violations.push({ gate: "H7", caseId: evalCase.id, explanation: `Retrieval kørte som "${run.actor}", ikke som evalueringsbrugeren "${evalCase.actor}".` });
      }
      observations.push(observation);
    } catch (error) {
      observations.push(errorObservation(evalCase, error instanceof Error ? error.message : String(error)));
    }
  }
  return observations;
}

export async function runEvaluation(options: RunOptions): Promise<EvaluationReport> {
  const now = options.now ?? (() => new Date());
  const { set, gates, retrieval } = options;
  const startedAt = now().toISOString();

  const setChecksum = evalSetChecksum(set);
  const gatesChecksum = gateSetChecksum(gates);
  const corpusBefore = retrieval.corpusChecksum();
  validateAnchors(set, retrieval);

  const declaredFingerprint = configurationFingerprint(options.declared.configuration);
  const runtime = retrieval.configuration();
  const runtimeFingerprint = configurationFingerprint(runtime);
  const runViolations: Violation[] = [];

  // H6 on run level: the retrieval that runs must be exactly the configuration declared.
  if (runtimeFingerprint !== declaredFingerprint) {
    runViolations.push({ gate: "H6", caseId: null, explanation: `Runtime-fingeraftrykket (${runtimeFingerprint.slice(0, 12)}…) matcher ikke den evaluerede konfiguration (${declaredFingerprint.slice(0, 12)}…).` });
  }
  // H7: isolation. Only the evaluation environment counts.
  if (retrieval.environment !== "evaluation") {
    runViolations.push({ gate: "H7", caseId: null, explanation: `Kørslen er ikke foretaget i evalueringsmiljøet (miljø: "${retrieval.environment}").` });
  }

  const active = set.cases.filter((evalCase) => !evalCase.retired);
  const context = contextFor(retrieval, set, gates, options.declared.configuration);
  const observations = await observeAll(active, retrieval, context);

  // Q7: the same answerable questions without the reranker.
  const answerable = active.filter((evalCase) => evalCase.expected.outcome === "evidence");
  const baseline = retrieval.withoutReranker();
  let comparison: RerankerComparison;
  const metrics = computeMetrics(observations);
  if (baseline) {
    const baselineObservations = await observeAll(answerable, baseline, { ...context, configuration: baseline.configuration() });
    const baselineMetrics = computeMetrics(baselineObservations);
    comparison = {
      available: baselineObservations.every((observation) => observation.error === null),
      withReranker: { passage_recall_at_k: metrics.passage_recall_at_k.value, mrr_at_k: metrics.mrr_at_k.value },
      withoutReranker: { passage_recall_at_k: baselineMetrics.passage_recall_at_k.value, mrr_at_k: baselineMetrics.mrr_at_k.value },
    };
  } else {
    comparison = {
      available: false,
      withReranker: { passage_recall_at_k: metrics.passage_recall_at_k.value, mrr_at_k: metrics.mrr_at_k.value },
      withoutReranker: { passage_recall_at_k: null, mrr_at_k: null },
    };
  }

  // H7: integrity. Nothing the run depends on may change while it runs.
  const corpusAfter = retrieval.corpusChecksum();
  if (corpusAfter !== corpusBefore) runViolations.push({ gate: "H7", caseId: null, explanation: "Korpussets checksum ændrede sig under kørslen." });
  if (evalSetChecksum(set) !== setChecksum) runViolations.push({ gate: "H7", caseId: null, explanation: "Evalueringssættet ændrede sig under kørslen." });
  if (gateSetChecksum(gates) !== gatesChecksum) runViolations.push({ gate: "H7", caseId: null, explanation: "Gate-sættet ændrede sig under kørslen." });
  const changedOnDisk = options.verifyInputsUnchanged?.() ?? null;
  if (changedOnDisk) runViolations.push({ gate: "H7", caseId: null, explanation: changedOnDisk });

  const violations = [...runViolations, ...observations.flatMap((observation) => observation.violations)];
  const hardGates = evaluateHardGates(violations);
  const qualityGates = evaluateQualityGates(metrics, comparison, gates);
  const minimums = checkTypeMinimums(observations);
  const decision = decide(hardGates, qualityGates, minimums);
  const errors = observations.filter((observation) => observation.error !== null);
  const invalidReasons = [...decision.invalidReasons];
  if (errors.length > 0) invalidReasons.push(`Retrieval fejlede for ${errors.length} spørgsmål.`);
  const valid = decision.valid && errors.length === 0;
  const verdict: Verdict = valid ? decision.verdict : "fail";

  const failures: Failure[] = [
    ...violations.map((violation) => ({ caseId: violation.caseId, gate: violation.gate, explanation: violation.explanation, rootCauseNote: null })),
    ...errors.map((observation) => ({ caseId: observation.caseId, gate: "retrieval", explanation: `Retrieval fejlede: ${observation.error}`, rootCauseNote: null })),
    ...caseQualityFailures(observations),
  ];

  const byType = Object.fromEntries(CASE_TYPES.map((type) => [type, active.filter((evalCase) => evalCase.type === type).length])) as Record<CaseType, number>;
  const results = {
    metrics,
    rerankerComparison: comparison,
    hardGates,
    qualityGates,
    minimums,
    tier: tierFor(active.length),
    verdict,
    valid,
    invalidReasons,
    failures,
    cases: observations,
  };

  const report: Omit<EvaluationReport, "checksums"> & { checksums: { results: string; report: string } } = {
    reportSchema: REPORT_SCHEMA_VERSION,
    kind: "retrieval-evaluation",
    engine: ENGINE_VERSION,
    runId: options.runId ?? randomUUID(),
    startedAt,
    finishedAt: now().toISOString(),
    evalSet: {
      setId: set.manifest.setId,
      version: set.manifest.version,
      caseSchema: 1,
      checksum: setChecksum,
      activeCases: active.length,
      retiredCases: set.cases.length - active.length,
      byType,
      bySplit: { dev: active.filter((evalCase) => evalCase.split === "dev").length, holdout: active.filter((evalCase) => evalCase.split === "holdout").length },
    },
    gateSet: { id: gates.id, version: gates.version, decision: gates.decision, k: gates.k, checksum: gatesChecksum },
    configuration: {
      label: options.declared.label,
      adapter: retrieval.name,
      environment: retrieval.environment,
      declared: options.declared.configuration,
      declaredFingerprint,
      runtime,
      runtimeFingerprint,
      matches: declaredFingerprint === runtimeFingerprint,
    },
    corpus: { checksumBefore: corpusBefore, checksumAfter: corpusAfter, documentTypes: corpusDocumentTypes(set) },
    ...results,
    production: { eligible: false, reason: NOT_PRODUCTION_REASON },
    checksums: { results: checksumOf(results), report: "" },
  };
  report.checksums.report = reportChecksum(report);
  return report;
}

/** The document types of the evaluated corpus (the manifest's documents), sorted and unique. */
export function corpusDocumentTypes(set: EvalSet): string[] {
  return [...new Set(set.manifest.documents.map((document) => document.type))].sort();
}

/** The report checksum covers everything except the checksum itself. */
export function reportChecksum(report: EvaluationReport): string {
  return checksumOf({ ...report, checksums: { results: report.checksums.results } });
}

/** Per-question explanations of quality misses, so every failure can be read one by one. */
export function caseQualityFailures(observations: readonly CaseObservation[]): Failure[] {
  const failures: Failure[] = [];
  for (const observation of observations) {
    if (observation.error !== null) continue;
    const add = (gate: string, explanation: string) => failures.push({ caseId: observation.caseId, gate, explanation, rootCauseNote: null });
    if (observation.outcome === "evidence") {
      if (observation.empty) add("Q5", "Besvarbart spørgsmål gav et tomt resultat (falsk afvisning).");
      else {
        if (observation.sourceRank === null) add("Q1", "Ingen forventet dokumentversion blandt de første K elementer.");
        if (!coversAllRequired(observation)) add("Q2", `${observation.requiredCovered} af ${observation.requiredTotal} påkrævede passager (grad 3) er dækket blandt de første K elementer.`);
      }
    } else if (!observation.empty) {
      add("Q4", `Spørgsmålet skulle give "utilstrækkeligt grundlag", men gav ${observation.itemCount} element(er).`);
    }
    if (observation.distractorItems > 0) add("Q6", `${observation.distractorItems} af ${observation.itemsWithinK} elementer kommer fra en distraktor.`);
  }
  return failures;
}
