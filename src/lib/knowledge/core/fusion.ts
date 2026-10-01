/**
 * Reciprocal Rank Fusion (docs/07 §8.1): the vector and lexical candidate lists are merged
 * by rank, not by score, so the two scales never have to be compared. A candidate found by
 * both retrievers scores higher than one found by either alone.
 *
 *   fusedScore = Σ 1 / (k + rank)   over the retrievers that found the chunk
 */

export const DEFAULT_RRF_K = 60;

export interface RankedByRetrievers {
  chunkId: string;
  vectorRank: number | null;
  lexicalRank: number | null;
}

export function fusedScore(candidate: Pick<RankedByRetrievers, "vectorRank" | "lexicalRank">, k: number = DEFAULT_RRF_K): number {
  return [candidate.vectorRank, candidate.lexicalRank].reduce<number>((sum, rank) => (rank === null ? sum : sum + 1 / (k + rank)), 0);
}

/** Sorted best first; ties are broken by the best single rank and then by chunk id (deterministic). */
export function fuse<T extends RankedByRetrievers>(candidates: T[], k: number = DEFAULT_RRF_K): (T & { fusedScore: number; fusedRank: number })[] {
  const bestRank = (candidate: T) => Math.min(candidate.vectorRank ?? Infinity, candidate.lexicalRank ?? Infinity);
  return candidates
    .map((candidate) => ({ ...candidate, fusedScore: fusedScore(candidate, k) }))
    .sort((a, b) => b.fusedScore - a.fusedScore || bestRank(a) - bestRank(b) || (a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0))
    .map((candidate, i) => ({ ...candidate, fusedRank: i + 1 }));
}
