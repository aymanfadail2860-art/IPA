import type { EvidenceSet } from "../../src/lib/knowledge/core/evidence.ts";
import type { RetrievalFingerprintMaterial } from "../../src/lib/knowledge/core/provider.ts";

/**
 * Retrieval evaluation (docs/08b §4–§5, 8B-I1). Types shared by the engine.
 *
 * The engine measures retrieval, not answers. It is development and CI tooling: it lives
 * outside src/, is never imported by the application, never writes to a database and cannot
 * make any evidence or configuration production grade (docs/08b §9, §10).
 */

// ---------------------------------------------------------------------------------------------
// Evaluation set (schema v1, docs/08b §5.2–§5.6)
// ---------------------------------------------------------------------------------------------

export const CASE_SCHEMA_VERSION = 1;
export const MANIFEST_SCHEMA_VERSION = 1;

export const CASE_TYPES = ["direct", "multi_chunk", "historical", "conflict", "unanswerable", "distractor", "permission", "filter"] as const;
export type CaseType = (typeof CASE_TYPES)[number];

export const CASE_MODES = ["current", "as_of"] as const;
export const CASE_OUTCOMES = ["evidence", "insufficient"] as const;
export const CASE_SPLITS = ["dev", "holdout"] as const;
export const PASSAGE_GRADES = [1, 2, 3] as const;

export interface DocumentRef {
  document: string;
  /** Omitted: every version of the document. */
  version?: string;
}

export interface ExpectedPassage {
  document: string;
  version: string;
  /** A short verbatim text from the source. Never a chunk id (docs/08b §5.4). */
  anchor: string;
  grade: 1 | 2 | 3;
}

export interface EvalCase {
  id: string;
  schema: typeof CASE_SCHEMA_VERSION;
  type: CaseType;
  question: string;
  language: string;
  /** An evaluation identity from the manifest (docs/08b §5.5). */
  actor: string;
  mode: "current" | "as_of";
  /** YYYY-MM-DD, only with mode "as_of". */
  asOf?: string;
  filters?: { products?: string[]; documents?: string[]; documentTypes?: string[] };
  expected: {
    outcome: "evidence" | "insufficient";
    passages: ExpectedPassage[];
    temporalStatus?: "current" | "historical";
    /** Versions that are invalid for this case. A hit is a validity breach (H3). */
    mustNotInclude?: DocumentRef[];
    /** Both parties of an open conflict that must be returned and marked. */
    conflict?: { documents: [string, string] } | null;
    /** Documents the actor must not see (asserted against the manifest's grants). */
    permissions?: { forbiddenDocuments: string[] };
    /** Look-alike documents that must not intrude (Q6). */
    distractors?: DocumentRef[];
  };
  split: "dev" | "holdout";
  tags?: string[];
  author: string;
  created: string;
  /** Why the case exists and what the facit rests on. */
  notes: string;
  retired?: boolean;
  retiredReason?: string;
}

export interface ManifestVersion {
  label: string;
  validFrom: string | null;
  validTo: string | null;
  status: "published" | "withdrawn";
}

export interface ManifestDocument {
  key: string;
  title: string;
  type: string;
  product: string;
  language: string;
  fictional: boolean;
  /** Where the text comes from: a fixture file in the repo, or a public source by URL + checksum. */
  source: { kind: "fixture"; path: string } | { kind: "public"; url: string; sha256: string; licence: string };
  versions: ManifestVersion[];
}

export interface ManifestActor {
  id: string;
  description: string;
  grants: { document: string; historical: boolean }[];
}

export interface Manifest {
  schema: typeof MANIFEST_SCHEMA_VERSION;
  setId: string;
  version: number;
  description: string;
  /** `id`: the product's stable id in the platform (knowledge.products.id, B-031). Required in the evaluation environment. */
  products: { key: string; name: string; id?: string }[];
  documents: ManifestDocument[];
  actors: ManifestActor[];
  conflicts: { id: string; documents: [string, string]; status: "open" | "resolved" }[];
}

export interface EvalSet {
  manifest: Manifest;
  cases: EvalCase[];
}

// ---------------------------------------------------------------------------------------------
// Gate set (docs/08b §4.4). Only Q1–Q7 thresholds are data. H1–H7 are code (hard-gates.ts).
// ---------------------------------------------------------------------------------------------

export const QUALITY_GATE_IDS = ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7"] as const;
export type QualityGateId = (typeof QUALITY_GATE_IDS)[number];

export const HARD_GATE_IDS = ["H1", "H2", "H3", "H4", "H5", "H6", "H7"] as const;
export type HardGateId = (typeof HARD_GATE_IDS)[number];

export type Comparator = ">=" | "<=" | "not_lower";

export interface QualityGateSpec {
  metric: MetricId;
  comparator: Comparator;
  /** Absent only for Q7, which compares against the run without the reranker. */
  threshold?: number;
}

export interface GateSet {
  id: string;
  version: number;
  /** The decision that approved this gate set (docs/decisions.md). */
  decision: string;
  k: number;
  quality: Record<QualityGateId, QualityGateSpec>;
}

// ---------------------------------------------------------------------------------------------
// Configuration under evaluation (docs/08b §10.1). Provider and model are data.
// ---------------------------------------------------------------------------------------------

/**
 * The fingerprint material of a retrieval configuration, as the provider contract defines it
 * (src/lib/knowledge/core/provider.ts, 8B-I2): embedding and reranker with provider, model,
 * our version label, dimensions, processing profile and settings; algorithm version;
 * parameters; chunker versions.
 */
export type ConfigurationInput = RetrievalFingerprintMaterial;

// ---------------------------------------------------------------------------------------------
// The retrieval under test
// ---------------------------------------------------------------------------------------------

/** Runtime identities of the manifest's keys, as the retrieval under test knows them. */
export interface CorpusBinding {
  products: Record<string, string>;
  documents: Record<string, { documentId: string; title: string; versions: Record<string, string> }>;
  conflicts: Record<string, string>;
}

export interface RetrievalRun {
  /** The evaluation identity the retrieval actually ran as. Must be the case's actor (H7). */
  actor: string;
  set: EvidenceSet;
  /** The retrieval layer's raw result, if the adapter has one — also searched for leaks (H2). */
  raw?: unknown;
  /** chunk id → chunker version, for P7/H6. Missing entries count as uncovered (fail-closed). */
  chunkerVersions: Record<string, string>;
}

export interface RetrievalUnderTest {
  /** Human-readable name of the adapter, e.g. "fixture". */
  readonly name: string;
  /** Where it runs. Only "evaluation" satisfies H7; everything else makes the run invalid. */
  readonly environment: "evaluation" | "fixture";
  /** The configuration as actually constructed — the runtime fingerprint is computed from this. */
  configuration(): ConfigurationInput;
  binding(): CorpusBinding;
  /** The normalized text of a document version, for anchor validation (docs/08b §5.4). */
  versionText(document: string, version: string): string | null;
  /** Checksum of the corpus the adapter serves, read anew on every call. Compared before and after the run (H7). */
  corpusChecksum(): string | Promise<string>;
  run(evalCase: EvalCase): Promise<RetrievalRun>;
  /** The same retrieval without reranking, for Q7. Null when it cannot be produced. */
  withoutReranker(): RetrievalUnderTest | null;
}

// ---------------------------------------------------------------------------------------------
// Observations, metrics and results
// ---------------------------------------------------------------------------------------------

export interface Violation {
  gate: HardGateId;
  caseId: string | null;
  explanation: string;
}

/** What the engine observed for one case. Enough to recompute every metric (publication.ts). */
export interface CaseObservation {
  caseId: string;
  type: CaseType;
  split: "dev" | "holdout";
  outcome: "evidence" | "insufficient";
  itemCount: number;
  empty: boolean;
  /** 1-based rank of the first item from an expected document version, or null. */
  sourceRank: number | null;
  /** 1-based rank of the first item covering any grade-3 passage, or null. */
  firstGrade3Rank: number | null;
  /**
   * The required passages (grade 3) covered within K, as a set: the order of passages in the
   * facit never matters. Passage Recall needs all of them (docs/08b §4.2, 8B-I2 correction).
   */
  requiredCovered: number;
  requiredTotal: number;
  /** Grades by rank (for nDCG). */
  gainsByRank: number[];
  idealGains: number[];
  /** Items within K, and how many come from a distractor document. */
  itemsWithinK: number;
  distractorItems: number;
  violations: Violation[];
  error: string | null;
}

export const METRIC_IDS = [
  "source_recall_at_k",
  "passage_recall_at_k",
  "mrr_at_k",
  "correct_abstention",
  "false_abstention",
  "distractor_intrusion",
  "reranker_uplift",
] as const;
export type MetricId = (typeof METRIC_IDS)[number];

export interface Interval {
  lower: number;
  upper: number;
}

export interface MetricValue {
  value: number | null;
  numerator: number | null;
  denominator: number;
  /** Wilson 95 % interval, for proportions only. */
  interval: Interval | null;
}

export interface Metrics {
  source_recall_at_k: MetricValue;
  passage_recall_at_k: MetricValue;
  mrr_at_k: MetricValue;
  correct_abstention: MetricValue;
  false_abstention: MetricValue;
  distractor_intrusion: MetricValue;
  /** Reported, not gated (D-5). */
  informational: {
    source_recall_at_1: MetricValue;
    source_recall_at_3: MetricValue;
    full_coverage_at_k: MetricValue;
    ndcg_at_k: MetricValue;
  };
}

export interface RerankerComparison {
  available: boolean;
  withReranker: { passage_recall_at_k: number | null; mrr_at_k: number | null };
  withoutReranker: { passage_recall_at_k: number | null; mrr_at_k: number | null };
}

export type GateStatus = "pass" | "fail";

export interface HardGateResult {
  id: HardGateId;
  status: GateStatus;
  violations: number;
}

export interface QualityGateResult {
  id: QualityGateId;
  metric: MetricId;
  comparator: Comparator;
  threshold: number | null;
  value: number | null;
  status: GateStatus;
  /** The confidence interval crosses the threshold (docs/08b §4.4, pilot rule 4). */
  uncertain: boolean;
  explanation: string;
}

export type Verdict = "pass" | "fail" | "uncertain";
export type Tier = "pilot" | "standard";
