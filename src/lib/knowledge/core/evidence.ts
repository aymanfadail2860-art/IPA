import { combinedGrade, type Grade } from "./grade.ts";
import { NONE_RERANKER_ID, type RankReason } from "./reranker.ts";

/**
 * The evidence model (docs/07 §10) and the evidence-grade guardrail (docs/07 §9.1, B-18).
 *
 * An EvidenceSet is versioned (`schemaVersion`) and never contains storage paths, internal
 * file names or anything about other users' access. Its `grade` is computed here from the
 * implementations that actually produced it — a request cannot set it.
 *
 *   * `issueEvidenceSet` is the only way to create an EvidenceSet that the guard accepts. It
 *     deep-freezes the set and records it, so a copy, a hand-built object or a mutation is
 *     never production evidence. Only retrieval-core.ts calls it (guardrail test).
 *   * `requireProductionEvidence` is the only way to obtain a ProductionEvidenceSet (branded
 *     type). It throws for development grade and for the "none" reranker. Later AI modules
 *     and the AI Gateway accept only ProductionEvidenceSet.
 */

export const EVIDENCE_SCHEMA_VERSION = 1;

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
  grade: Grade;
  embeddingModel: { id: string; grade: Grade } | null;
  reranker: { id: string; version: string; grade: Grade };
  candidateCount: number;
  generatedAt: string;
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

interface Implementation {
  readonly id: string;
  readonly grade: Grade;
}

export interface IssueEvidenceInput {
  query: EvidenceQuery;
  /** The embedder that embedded the query, or null when no embedding model is active. */
  embedder: Implementation | null;
  reranker: Implementation & { readonly version: string };
  candidateCount: number;
  generatedAt: string;
  items: EvidenceItem[];
}

const issued = new WeakSet<object>();

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Builds, freezes and records an EvidenceSet. The grade is derived — never an input. */
export function issueEvidenceSet(input: IssueEvidenceInput): EvidenceSet {
  const embeddingGrade: Grade = input.embedder?.grade ?? "development";
  const items = structuredClone(input.items);
  const scores = items.map((item) => item.relevance.score);
  const set: EvidenceSet = {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    query: structuredClone(input.query),
    retrieval: {
      grade: input.embedder ? combinedGrade(input.embedder.grade, input.reranker.grade) : "development",
      embeddingModel: input.embedder ? { id: input.embedder.id, grade: embeddingGrade } : null,
      reranker: { id: input.reranker.id, version: input.reranker.version, grade: input.reranker.grade },
      candidateCount: input.candidateCount,
      generatedAt: input.generatedAt,
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
  issued.add(set);
  return set;
}

/**
 * The only way to obtain a ProductionEvidenceSet (docs/07 §9.1 point 4). Throws unless the set
 * was issued by the retrieval layer, its grade is production — which requires a production
 * embedding model AND a production reranker — and the reranker is not "none".
 */
export function requireProductionEvidence(set: EvidenceSet): ProductionEvidenceSet {
  if (!issued.has(set)) throw new EvidenceGradeError("den er ikke udstedt af retrieval-laget.");
  if (set.retrieval.grade !== "production") throw new EvidenceGradeError(`evidensgraden er "${set.retrieval.grade}".`);
  if (set.retrieval.reranker.id === NONE_RERANKER_ID) throw new EvidenceGradeError(`rerankeren "${NONE_RERANKER_ID}" er ikke en produktionsreranker.`);
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
