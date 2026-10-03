import { modelLabel, type EmbeddingModelSpec, type EmbeddingProvider } from "../core/embedding.ts";
import { ProviderError, type EmbeddingProviderDescriptor, type RerankingProviderDescriptor, type RetryDeps } from "../core/provider.ts";
import type { RerankingProvider } from "../core/reranker.ts";

import { createCohereEmbedV4, EMBED_V4_EU_1024_DESCRIPTOR } from "./bedrock/cohere-embed-v4.ts";
import { COHERE_RERANK_35_ID, createCohereRerank35, RERANK_35_DESCRIPTOR } from "./bedrock/cohere-rerank-3-5.ts";
import type { BedrockTransport } from "./bedrock/transport.ts";

/**
 * The catalogue of production providers (8B-I2). Provider and model are data: an embedding
 * model is chosen by its row in knowledge.embedding_models (provider, model_name,
 * model_version, dimensions), a reranker by its id. Unknown combinations fail — there is no
 * fallback to the test embedder or to "none" (fail-closed).
 *
 * ⚠ NOT wired into the application's registry (core/registry.ts) in 8B-I2. Only the evaluation
 * engine and tests construct these. Using them for application retrieval requires the
 * configuration register and P1–P9 (docs/08b §9–§10, a later step), so 8B-I2 alone cannot make
 * any evidence production grade.
 */

export interface ProviderRuntime {
  /** The Bedrock transport for eu-central-1 (sdk-transport.ts, or a fake in tests). */
  bedrock: BedrockTransport;
  retryDeps?: RetryDeps;
}

export const PRODUCTION_EMBEDDING_DESCRIPTORS: readonly EmbeddingProviderDescriptor[] = Object.freeze([EMBED_V4_EU_1024_DESCRIPTOR]);
export const PRODUCTION_RERANKING_DESCRIPTORS: readonly RerankingProviderDescriptor[] = Object.freeze([RERANK_35_DESCRIPTOR]);

/** The knowledge.embedding_models row for a descriptor (without id). */
export function embeddingModelRow(descriptor: EmbeddingProviderDescriptor): Omit<EmbeddingModelSpec, "id"> {
  return { provider: descriptor.provider, model_name: descriptor.model, model_version: descriptor.modelVersion, dimensions: descriptor.dimensions };
}

export function findEmbeddingDescriptor(model: Omit<EmbeddingModelSpec, "id">): EmbeddingProviderDescriptor | null {
  return (
    PRODUCTION_EMBEDDING_DESCRIPTORS.find(
      (descriptor) =>
        descriptor.provider === model.provider &&
        descriptor.model === model.model_name &&
        descriptor.modelVersion === model.model_version &&
        descriptor.dimensions === model.dimensions,
    ) ?? null
  );
}

export function createProductionEmbedder(model: Omit<EmbeddingModelSpec, "id">, runtime: ProviderRuntime): EmbeddingProvider {
  const descriptor = findEmbeddingDescriptor(model);
  if (!descriptor) {
    throw new ProviderError("configuration", model.provider, `Der er ingen production-implementering af ${modelLabel(model)} med ${model.dimensions} dimensioner.`);
  }
  return createCohereEmbedV4({ transport: runtime.bedrock, descriptor, retryDeps: runtime.retryDeps });
}

export function createProductionReranker(id: string, runtime: ProviderRuntime): RerankingProvider {
  if (id !== COHERE_RERANK_35_ID) throw new ProviderError("configuration", "ukendt", `Der er ingen production-implementering af rerankeren "${id}".`);
  return createCohereRerank35({ transport: runtime.bedrock, retryDeps: runtime.retryDeps });
}
