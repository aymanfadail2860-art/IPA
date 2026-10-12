import { assertTransmittable } from "../../src/lib/egress/policy.ts";
import type { RuntimeEnv } from "../../src/lib/knowledge/core/grade.ts";
import { hashEmbedding } from "../../src/lib/knowledge/core/test-embedder.ts";
import { BEDROCK_PROVIDER, type BedrockInvocation, type BedrockTransport } from "../../src/lib/knowledge/providers/bedrock/transport.ts";
import type { ProviderRuntime } from "../../src/lib/knowledge/providers/catalog.ts";

/**
 * ⚠ DEVELOPMENT ONLY (local/test, 8B-I8 C7) — a deterministic FAKE Bedrock transport, so the
 * worker can run the production embedding adapter (Cohere Embed v4) end to end without an AWS
 * account: the real adapters (Embed v4, Rerank 3.5), the real egress authorization and the real
 * dimension checks; only the network call is replaced by feature hashing of the text.
 *
 *   * Chosen only by configuration (IPA_DEV_FAKE_BEDROCK=1), which config.ts refuses in
 *     production; the production image does not contain this file (.dockerignore + rm).
 *   * Like the real transport it refuses anything the egress policy did not authorize.
 *   * Its vectors carry no meaning beyond shared words. They are never production evidence: the
 *     run that uses them is a development run, and nothing marks them otherwise.
 */

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i]! * b[i]!;
  return dot;
}

export function devFakeBedrockTransport(): BedrockTransport {
  return Object.freeze({
    region: "eu-central-1",
    async invoke(call: BedrockInvocation): Promise<unknown> {
      assertTransmittable(call.egress, { provider: BEDROCK_PROVIDER, modelId: call.modelId, body: call.body, log: () => {} });
      const { texts, output_dimension: dimensions, query, documents } = call.body;
      if (Array.isArray(texts) && typeof dimensions === "number") {
        return { id: "development-fake", response_type: "embeddings_by_type", embeddings: { float: texts.map((text) => hashEmbedding(String(text), dimensions)) } };
      }
      if (typeof query === "string" && Array.isArray(documents)) {
        // Rerank 3.5's answer shape; the score is the cosine of the hashed word vectors.
        const q = hashEmbedding(query, 256);
        const scored = documents.map((document, index) => ({ index, relevance_score: Math.max(0, cosine(q, hashEmbedding(String(document), 256))) }));
        return { id: "development-fake", results: scored.sort((a, b) => b.relevance_score - a.relevance_score || a.index - b.index) };
      }
      throw new Error("Den falske Bedrock-transport kender kun embedding og reranking.");
    },
  });
}

export function devFakeBedrockRuntime(environment: RuntimeEnv): ProviderRuntime {
  if (environment !== "local" && environment !== "test") throw new Error("Den falske Bedrock-transport findes kun lokalt og i test.");
  return { bedrock: devFakeBedrockTransport() };
}
