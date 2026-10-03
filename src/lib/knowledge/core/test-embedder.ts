import type { EmbeddingProvider } from "./embedding.ts";
import type { EmbeddingProviderDescriptor } from "./provider.ts";

/**
 * ⚠ TEST EMBEDDER — DEVELOPMENT ONLY (docs/07 §7, §9.1). Grade "development".
 *
 * Deterministic feature hashing of word tokens and word bigrams into a fixed-size, L2-
 * normalized vector. It has no semantic understanding: two texts are similar only when they
 * share words. It exists so ingestion, storage, indexing and retrieval can be built and
 * tested without choosing a provider. It can never be constructed outside IPA_RUNTIME_ENV=
 * local/test (see registry.ts), and the database refuses to activate it through
 * knowledge.activate_embedding_model.
 */

export const TEST_EMBEDDER = {
  provider: "test",
  model_name: "test-hash-embedder",
  model_version: "1",
  dimensions: 256,
} as const;

/** 32-bit FNV-1a. */
function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function tokenize(text: string): string[] {
  return text.normalize("NFC").toLowerCase().match(/[\p{L}\p{N}§]+/gu) ?? [];
}

export function hashEmbedding(text: string, dimensions: number): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const tokens = tokenize(text);
  const features = [...tokens, ...tokens.slice(1).map((token, i) => `${tokens[i]} ${token}`)];
  for (const feature of features) {
    const hash = fnv1a(feature);
    vector[hash % dimensions]! += (hash & 0x80000000) === 0 ? 1 : -1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) {
    vector[0] = 1;
    return vector;
  }
  return vector.map((value) => Math.round((value / norm) * 1e6) / 1e6);
}

export const TEST_EMBEDDER_DESCRIPTOR: EmbeddingProviderDescriptor = Object.freeze({
  kind: "embedding" as const,
  provider: TEST_EMBEDDER.provider,
  model: TEST_EMBEDDER.model_name,
  modelVersion: TEST_EMBEDDER.model_version,
  grade: "development" as const,
  dimensions: TEST_EMBEDDER.dimensions,
  processing: Object.freeze({ kind: "in_process" as const }),
  // Feature hashing is the same for documents and queries: the input type is ignored.
  inputTypes: "symmetric" as const,
  settings: Object.freeze({ features: "word-unigrams+bigrams", hash: "fnv1a-32" }),
  limits: Object.freeze({ maxTextsPerRequest: 10_000, maxCharsPerText: 1_000_000, maxCharsPerRequest: 100_000_000 }),
});

/** Only the registry constructs it (registry.ts); frozen, so its grade cannot be changed. */
export function createTestEmbedder(): EmbeddingProvider {
  return Object.freeze({
    id: `${TEST_EMBEDDER.provider}:${TEST_EMBEDDER.model_name}@${TEST_EMBEDDER.model_version}`,
    grade: "development" as const,
    dimensions: TEST_EMBEDDER.dimensions,
    descriptor: TEST_EMBEDDER_DESCRIPTOR,
    async embed(texts: string[]) {
      return texts.map((text) => hashEmbedding(text, TEST_EMBEDDER.dimensions));
    },
  });
}
