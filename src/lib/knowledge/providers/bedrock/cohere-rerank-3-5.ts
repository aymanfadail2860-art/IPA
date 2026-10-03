import { ProviderError, withRetry, type RerankingProviderDescriptor, type RetryDeps, type RetryPolicy } from "../../core/provider.ts";
import type { RerankCandidate, RerankInput, RerankOutput, RerankingProvider } from "../../core/reranker.ts";

import { EU_SOURCE_REGION } from "./cohere-embed-v4.ts";
import { BEDROCK_PROVIDER, type BedrockTransport } from "./transport.ts";

/**
 * Cohere Rerank 3.5 on AWS Bedrock, in-region in eu-central-1 (docs/08b §3.3, D-3), grade
 * "production".
 *
 * It only REORDERS the candidates it is given. They have already passed permission, validity
 * and filters in the database (docs/07 §8); the reranker never adds, drops or changes a
 * candidate's source, authority or access. Every candidate gets exactly one score, and the
 * mapping back to the candidate is by position, validated in full.
 *
 * What is sent (data boundary): the normalized query and, per candidate, its heading chain and
 * text. No ids, titles, user, case or tenant data.
 */

export const COHERE_RERANK_35_MODEL = "cohere.rerank-v3-5:0";
export const COHERE_RERANK_35_ID = `${BEDROCK_PROVIDER}:${COHERE_RERANK_35_MODEL}`;

export const RERANK_35_DESCRIPTOR: RerankingProviderDescriptor = Object.freeze({
  kind: "reranking" as const,
  provider: BEDROCK_PROVIDER,
  model: COHERE_RERANK_35_MODEL,
  modelVersion: "euc1-v1",
  id: COHERE_RERANK_35_ID,
  version: "euc1-v1",
  grade: "production" as const,
  processing: Object.freeze({ kind: "in_region" as const, region: EU_SOURCE_REGION }),
  settings: Object.freeze({ apiVersion: 2, topN: "all", document: "heading-path+text", ties: "candidate-order" }),
  // Conservative: the model's context is ~4096 tokens for query + document; our chunks are far
  // below. An over-long document is refused, never truncated silently.
  limits: Object.freeze({ maxDocumentsPerRequest: 1000, maxCharsPerDocument: 8_000, maxQueryChars: 1000 }),
});

export const RERANK_RETRY_POLICY: RetryPolicy = Object.freeze({ maxAttempts: 3, baseDelayMs: 200, maxDelayMs: 2_000, attemptTimeoutMs: 5_000 });

export interface CohereRerank35Options {
  transport: BedrockTransport;
  retry?: RetryPolicy;
  retryDeps?: RetryDeps;
}

/** The text sent for one candidate: heading chain and the chunk's own text. */
export function rerankDocument(candidate: Pick<RerankCandidate, "headingPath" | "text">): string {
  return [candidate.headingPath.join(" › "), candidate.text].filter((part) => part.length > 0).join("\n");
}

/** The exact request body. Exported so the data boundary can be tested. */
export function rerankRequestBody(query: string, candidates: readonly Pick<RerankCandidate, "headingPath" | "text">[]): Record<string, unknown> {
  return { query, documents: candidates.map(rerankDocument), top_n: candidates.length, api_version: 2 };
}

/** Validates the response: exactly one finite score in [0,1] per candidate, every index once. */
export function parseRerankResults(response: unknown, count: number): { index: number; score: number }[] {
  const fail = (message: string): never => {
    throw new ProviderError("invalid_response", BEDROCK_PROVIDER, message);
  };
  if (typeof response !== "object" || response === null) fail("Rerank-svaret er ikke et objekt.");
  const results = (response as { results?: unknown }).results;
  if (!Array.isArray(results)) fail("Rerank-svaret har ingen resultater.");
  const list = results as unknown[];
  if (list.length !== count) fail(`Rerank-svaret har ${list.length} resultater, forventet ${count}.`);
  const seen = new Set<number>();
  return list.map((entry) => {
    if (typeof entry !== "object" || entry === null) return fail("Et rerank-resultat er ikke et objekt.");
    const { index, relevance_score: score } = entry as { index?: unknown; relevance_score?: unknown };
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= count) return fail(`Ukendt kandidat-indeks: ${String(index)}.`);
    if (seen.has(index)) return fail(`Kandidat-indeks ${index} forekommer to gange.`);
    seen.add(index);
    if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1) return fail(`Ugyldig score for kandidat ${index}.`);
    return { index, score };
  });
}

const round = (value: number) => Math.round(value * 1e6) / 1e6;

export function createCohereRerank35(options: CohereRerank35Options): RerankingProvider {
  const descriptor = RERANK_35_DESCRIPTOR;
  const processing = descriptor.processing;
  if (processing.kind !== "in_region" || processing.region !== options.transport.region) {
    throw new ProviderError("configuration", BEDROCK_PROVIDER, `Rerank 3.5 kører in-region i ${EU_SOURCE_REGION}; transporten bruger ${options.transport.region}.`);
  }
  const retry = options.retry ?? RERANK_RETRY_POLICY;

  return Object.freeze({
    id: descriptor.id,
    version: descriptor.version,
    grade: descriptor.grade,
    descriptor,
    async rerank(input: RerankInput): Promise<RerankOutput> {
      const reranker = { id: descriptor.id, version: descriptor.version };
      const { candidates } = input;
      if (!Number.isInteger(input.topN) || input.topN < 0) throw new ProviderError("invalid_request", BEDROCK_PROVIDER, "topN skal være et ikke-negativt heltal.");
      if (candidates.length === 0 || input.topN === 0) return { ranked: [], reranker };
      if (candidates.length > descriptor.limits.maxDocumentsPerRequest) {
        throw new ProviderError("input_too_large", BEDROCK_PROVIDER, `${candidates.length} kandidater (højst ${descriptor.limits.maxDocumentsPerRequest}).`);
      }
      if (input.query.trim().length === 0 || input.query.length > descriptor.limits.maxQueryChars) {
        throw new ProviderError("invalid_request", BEDROCK_PROVIDER, "Forespørgslen er tom eller for lang til reranking.");
      }
      // Chunk identity must be unambiguous, or the mapping back could mix up sources.
      const ids = new Set<string>();
      candidates.forEach((candidate, i) => {
        if (ids.has(candidate.chunkId)) throw new ProviderError("invalid_request", BEDROCK_PROVIDER, `Kandidat ${i} har samme chunk-id som en anden.`, { inputIndex: i });
        ids.add(candidate.chunkId);
        const document = rerankDocument(candidate);
        if (document.trim().length === 0) throw new ProviderError("invalid_request", BEDROCK_PROVIDER, `Kandidat ${i} er tom.`, { inputIndex: i });
        if (document.length > descriptor.limits.maxCharsPerDocument) {
          throw new ProviderError("input_too_large", BEDROCK_PROVIDER, `Kandidat ${i} er ${document.length} tegn (højst ${descriptor.limits.maxCharsPerDocument}).`, { inputIndex: i });
        }
      });

      const body = rerankRequestBody(input.query, candidates);
      const results = await withRetry(
        BEDROCK_PROVIDER,
        retry,
        async (signal) => parseRerankResults(await options.transport.invoke({ modelId: COHERE_RERANK_35_MODEL, body, signal }), candidates.length),
        options.retryDeps,
      );
      // Deterministic order: score descending; ties keep the incoming (fused) order. The
      // provider's own ordering of the list is never trusted.
      const ordered = [...results].sort((a, b) => b.score - a.score || a.index - b.index).slice(0, input.topN);
      return {
        ranked: ordered.map((entry, i) => {
          const score = round(entry.score);
          return { chunkId: candidates[entry.index]!.chunkId, score, rank: i + 1, reasons: [{ kind: "reranker_score" as const, score }] };
        }),
        reranker,
      };
    },
  });
}
