import type { Embedder } from "./embedding.ts";
import type { Grade } from "./grade.ts";
import { assessProduction, PRODUCTION_CONDITIONS, PRODUCTION_SCHEMA_VERSION, type ProductionAssessment, type ProductionCondition } from "./production-conditions.ts";
import type { RetrievalParams } from "./provider.ts";
import type { RetrievalContext } from "./retrieval-context.ts";
import { NONE_RERANKER_ID, type RankReason, type Reranker } from "./reranker.ts";

/**
 * The evidence model (docs/07 §10) and the evidence-grade guardrail (docs/07 §9.1, B-18).
 *
 * An EvidenceSet is versioned (`schemaVersion`) and never contains storage paths, internal
 * file names or anything about other users' access. Its `grade` is DERIVED here, at every
 * retrieval, from P1–P9 (docs/08b §9, production-conditions.ts) — a request, a column, a
 * setting or an administrator cannot set it.
 *
 *   * `issueEvidenceSet` is the only way to create an EvidenceSet that the guard accepts. It
 *     assesses P1–P9, deep-freezes the set and records it with its assessment, so a copy, a
 *     hand-built object or a mutation is never production evidence. Only retrieval-core.ts
 *     calls it (guardrail test).
 *   * `requireProductionEvidence` is the only way to obtain a ProductionEvidenceSet (branded
 *     type). It requires the recorded assessment to have met all of P1–P9 and checks P2, P7, P8
 *     and P9 again on the set itself. A production model accepts only ProductionEvidenceSet
 *     (B-012, enforced in src/lib/ai/core/invoke.ts).
 *
 * Schema version 2 (D-14, docs/07 §10 K-4): `retrieval.configuration = { id, fingerprint,
 * algorithmVersion }` and the chunker version of every item (P7).
 */

export const EVIDENCE_SCHEMA_VERSION = PRODUCTION_SCHEMA_VERSION;

export type RetrievalMode = "current" | "as_of";
export type TemporalStatus = "current" | "historical" | "future";

/** The fixed text of the neutral conflict indicator (docs/07 §11.4, B-20). */
export const RESTRICTED_CONFLICT_MESSAGE = "Der findes en konflikt mellem kilder, som ikke er fuldt synlig for denne bruger.";

export interface EvidenceQuery {
  text: string;
  mode: RetrievalMode;
  /** The date the validity filter used: today (Danish time) for `current`, the chosen date for `as_of`. */
  asOf: string;
  language: string;
  filters: { productIds?: string[]; documentIds?: string[]; documentTypes?: string[] };
}

export interface EvidenceRetrieval {
  /** Derived from P1–P9 for this set. Never an input. */
  grade: Grade;
  embeddingModel: { id: string; grade: Grade } | null;
  reranker: { id: string; version: string; grade: Grade };
  /** The retrieval configuration in service (P9), or null when there is none. */
  configuration: { id: string; fingerprint: string; algorithmVersion: string } | null;
  /** The conditions P1–P9 that were not met. Empty exactly when the grade is production. */
  unmet: ProductionCondition[];
  candidateCount: number;
  generatedAt: string;
  /** Set only by the development tool that forces "insufficient" (B-009). Never production evidence. */
  devOverride?: "force_insufficient";
}

export type EvidenceConflict =
  | { visibility: "visible"; conflictId: string; status: "open"; counterpartEvidenceId: string }
  | { visibility: "restricted"; message: typeof RESTRICTED_CONFLICT_MESSAGE };

export interface EvidenceItem {
  evidenceId: string;
  documentId: string;
  documentVersionId: string;
  /** The first chunk of the item; `chunkIds` lists every chunk when neighbours were merged. */
  chunkId: string;
  chunkIds: string[];
  chunkIndex: number;
  /** The chunker version of the item's document version (all its chunks share it). P7. */
  chunkerVersion: string | null;
  product: { id: string; name: string };
  document: { title: string; type: string; versionLabel: string | null; language: string };
  location: { pageStart: number; pageEnd: number; sectionNumber: string | null; heading: string | null; headingPath: string[] };
  /** `text` is the source's own text, exactly [char_start, char_end). `leadIn` is context, not part of the quote (B-005). */
  excerpt: { text: string; leadIn: string | null };
  validity: { validFrom: string | null; validTo: string | null; temporalStatus: TemporalStatus };
  authority: { status: "published"; authoritative: true; approvedAt: string | null; supersededBy: string | null; withdrawn: false };
  relevance: { score: number; rank: number; fusedScore: number; vectorScore: number | null; lexicalScore: number | null; reasons: RankReason[] };
  conflicts: EvidenceConflict[];
  sourceReference: { label: string; sourceType: string };
}

export interface EvidenceSignals {
  itemCount: number;
  topScore: number | null;
  hasConflicts: boolean;
  hasHistorical: boolean;
}

export interface EvidenceSet {
  readonly schemaVersion: typeof EVIDENCE_SCHEMA_VERSION;
  readonly query: EvidenceQuery;
  readonly retrieval: EvidenceRetrieval;
  readonly items: readonly EvidenceItem[];
  readonly signals: EvidenceSignals;
}

declare const productionEvidence: unique symbol;

/** Evidence a later AI module may use. Obtainable ONLY through requireProductionEvidence. */
export type ProductionEvidenceSet = EvidenceSet & { readonly [productionEvidence]: true };

export class EvidenceGradeError extends Error {
  constructor(reason: string) {
    super(`Evidensen kan ikke bruges som produktionsevidens: ${reason}`);
    this.name = "EvidenceGradeError";
  }
}

export interface IssueEvidenceInput {
  query: EvidenceQuery;
  /** The embedder that embedded the query and the active model's id, or null when no model is active. */
  embedding: { embedder: Embedder; modelId: string } | null;
  reranker: Reranker;
  /** knowledge.retrieval_context(), read with the client that searched. Null = unknown. */
  context: RetrievalContext | null;
  /** The algorithm version of the code that ran, and the parameters it actually used. */
  algorithmVersion: string;
  params: RetrievalParams;
  candidateCount: number;
  generatedAt: string;
  items: EvidenceItem[];
  /** Development tool only (B-009): the set was forced empty; retrieval did not run. */
  devOverride?: "force_insufficient";
}

const issued = new WeakMap<object, ProductionAssessment>();

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Builds, assesses (P1–P9), freezes and records an EvidenceSet. The grade is derived — never an input. */
export function issueEvidenceSet(input: IssueEvidenceInput): EvidenceSet {
  const items = structuredClone(input.items);
  const query = structuredClone(input.query);
  const assessment = assessProduction({
    context: input.context,
    embedding: input.embedding,
    reranker: input.reranker,
    algorithmVersion: input.algorithmVersion,
    params: input.params,
    query,
    items,
    devOverride: Boolean(input.devOverride),
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
  });
  const embedder = input.embedding?.embedder ?? null;
  const scores = items.map((item) => item.relevance.score);
  const set: EvidenceSet = {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    query,
    retrieval: {
      grade: assessment.grade,
      embeddingModel: embedder ? { id: embedder.id, grade: embedder.grade } : null,
      reranker: { id: input.reranker.id, version: input.reranker.version, grade: input.reranker.grade },
      configuration: assessment.configuration ? { ...assessment.configuration } : null,
      unmet: [...assessment.unmet],
      candidateCount: input.candidateCount,
      generatedAt: input.generatedAt,
      ...(input.devOverride ? { devOverride: input.devOverride } : {}),
    },
    items,
    signals: {
      itemCount: items.length,
      topScore: scores.length > 0 ? Math.max(...scores) : null,
      hasConflicts: items.some((item) => item.conflicts.length > 0),
      hasHistorical: items.some((item) => item.validity.temporalStatus === "historical"),
    },
  };
  deepFreeze(set);
  issued.set(set, assessment);
  return set;
}

/**
 * The only way to obtain a ProductionEvidenceSet (docs/07 §9.1 point 4, docs/08b §9). Throws
 * unless the set was issued by the retrieval layer with all of P1–P9 met, and checks P2, P7, P8
 * and P9 again on the set as it is now: a production reranker other than "none", every item's
 * chunker version within the configuration's evaluated set, no development override, and
 * `retrieval.configuration` with the configuration's id, fingerprint and algorithm version
 * under schemaVersion 2.
 */
export function requireProductionEvidence(set: EvidenceSet): ProductionEvidenceSet {
  const assessment = issued.get(set);
  if (!assessment) throw new EvidenceGradeError("den er ikke udstedt af retrieval-laget.");
  if (set.retrieval.devOverride) throw new EvidenceGradeError("den er fremtvunget af et udviklingsværktøj.");
  if (set.retrieval.grade !== "production") throw new EvidenceGradeError(`evidensgraden er "${set.retrieval.grade}" (ikke opfyldt: ${set.retrieval.unmet.join(", ") || "ukendt"}).`);
  if (assessment.grade !== "production" || !PRODUCTION_CONDITIONS.every((condition) => assessment.conditions[condition])) {
    throw new EvidenceGradeError("P1–P9 er ikke alle opfyldt.");
  }
  // P2
  if (set.retrieval.reranker.id === NONE_RERANKER_ID || set.retrieval.reranker.grade !== "production") {
    throw new EvidenceGradeError(`rerankeren "${set.retrieval.reranker.id}" er ikke en produktionsreranker.`);
  }
  // P9
  const configuration = set.retrieval.configuration;
  if (
    set.schemaVersion !== PRODUCTION_SCHEMA_VERSION || !configuration || !assessment.configuration ||
    configuration.id !== assessment.configuration.id || configuration.fingerprint !== assessment.configuration.fingerprint ||
    configuration.algorithmVersion !== assessment.configuration.algorithmVersion || !/^[0-9a-f]{64}$/.test(configuration.fingerprint)
  ) {
    throw new EvidenceGradeError("sættet bærer ikke den aktive retrieval-konfiguration (retrieval.configuration).");
  }
  // P7
  if (!set.items.every((item) => typeof item.chunkerVersion === "string" && assessment.chunkerVersions.includes(item.chunkerVersion))) {
    throw new EvidenceGradeError("et element stammer fra en chunker-version, konfigurationen ikke er evalueret med.");
  }
  return set as ProductionEvidenceSet;
}

/** "Titel, version 3, §4.2, side 12" — the source card's reference (docs/04 §17.1). */
export function sourceReferenceLabel(parts: {
  title: string;
  versionLabel: string | null;
  sectionNumber: string | null;
  heading: string | null;
  pageStart: number;
  pageEnd: number;
}): string {
  const section = parts.sectionNumber ? `§${parts.sectionNumber}` : parts.heading;
  const pages = parts.pageStart === parts.pageEnd ? `side ${parts.pageStart}` : `side ${parts.pageStart}–${parts.pageEnd}`;
  return [parts.title, parts.versionLabel ? `version ${parts.versionLabel}` : null, section, pages].filter(Boolean).join(", ");
}
