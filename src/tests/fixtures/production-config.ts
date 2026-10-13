import { userText } from "@/lib/egress/classification";
import type { EmbeddingProvider } from "@/lib/knowledge/core/embedding";
import type { EmbeddingProviderDescriptor, RerankingProviderDescriptor } from "@/lib/knowledge/core/provider";
import type { RerankingProvider } from "@/lib/knowledge/core/reranker";
import {
  documentRetrievalMaterial,
  retrievalFingerprint,
  retrievalFingerprintMaterial,
  retrievalMethodOf,
  type DocumentRetrievalMaterial,
  type HybridRetrievalMaterial,
  type RetrievalFingerprintMaterial,
} from "@/lib/knowledge/core/provider";
import {
  DEFAULT_DOCUMENT_RETRIEVAL_PARAMS,
  DEFAULT_RETRIEVAL_CONFIG,
  PRODUCT_DOCUMENTS_ALGORITHM_VERSION,
  RETRIEVAL_ALGORITHM_VERSION,
  type DocumentRow,
  type KnowledgeRpcClient,
  type SearchRow,
} from "@/lib/knowledge/retrieval-core";

/**
 * ⚠ TEST FIXTURE — retrieval configurations and the retrieval context the database would return
 * for them when they are active and approved (8B-I6, point 22). Everything is fictional; nothing
 * is activated in any real environment. Tests vary one thing at a time to show each of P1–P9
 * failing.
 *
 * Beta L2 (docs/beta.md §14): the Bedrock adapters are removed. The hybrid material below keeps
 * the descriptors they declared AS DATA, so the fingerprints and the pgTAP literals generated from
 * them stay byte-identical — but no implementation of them exists any more, so a hybrid set can
 * never be production evidence (fail-closed). Production evidence comes from product_documents.
 */

/** The descriptor the removed Embed v4 adapter declared (8B-I2) — data only, no implementation. */
const EMBED_V4_EU_1024_DESCRIPTOR: EmbeddingProviderDescriptor = Object.freeze({
  kind: "embedding" as const,
  provider: "aws-bedrock",
  model: "cohere.embed-v4:0",
  modelVersion: "eu-1024-v1",
  grade: "production" as const,
  dimensions: 1024,
  processing: Object.freeze({ kind: "geographic" as const, geography: "EU" as const, sourceRegion: "eu-central-1", inferenceProfile: "eu.cohere.embed-v4:0" }),
  inputTypes: "asymmetric" as const,
  settings: Object.freeze({
    embeddingType: "float",
    outputDimension: 1024,
    truncate: "NONE",
    inputTypeDocument: "search_document",
    inputTypeQuery: "search_query",
  }),
  limits: Object.freeze({ maxTextsPerRequest: 96, maxCharsPerText: 8_000, maxCharsPerRequest: 400_000 }),
});

/** The descriptor the removed Rerank 3.5 adapter declared (8B-I2) — data only, no implementation. */
const RERANK_35_DESCRIPTOR: RerankingProviderDescriptor = Object.freeze({
  kind: "reranking" as const,
  provider: "aws-bedrock",
  model: "cohere.rerank-v3-5:0",
  modelVersion: "euc1-v1",
  id: "aws-bedrock:cohere.rerank-v3-5:0",
  version: "euc1-v1",
  grade: "production" as const,
  processing: Object.freeze({ kind: "in_region" as const, region: "eu-central-1" }),
  settings: Object.freeze({ apiVersion: 2, topN: "all", document: "heading-path+text", ties: "candidate-order" }),
  limits: Object.freeze({ maxDocumentsPerRequest: 1000, maxCharsPerDocument: 8_000, maxQueryChars: 1000 }),
});

export const FIXTURE_MODEL = Object.freeze({
  id: "f6000000-0000-4000-8000-000000000001",
  provider: EMBED_V4_EU_1024_DESCRIPTOR.provider,
  model_name: EMBED_V4_EU_1024_DESCRIPTOR.model,
  model_version: EMBED_V4_EU_1024_DESCRIPTOR.modelVersion,
  dimensions: EMBED_V4_EU_1024_DESCRIPTOR.dimensions,
});
export const FIXTURE_CONFIGURATION_ID = "f6000000-0000-4000-8000-000000000002";
export const FIXTURE_CHUNKER_VERSION = "structure/1";
export const FIXTURE_USER = "f6000000-0000-4000-8000-000000000003";
/** A scope entry: the product's stable id, its name at evaluation time, a document type (8B-I6.2). */
export interface FixtureScopeEntry {
  documentType: string;
  productId: string;
  productName: string;
}
/** The fixture products (stable ids). */
export const FIXTURE_PRODUCT_ID = "fa000000-0000-4000-8000-000000000001";
export const FIXTURE_TEST_PRODUCT_ID = "fa000000-0000-4000-8000-000000000002";
/** The evaluated area of the fixture configuration: the fixture products' terms (8B-I6.1). */
export const FIXTURE_SCOPE: readonly FixtureScopeEntry[] = Object.freeze([
  { documentType: "terms", productId: FIXTURE_PRODUCT_ID, productName: "Fiktivt erhvervsansvar" },
  { documentType: "terms", productId: FIXTURE_TEST_PRODUCT_ID, productName: "Testprodukt (fiktiv)" },
]);

export function fixtureMaterial(overrides: Partial<HybridRetrievalMaterial> = {}): HybridRetrievalMaterial {
  return {
    ...retrievalFingerprintMaterial({
      embedding: EMBED_V4_EU_1024_DESCRIPTOR,
      reranker: RERANK_35_DESCRIPTOR,
      algorithmVersion: RETRIEVAL_ALGORITHM_VERSION,
      params: { ...DEFAULT_RETRIEVAL_CONFIG },
      chunkerVersions: [FIXTURE_CHUNKER_VERSION],
    }),
    ...overrides,
  };
}

/** product_documents material (B-035): no embedding, no reranker, the budget. */
export function fixtureDocumentMaterial(overrides: Partial<DocumentRetrievalMaterial> = {}): DocumentRetrievalMaterial {
  return {
    ...documentRetrievalMaterial({
      algorithmVersion: PRODUCT_DOCUMENTS_ALGORITHM_VERSION,
      params: { ...DEFAULT_DOCUMENT_RETRIEVAL_PARAMS },
      chunkerVersions: [FIXTURE_CHUNKER_VERSION],
    }),
    ...overrides,
  };
}

/**
 * ⚠ TEST DOUBLES that DECLARE the removed adapters' descriptors and production grade (beta L2).
 * They are never registered as production implementations (only a production adapter may do
 * that, and none exists), so a hybrid set built with them fails exactly P1 and P2 — and every
 * other condition (P3–P9) can still be shown to hold or fail one at a time. This is also the
 * proof that the hybrid method cannot issue production evidence in the beta.
 */
export function declaredProductionDoubles(): { embedder: EmbeddingProvider; reranker: RerankingProvider } {
  const vector = (text: string): number[] => {
    let seed = 0;
    for (const char of text) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
    return Array.from({ length: EMBED_V4_EU_1024_DESCRIPTOR.dimensions }, (_, i) => ((seed + i * 7919) % 1000) / 1000 - 0.5 || 0.001);
  };
  const embedder: EmbeddingProvider = Object.freeze({
    id: `${EMBED_V4_EU_1024_DESCRIPTOR.provider}:${EMBED_V4_EU_1024_DESCRIPTOR.model}@${EMBED_V4_EU_1024_DESCRIPTOR.modelVersion}`,
    grade: "production" as const,
    dimensions: EMBED_V4_EU_1024_DESCRIPTOR.dimensions,
    descriptor: EMBED_V4_EU_1024_DESCRIPTOR,
    embed: async (texts: readonly { text: string }[]) => texts.map((entry) => vector(entry.text)),
  });
  const reranker: RerankingProvider = Object.freeze({
    id: RERANK_35_DESCRIPTOR.id,
    version: RERANK_35_DESCRIPTOR.version,
    grade: "production" as const,
    descriptor: RERANK_35_DESCRIPTOR,
    rerank: async (input: { candidates: { chunkId: string }[]; topN: number }) => ({
      ranked: input.candidates.slice(0, Math.max(0, input.topN)).map((candidate, index) => ({
        chunkId: candidate.chunkId,
        score: Math.max(0, 0.95 - index * 0.05),
        rank: index + 1,
        reasons: [{ kind: "reranker_score" as const, score: Math.max(0, 0.95 - index * 0.05) }],
      })),
      reranker: { id: RERANK_35_DESCRIPTOR.id, version: RERANK_35_DESCRIPTOR.version },
    }),
  });
  return { embedder, reranker };
}

export interface ContextOverrides {
  role?: string;
  userId?: string | null;
  activeModel?: Record<string, unknown> | null;
  configuration?: Record<string, unknown> | null;
  material?: RetrievalFingerprintMaterial;
  status?: "active" | "suspended";
  productionReady?: boolean;
  notReady?: string[];
  passed?: boolean;
  /** Approving run's outcome (B-030); default "pass". */
  outcome?: "pass" | "pass_with_uncertainty" | "insufficient_certainty" | "fail";
  uncertaintyAccepted?: boolean;
  tier?: "pilot" | "standard";
  scope?: FixtureScopeEntry[];
}

/** knowledge.retrieval_context() as the database returns it for the fixture configuration. */
export function fixtureContext(overrides: ContextOverrides = {}): Record<string, unknown> {
  const material = overrides.material ?? fixtureMaterial();
  const configuration =
    overrides.configuration !== undefined
      ? overrides.configuration
      : {
          id: FIXTURE_CONFIGURATION_ID,
          label: "fixture-bedrock",
          version: 1,
          fingerprint: retrievalFingerprint(material),
          status: overrides.status ?? "active",
          material,
          method: retrievalMethodOf(material),
          embeddingModelId: material.reranker === null ? null : FIXTURE_MODEL.id,
          rerankerId: material.reranker === null ? null : material.reranker.id,
          rerankerVersion: material.reranker === null ? null : material.reranker.version,
          algorithmVersion: material.algorithmVersion,
          params: material.params,
          chunkerVersions: material.chunkerVersions,
          tier: overrides.tier ?? "pilot",
          evaluation: (() => {
            const outcome = overrides.outcome ?? (overrides.passed === false ? "fail" : "pass");
            const accepted = overrides.uncertaintyAccepted ?? false;
            return {
              runId: "f6000000-0000-4000-8000-000000000004",
              reportChecksum: "a".repeat(64),
              gateSetChecksum: "b".repeat(64),
              verdict: outcome === "pass" ? "pass" : outcome === "fail" ? "fail" : "uncertain",
              passed: outcome === "pass",
              outcome,
              // As knowledge.evaluation_run_approvable decides it.
              approved: outcome === "pass" || (outcome === "pass_with_uncertainty" && accepted),
              uncertaintyAccepted: accepted,
              uncertainGates: outcome === "pass" ? [] : ["Q1"],
              evaluatedDocumentTypes: [...new Set((overrides.scope ?? FIXTURE_SCOPE).map((entry) => entry.documentType))].sort(),
            };
          })(),
          scope: {
            tier: overrides.tier ?? "pilot",
            entries: (overrides.scope ?? FIXTURE_SCOPE).map((entry) => ({ ...entry })),
            documentTypes: [...new Set((overrides.scope ?? FIXTURE_SCOPE).map((entry) => entry.documentType))].sort(),
          },
          scopeGaps: [],
          productionReady: overrides.productionReady ?? (overrides.status !== "suspended" && (overrides.notReady ?? []).length === 0),
          notReady: overrides.notReady ?? (overrides.status === "suspended" ? ["suspended"] : []),
        };
  return {
    executedAs: { role: overrides.role ?? "authenticated", userId: overrides.userId === undefined ? FIXTURE_USER : overrides.userId },
    activeModel: overrides.activeModel === undefined ? { ...FIXTURE_MODEL } : overrides.activeModel,
    configuration,
  };
}

export function fixtureRow(n: number, overrides: Partial<SearchRow> = {}): SearchRow {
  return {
    chunk_id: `f7000000-0000-4000-8000-00000000000${n}`,
    chunk_index: n,
    kind: "prose",
    text: `Erhvervsansvar dækker skade på ting under reparation, punkt ${n} (fiktiv).`,
    lead_in: null,
    heading: `${n}. Dækning`,
    heading_path: [`${n}. Dækning`],
    section_number: `${n}`,
    page_start: 1,
    page_end: 1,
    char_start: 0,
    char_end: 60,
    overlap_chars: 0,
    version_id: `f8000000-0000-4000-8000-00000000000${n}`,
    version_label: "1",
    language: "da",
    valid_from: "2025-01-01",
    valid_to: null,
    approved_at: "2026-01-01T00:00:00Z",
    superseded_by: null,
    document_id: `f9000000-0000-4000-8000-00000000000${n}`,
    document_title: `Fiktive betingelser ${n}`,
    document_type: "terms",
    product_id: FIXTURE_PRODUCT_ID,
    product_name: "Fiktivt erhvervsansvar",
    source_type: "manual_upload",
    temporal_status: "current",
    vector_rank: n,
    vector_score: 0.9 - n / 100,
    lexical_rank: n,
    lexical_score: 0.5,
    lexical_terms: ["reparation"],
    chunker_version: FIXTURE_CHUNKER_VERSION,
    ...overrides,
  };
}

/**
 * A row of knowledge.product_document_chunks (B-035): chunk `index` of a version with `count`
 * chunks, in one fixture document of the fixture product. No ranking columns.
 */
export function fixtureDocumentRow(index: number, count: number, overrides: Partial<DocumentRow> = {}): DocumentRow {
  return {
    ...fixtureRow(1),
    chunk_id: `f7100000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    chunk_index: index,
    text: `Fiktive betingelser, afsnit ${index}: dækning, undtagelser og begrænsninger (fiktiv).`,
    heading: `${index}. Afsnit`,
    heading_path: [`${index}. Afsnit`],
    section_number: `${index}`,
    page_start: index + 1,
    page_end: index + 1,
    vector_rank: null,
    vector_score: null,
    lexical_rank: null,
    lexical_score: null,
    lexical_terms: [],
    version_chunk_count: count,
    ...overrides,
  };
}

/** An emulated knowledge schema: the rows, no conflicts, and the given retrieval context. */
export function fixtureDb(
  options: {
    rows?: SearchRow[];
    documentRows?: DocumentRow[];
    documentError?: { code: string; message: string };
    context?: Record<string, unknown> | null;
    contextError?: boolean;
    calls?: string[];
    args?: Record<string, unknown>[];
  } = {},
): KnowledgeRpcClient {
  const rows = options.rows ?? [fixtureRow(1), fixtureRow(2)];
  return {
    async rpc(fn, args) {
      options.calls?.push(fn);
      options.args?.push({ fn, ...args });
      if (fn === "search_chunks") return { data: rows, error: null };
      if (fn === "product_document_chunks") {
        if (options.documentError) return { data: null, error: options.documentError };
        return { data: options.documentRows ?? [fixtureDocumentRow(0, 2), fixtureDocumentRow(1, 2)], error: null };
      }
      if (fn === "evidence_conflicts" || fn === "evidence_chunks") return { data: [], error: null };
      if (fn === "retrieval_context") {
        if (options.contextError) return { data: null, error: { code: "42501", message: "permission denied" } };
        return { data: options.context === undefined ? fixtureContext() : options.context, error: null };
      }
      return { data: null, error: { message: `ukendt funktion ${fn}` } };
    },
  };
}

/** A query with provenance: a redacted, non-case-bound user question — never customer data. */
export const fixtureQuery = () => userText("Dækker erhvervsansvar skade på ting under reparation?", { caseBound: false, redacted: true });
