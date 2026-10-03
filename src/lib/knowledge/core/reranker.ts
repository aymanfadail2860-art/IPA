import type { ClassifiedText } from "../../egress/classification.ts";

import type { Grade } from "./grade.ts";
import type { RerankingProviderDescriptor } from "./provider.ts";

/**
 * Reranker interface (docs/07 §9). Reranking is a fixed step in V1 (docs/03 §7); the provider
 * is NOT locked. Phase 7 ships only the "none" reranker, which keeps the fusion order.
 */

export type RankReason =
  | { kind: "lexical_match"; terms: string[] }
  | { kind: "vector_similarity"; score: number }
  | { kind: "fused_rank"; rank: number }
  | { kind: "reranker_score"; score: number };

export interface RerankCandidate {
  chunkId: string;
  /**
   * What a reranker may read of the candidate: heading chain and text (rerankDocumentText),
   * classified as Knowledge Engine content by the retrieval layer (8B-I2.5).
   */
  document: ClassifiedText;
  retrieval: { vectorRank?: number; lexicalRank?: number; vectorScore?: number; lexicalScore?: number; fusedScore: number };
}

export interface RerankInput {
  /** The query with its provenance (8B-I2.5). */
  query: ClassifiedText;
  candidates: RerankCandidate[];
  topN: number;
}

export interface RerankOutput {
  /** Best first. `score` is normalized to [0,1] and comparable only within one query. */
  ranked: { chunkId: string; score: number; rank: number; reasons: RankReason[] }[];
  reranker: { id: string; version: string };
}

export interface Reranker {
  readonly id: string;
  readonly version: string;
  /** A property of the implementation (docs/07 §9.1) — never set by the caller. */
  readonly grade: Grade;
  rerank(input: RerankInput): Promise<RerankOutput>;
}

/** The text of a candidate passage for reranking: heading chain and the chunk's own text. */
export function rerankDocumentText(headingPath: readonly string[], text: string): string {
  return [headingPath.join(" › "), text].filter((part) => part.length > 0).join("\n");
}

/** A reranker that declares itself (8B-I2). Every real implementation is one. */
export interface RerankingProvider extends Reranker {
  readonly descriptor: RerankingProviderDescriptor;
}

export const NONE_RERANKER_ID = "none";

export const NONE_RERANKER_DESCRIPTOR: RerankingProviderDescriptor = Object.freeze({
  kind: "reranking" as const,
  provider: "ipa",
  model: "none",
  modelVersion: "1",
  id: NONE_RERANKER_ID,
  version: "1",
  grade: "development" as const,
  processing: Object.freeze({ kind: "in_process" as const }),
  settings: Object.freeze({ order: "fused" }),
  limits: Object.freeze({ maxDocumentsPerRequest: 1000, maxCharsPerDocument: 100_000, maxQueryChars: 1000 }),
});

/**
 * ⚠ "none" RERANKER — DEVELOPMENT ONLY (docs/07 §9, §9.1). Grade "development".
 *
 * Keeps the fusion order. The score is the fused (RRF) score relative to the best candidate
 * of the same query, so the top candidate scores 1. It never judges relevance. It can only be
 * constructed through the registry, which refuses it outside IPA_RUNTIME_ENV=local/test.
 */
export function createNoneReranker(): RerankingProvider {
  return Object.freeze({
    id: NONE_RERANKER_ID,
    version: "1",
    grade: "development" as const,
    descriptor: NONE_RERANKER_DESCRIPTOR,
    async rerank(input: RerankInput): Promise<RerankOutput> {
      const ordered = [...input.candidates].sort((a, b) => b.retrieval.fusedScore - a.retrieval.fusedScore).slice(0, Math.max(0, input.topN));
      const top = ordered[0]?.retrieval.fusedScore ?? 0;
      return {
        ranked: ordered.map((candidate, i) => ({
          chunkId: candidate.chunkId,
          score: top > 0 ? round(candidate.retrieval.fusedScore / top) : 0,
          rank: i + 1,
          reasons: [{ kind: "fused_rank" as const, rank: i + 1 }],
        })),
        reranker: { id: NONE_RERANKER_ID, version: "1" },
      };
    },
  });
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
