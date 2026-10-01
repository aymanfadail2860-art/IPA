import type { Grade } from "./grade.ts";

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
  text: string;
  headingPath: string[];
  retrieval: { vectorRank?: number; lexicalRank?: number; vectorScore?: number; lexicalScore?: number; fusedScore: number };
}

export interface RerankInput {
  query: string;
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

export const NONE_RERANKER_ID = "none";

/**
 * ⚠ "none" RERANKER — DEVELOPMENT ONLY (docs/07 §9, §9.1). Grade "development".
 *
 * Keeps the fusion order. The score is the fused (RRF) score relative to the best candidate
 * of the same query, so the top candidate scores 1. It never judges relevance. It can only be
 * constructed through the registry, which refuses it outside IPA_RUNTIME_ENV=local/test.
 */
export function createNoneReranker(): Reranker {
  return Object.freeze({
    id: NONE_RERANKER_ID,
    version: "1",
    grade: "development" as const,
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
