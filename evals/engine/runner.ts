import { randomUUID } from "node:crypto";

import { retrievalMethodOf } from "../../src/lib/knowledge/core/provider.ts";

import { checksumOf, configurationFingerprint, evalSetChecksum, gateSetChecksum } from "./checksum.ts";
import {
  checkTypeMinimums,
  decide,
  evaluateDocumentGates,
  evaluateHardGates,
  evaluateQualityGates,
  LOCKED_DOCUMENT_GATES,
  qualityGateIds,
  tierFor,
  type MinimumResult,
} from "./gates.ts";
import { computeDocumentMetrics, computeMetrics, coversAllRequired, DOCUMENT_CASE_CHECKS } from "./metrics.ts";
import { normalizeText, observeCase, type ObservationContext } from "./observe.ts";
import { EvalSetError, type SchemaError } from "./schema.ts";
import type {
  CaseObservation,
  CaseType,
  ConfigurationInput,
  CorpusBinding,
  DocumentMetrics,
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
import { CASE_TYPES, DOCUMENT_GATE_IDS, gateSetMethod, isDocumentGateSet } from "./types.ts";

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
 * 4: the evaluated corpus names the pairs of product and document type it held (corpus.scope).
 *    A pilot approval is valid only for them (8B-I6.1, B-030).
 * 5: a scope entry identifies the product by its stable id; the name is a snapshot for people
 *    (8B-I6.2).
 * 6: the gate set names its retrieval method (gateSet.method; k is null for product_documents).
 *    A product_documents run is judged by D1–D6 on document metrics, every observation carries
 *    its document observation, and there is no reranker comparison (B-036).
 */
export const REPORT_SCHEMA_VERSION = 6;
export const ENGINE_VERSION = "beta-L1.1/6";

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
  gateSet: { id: string; version: number; decision: string; method: "hybrid" | "product_documents"; k: number | null; checksum: string };
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
  corpus: { checksumBefore: string; checksumAfter: string; documentTypes: string[]; scope: ScopeEntry[] };
  /** Q-metrics for the hybrid method, D-metrics for product_documents. */
  metrics: Metrics | DocumentMetrics;
  /** Null for product_documents: there is no reranker to compare with. */
  rerankerComparison: RerankerComparison | null;
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

/**
 * One evaluated area: a product and a document type. `productId` (the product's stable database
 * id) is the identity the approval binds to; `productName` is the name at evaluation time, kept
 * only so that people can read the report later (8B-I6.2).
 */
export interface ScopeEntry {
  documentType: string;
  productId: string;
  productName: string;
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

function errorObservation(evalCase: EvalCase, error: string, documents: boolean): CaseObservation {
  // Worst case for every metric: an answerable question found nothing, an unanswerable one did
  // not abstain. A failing retrieval can never improve a number.
  const observation: CaseObservation = {
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
  // product_documents: a failed retrieval delivered no basis — it meets no document requirement.
  if (documents) observation.documents = null;
  return observation;
}

function contextFor(retrieval: RetrievalUnderTest, set: EvalSet, gates: GateSet, configuration: ConfigurationInput): ObservationContext {
  const texts = new Map<string, string | null>();
  return {
    manifest: set.manifest,
    binding: retrieval.binding(),
    configuration,
    // product_documents ranks nothing: K is the whole set (B-036).
    k: isDocumentGateSet(gates) ? Number.MAX_SAFE_INTEGER : gates.k,
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

async function observeAll(cases: readonly EvalCase[], retrieval: RetrievalUnderTest, context: ObservationContext, documents = false): Promise<CaseObservation[]> {
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
      observations.push(errorObservation(evalCase, error instanceof Error ? error.message : String(error), documents));
    }
  }
  return observations;
}

/**
 * A gate set evaluates exactly one retrieval method (B-036): the Q-gates of 8B only the hybrid
 * method, D1–D6 only product_documents. A product_documents set needs exactly one product per
 * active case — the method's whole basis is that product. Refuses before anything runs.
 */
export function assertGateSetFits(set: EvalSet, gates: GateSet, configuration: ConfigurationInput): void {
  const gateMethod = gateSetMethod(gates);
  const configurationMethod = retrievalMethodOf(configuration);
  if (gateMethod !== configurationMethod) {
    throw new Error(`Gate-sættet ${gates.id} v${gates.version} gælder retrieval-metoden "${gateMethod}", men konfigurationen bruger "${configurationMethod}".`);
  }
  if (!isDocumentGateSet(gates)) return;
  const errors: SchemaError[] = [];
  const products = new Set(set.manifest.products.map((product) => product.key));
  for (const evalCase of set.cases) {
    if (evalCase.retired) continue;
    const named = evalCase.filters?.products ?? [];
    if (named.length !== 1 || !products.has(named[0]!)) errors.push({ path: `${evalCase.id}.filters.products`, message: "skal angive netop ét produkt fra manifestet (product_documents)" });
  }
  if (errors.length > 0) throw new EvalSetError(errors);
}

export async function runEvaluation(options: RunOptions): Promise<EvaluationReport> {
  const now = options.now ?? (() => new Date());
  const { set, gates, retrieval } = options;
  assertGateSetFits(set, gates, options.declared.configuration);
  const documentGates = isDocumentGateSet(gates);
  const startedAt = now().toISOString();

  const setChecksum = evalSetChecksum(set);
  const gatesChecksum = gateSetChecksum(gates);
  const corpusBefore = await retrieval.corpusChecksum();
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
  const observations = await observeAll(active, retrieval, context, documentGates);

  // Q7: the same answerable questions without the reranker. product_documents has none (B-036).
  const answerable = active.filter((evalCase) => evalCase.expected.outcome === "evidence");
  const baseline = documentGates ? null : retrieval.withoutReranker();
  let comparison: RerankerComparison | null;
  const metrics: Metrics | DocumentMetrics = documentGates ? computeDocumentMetrics(observations) : computeMetrics(observations);
  if (documentGates) {
    comparison = null;
  } else if (baseline) {
    const baselineObservations = await observeAll(answerable, baseline, { ...context, configuration: baseline.configuration() });
    const baselineMetrics = computeMetrics(baselineObservations);
    const own = metrics as Metrics;
    comparison = {
      available: baselineObservations.every((observation) => observation.error === null),
      withReranker: { passage_recall_at_k: own.passage_recall_at_k.value, mrr_at_k: own.mrr_at_k.value },
      withoutReranker: { passage_recall_at_k: baselineMetrics.passage_recall_at_k.value, mrr_at_k: baselineMetrics.mrr_at_k.value },
    };
  } else {
    const own = metrics as Metrics;
    comparison = {
      available: false,
      withReranker: { passage_recall_at_k: own.passage_recall_at_k.value, mrr_at_k: own.mrr_at_k.value },
      withoutReranker: { passage_recall_at_k: null, mrr_at_k: null },
    };
  }

  // H7: integrity. Nothing the run depends on may change while it runs.
  const corpusAfter = await retrieval.corpusChecksum();
  if (corpusAfter !== corpusBefore) runViolations.push({ gate: "H7", caseId: null, explanation: "Korpussets checksum ændrede sig under kørslen." });
  if (evalSetChecksum(set) !== setChecksum) runViolations.push({ gate: "H7", caseId: null, explanation: "Evalueringssættet ændrede sig under kørslen." });
  if (gateSetChecksum(gates) !== gatesChecksum) runViolations.push({ gate: "H7", caseId: null, explanation: "Gate-sættet ændrede sig under kørslen." });
  const changedOnDisk = options.verifyInputsUnchanged?.() ?? null;
  if (changedOnDisk) runViolations.push({ gate: "H7", caseId: null, explanation: changedOnDisk });

  const violations = [...runViolations, ...observations.flatMap((observation) => observation.violations)];
  const hardGates = evaluateHardGates(violations);
  const qualityGates = isDocumentGateSet(gates)
    ? evaluateDocumentGates(metrics as DocumentMetrics, gates)
    : evaluateQualityGates(metrics as Metrics, comparison!, gates);
  const minimums = checkTypeMinimums(observations);
  const decision = decide(hardGates, qualityGates, minimums, qualityGateIds(gates));
  const errors = observations.filter((observation) => observation.error !== null);
  const invalidReasons = [...decision.invalidReasons];
  if (errors.length > 0) invalidReasons.push(`Retrieval fejlede for ${errors.length} spørgsmål.`);
  const valid = decision.valid && errors.length === 0;
  const verdict: Verdict = valid ? decision.verdict : "fail";

  const failures: Failure[] = [
    ...violations.map((violation) => ({ caseId: violation.caseId, gate: violation.gate, explanation: violation.explanation, rootCauseNote: null })),
    ...errors.map((observation) => ({ caseId: observation.caseId, gate: "retrieval", explanation: `Retrieval fejlede: ${observation.error}`, rootCauseNote: null })),
    ...(documentGates ? documentQualityFailures(observations) : caseQualityFailures(observations)),
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
    gateSet: {
      id: gates.id,
      version: gates.version,
      decision: gates.decision,
      method: gateSetMethod(gates),
      k: isDocumentGateSet(gates) ? null : gates.k,
      checksum: gatesChecksum,
    },
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
    corpus: { checksumBefore: corpusBefore, checksumAfter: corpusAfter, documentTypes: corpusDocumentTypes(set), scope: corpusScope(set, retrieval.binding()) },
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The evaluated area: every pair of product and document type in the manifest, sorted by product
 * id and document type, unique. The product id comes from the corpus binding (the product's
 * database id); a product without a bound id makes the run fail instead of guessing.
 */
export function corpusScope(set: EvalSet, binding: CorpusBinding): ScopeEntry[] {
  const names = new Map(set.manifest.products.map((product) => [product.key, product.name]));
  const pairs = new Map<string, ScopeEntry>();
  for (const document of set.manifest.documents) {
    const productId = binding.products[document.product];
    if (typeof productId !== "string" || !UUID.test(productId)) throw new Error(`Produktet ${document.product} har intet id i korpusset; det evaluerede område kan ikke bestemmes.`);
    pairs.set(`${productId}\u0000${document.type}`, { documentType: document.type, productId, productName: names.get(document.product) ?? document.product });
  }
  return [...pairs.values()].sort((a, b) => compareScope(a, b));
}

/** Order of scope entries: product id, then document type (the same order the database uses). */
export function compareScope(a: Pick<ScopeEntry, "productId" | "documentType">, b: Pick<ScopeEntry, "productId" | "documentType">): number {
  if (a.productId !== b.productId) return a.productId < b.productId ? -1 : 1;
  return a.documentType < b.documentType ? -1 : a.documentType > b.documentType ? 1 : 0;
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

/** The document gates a case misses, by gate (B-036), so every miss can be read one by one. */
const DOCUMENT_GATE_BY_METRIC = Object.fromEntries(
  DOCUMENT_GATE_IDS.map((id) => [LOCKED_DOCUMENT_GATES[id].metric, id]),
) as Record<keyof typeof DOCUMENT_CASE_CHECKS, (typeof DOCUMENT_GATE_IDS)[number]>;

export function documentQualityFailures(observations: readonly CaseObservation[]): Failure[] {
  const failures: Failure[] = [];
  for (const observation of observations) {
    if (observation.error !== null || !observation.documents) continue;
    const documents = observation.documents;
    for (const [metric, check] of Object.entries(DOCUMENT_CASE_CHECKS) as [keyof typeof DOCUMENT_CASE_CHECKS, (typeof DOCUMENT_CASE_CHECKS)[keyof typeof DOCUMENT_CASE_CHECKS]][]) {
      if (check.answerableOnly && observation.outcome !== "evidence") continue;
      if (check.met(documents)) continue;
      failures.push({ caseId: observation.caseId, gate: DOCUMENT_GATE_BY_METRIC[metric], explanation: documentMiss(metric, documents), rootCauseNote: null });
    }
  }
  return failures;
}

function documentMiss(metric: keyof typeof DOCUMENT_CASE_CHECKS, d: NonNullable<CaseObservation["documents"]>): string {
  switch (metric) {
    case "required_document_coverage":
      return `${d.requiredDocumentsCovered} af ${d.requiredDocuments} kildeversioner fra facit er leveret.`;
    case "required_passage_coverage":
      return `${d.requiredPassagesCovered} af ${d.requiredPassages} påkrævede passager (grad 3) er leveret.`;
    case "full_document_integrity":
      return `${d.incompleteVersions} dokumentversion(er) er ikke leveret hele, i rækkefølge og uforkortet.`;
    case "valid_version_coverage":
      return `${d.missingVersions} gyldig(e) version(er) mangler, ${d.unexpectedVersions} uventet(e) er leveret.`;
    case "correct_product_scope":
      return `${d.productQueried ? "Produktet var rigtigt" : "Retrieval blev ikke spurgt om netop spørgsmålets produkt"}; ${d.foreignProductItems} element(er) fra et andet produkt.`;
    case "authorized_document_coverage":
      return `${d.missingDocuments} dokument(er), brugeren må læse, mangler; ${d.unexpectedDocuments} andre er leveret.`;
  }
}
