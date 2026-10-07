import type { Embedder, EmbeddingProvider } from "./embedding.ts";
import type { EvidenceItem, EvidenceQuery } from "./evidence.ts";
import type { Grade } from "./grade.ts";
import { isProductionImplementation } from "./production-implementation.ts";
import { retrievalFingerprint, retrievalFingerprintMaterial, type RetrievalParams } from "./provider.ts";
import type { ApprovedScope, RetrievalContext } from "./retrieval-context.ts";
import { NONE_RERANKER_ID, type Reranker, type RerankingProvider } from "./reranker.ts";

/**
 * P1–P9 — when an EvidenceSet is production grade (docs/08b §9, B-020). The single source of
 * truth for the grade:
 *
 *   grade = production  ⇔  P1 ∧ P2 ∧ P3 ∧ P4 ∧ P5 ∧ P6 ∧ P7 ∧ P8 ∧ P9
 *   otherwise development — a condition that cannot be decided is false (fail-closed)
 *
 * Every condition is decided from what actually happened in this call: the implementations that
 * were constructed (not what they claim), the database's retrieval context read with the same
 * client that searched, the parameters actually used and the items actually returned. Nothing a
 * caller passes in a request, no column, setting or environment variable can set the grade.
 */

export const PRODUCTION_CONDITIONS = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9"] as const;
export type ProductionCondition = (typeof PRODUCTION_CONDITIONS)[number];

/** The evidence model version that carries `retrieval.configuration` and per-item chunker versions (D-14). */
export const PRODUCTION_SCHEMA_VERSION = 2;

export interface ProductionAssessmentInput {
  /** knowledge.retrieval_context() as read by this call; null when it could not be read. */
  context: RetrievalContext | null;
  embedding: { embedder: Embedder; modelId: string } | null;
  reranker: Reranker;
  /** The algorithm version of the code that ran (retrieval-core.ts). */
  algorithmVersion: string;
  /** The parameters actually used, including a per-request topK. */
  params: RetrievalParams;
  query: EvidenceQuery;
  items: readonly EvidenceItem[];
  devOverride: boolean;
  schemaVersion: number;
}

export interface ProductionAssessment {
  readonly grade: Grade;
  readonly conditions: Readonly<Record<ProductionCondition, boolean>>;
  readonly unmet: readonly ProductionCondition[];
  /** Fingerprint of the runtime: the implementations, algorithm and parameters that ran (P4). */
  readonly runtimeFingerprint: string | null;
  /** The configuration in service, as the set carries it (P9). */
  readonly configuration: { readonly id: string; readonly fingerprint: string; readonly algorithmVersion: string } | null;
  /** The configuration's evaluated chunker versions (P7), kept for the re-check. */
  readonly chunkerVersions: readonly string[];
}

const HEX64 = /^[0-9a-f]{64}$/;

const descriptorOf = <T extends object>(implementation: unknown): T | null =>
  typeof implementation === "object" && implementation !== null && "descriptor" in implementation ? ((implementation as { descriptor: T }).descriptor ?? null) : null;

/** Undecidable is false: a throwing check never makes a condition true. */
function decide(check: () => boolean): boolean {
  try {
    return check() === true;
  } catch {
    return false;
  }
}

/** The evaluated chunker versions, copied; unreadable → none (so P7 can never be met). */
function evaluatedChunkerVersions(versions: readonly string[] | undefined): readonly string[] {
  try {
    return Object.freeze([...(versions ?? [])]);
  } catch {
    return Object.freeze([]);
  }
}

/**
 * Does the approved area cover this item? For pilot the product's stable id and the document type
 * must be an evaluated pair — the name is never compared, so a renamed product stays covered and
 * a new product with an evaluated product's name does not (8B-I6.2). Fail-closed: no tier or an
 * empty scope covers nothing.
 */
export function withinApprovedScope(item: EvidenceItem, scope: ApprovedScope): boolean {
  if (scope.tier === "pilot") return scope.entries.some((entry) => entry.productId === item.product.id && entry.documentType === item.document.type);
  if (scope.tier === "standard") return scope.documentTypes.includes(item.document.type);
  return false;
}

function withinValidity(item: EvidenceItem, date: string): boolean {
  const { validFrom, validTo } = item.validity;
  return (validFrom === null || validFrom <= date) && (validTo === null || date < validTo);
}

export function assessProduction(input: ProductionAssessmentInput): ProductionAssessment {
  const context = input.context;
  const configuration = context?.configuration ?? null;
  const embedder = input.embedding?.embedder ?? null;
  const embeddingDescriptor = descriptorOf<EmbeddingProvider["descriptor"]>(embedder);
  const rerankerDescriptor = descriptorOf<RerankingProvider["descriptor"]>(input.reranker);

  let runtimeFingerprint: string | null = null;
  if (embeddingDescriptor && rerankerDescriptor && configuration) {
    try {
      runtimeFingerprint = retrievalFingerprint(
        retrievalFingerprintMaterial({
          embedding: embeddingDescriptor,
          reranker: rerankerDescriptor,
          algorithmVersion: input.algorithmVersion,
          params: input.params,
          chunkerVersions: configuration.chunkerVersions,
        }),
      );
    } catch {
      runtimeFingerprint = null;
    }
  }

  const conditions: Record<ProductionCondition, boolean> = {
    // P1: a production embedder (a real production implementation), whose model is the active
    // model, which is the configuration's model.
    P1: decide(() => {
      const model = context?.activeModel;
      return (
        input.embedding !== null && embedder !== null && embeddingDescriptor !== null && model !== null && model !== undefined && configuration !== null &&
        isProductionImplementation(embedder) && embedder.grade === "production" && embeddingDescriptor.grade === "production" &&
        model.id === input.embedding.modelId && configuration.embeddingModelId === model.id &&
        embeddingDescriptor.provider === model.provider && embeddingDescriptor.model === model.model_name &&
        embeddingDescriptor.modelVersion === model.model_version && embeddingDescriptor.dimensions === model.dimensions &&
        embedder.dimensions === model.dimensions
      );
    }),
    // P2: a production reranker, never "none", and the configuration's reranker.
    P2: decide(
      () =>
        rerankerDescriptor !== null && configuration !== null &&
        isProductionImplementation(input.reranker) && input.reranker.grade === "production" && rerankerDescriptor.grade === "production" &&
        input.reranker.id !== NONE_RERANKER_ID && rerankerDescriptor.id === input.reranker.id && rerankerDescriptor.version === input.reranker.version &&
        input.reranker.id === configuration.rerankerId && input.reranker.version === configuration.rerankerVersion,
    ),
    // P3: exactly one active configuration with a passed (for pilot: a human-accepted) registered
    // evaluation, not suspended — and the evaluation covers every item (8B-I6.1, B-030): for tier
    // pilot the evaluated pairs of product and document type, for standard the document types.
    P3: decide(
      () =>
        configuration !== null && configuration.status === "active" && configuration.productionReady && configuration.notReady.length === 0 &&
        configuration.evaluation !== null && configuration.evaluation.approved &&
        input.items.every((item) => withinApprovedScope(item, configuration.scope)),
    ),
    // P4: the runtime fingerprint is identical to the active configuration's.
    P4: decide(() => configuration !== null && runtimeFingerprint !== null && runtimeFingerprint === configuration.fingerprint),
    // P5: only published, non-withdrawn versions, valid for the mode on its date; one version per document.
    P5: decide(() => {
      const versions = new Map<string, string>();
      return input.items.every((item) => {
        const known = versions.get(item.documentId);
        if (known !== undefined && known !== item.documentVersionId) return false;
        versions.set(item.documentId, item.documentVersionId);
        return (
          item.authority.status === "published" && item.authority.withdrawn === false && item.authority.authoritative === true &&
          withinValidity(item, input.query.asOf) && item.validity.temporalStatus !== "future" &&
          (input.query.mode !== "current" || item.validity.temporalStatus === "current")
        );
      });
    }),
    // P6: the search ran as the signed-in user, through RLS and the access filter.
    P6: decide(() => context !== null && context.executedAs.role === "authenticated" && context.executedAs.userId !== null),
    // P7: every item's chunker version is among the configuration's evaluated versions.
    P7: decide(
      () => configuration !== null && input.items.every((item) => typeof item.chunkerVersion === "string" && configuration.chunkerVersions.includes(item.chunkerVersion)),
    ),
    // P8: not forced by a development tool (issued by the retrieval layer and frozen: evidence.ts).
    P8: !input.devOverride,
    // P9: the set carries the configuration's id, fingerprint and algorithm version (schema 2).
    P9: decide(
      () =>
        configuration !== null && input.schemaVersion === PRODUCTION_SCHEMA_VERSION && HEX64.test(configuration.fingerprint) &&
        configuration.algorithmVersion === input.algorithmVersion,
    ),
  };
  const unmet = PRODUCTION_CONDITIONS.filter((condition) => !conditions[condition]);
  return Object.freeze({
    grade: unmet.length === 0 ? "production" : "development",
    conditions: Object.freeze(conditions),
    unmet: Object.freeze(unmet),
    runtimeFingerprint,
    configuration: configuration
      ? Object.freeze({ id: configuration.id, fingerprint: configuration.fingerprint, algorithmVersion: configuration.algorithmVersion })
      : null,
    chunkerVersions: evaluatedChunkerVersions(configuration?.chunkerVersions),
  });
}
