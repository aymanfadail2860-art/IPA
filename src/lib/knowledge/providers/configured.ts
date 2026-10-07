import type { EmbeddingProvider } from "../core/embedding.ts";
import { runtimeEnv, type RuntimeEnv } from "../core/grade.ts";
import { createEmbedder, createReranker } from "../core/registry.ts";
import type { RerankingProvider } from "../core/reranker.ts";
import type { RetrievalContext } from "../core/retrieval-context.ts";

import { EU_SOURCE_REGION } from "./bedrock/cohere-embed-v4.ts";
import { createSdkBedrockTransport } from "./bedrock/sdk-transport.ts";
import { createProductionEmbedder, createProductionReranker, type ProviderRuntime } from "./catalog.ts";

export type { ProviderRuntime };

/**
 * Which implementations retrieval uses (8B-I6, docs/08b §10). The configuration IN SERVICE
 * (active, or suspended) decides — never an environment variable, a request or a candidate:
 *
 *   * With a configuration in service, its reranker and — when its model is the active model —
 *     its embedder are constructed from the production catalogue. A registered candidate or an
 *     approved but inactive configuration never selects a provider, so production providers
 *     can never become active automatically.
 *   * A suspended configuration keeps its providers (no fallback to another configuration); the
 *     evidence is development because P3 fails (docs/08b §10.2).
 *   * Without a configuration in service, the fail-closed registry is used as before: only the
 *     development implementations, and only in local/test.
 *
 * Constructing a provider needs no network or credentials; the Bedrock runtime is created
 * lazily by the caller (retrieval.ts).
 */

export interface ConfiguredProviders {
  embedding: { embedder: EmbeddingProvider; modelId: string } | null;
  reranker: RerankingProvider;
}

export function providersForContext(context: RetrievalContext, runtime: () => ProviderRuntime, environment: RuntimeEnv = runtimeEnv()): ConfiguredProviders {
  const configuration = context.configuration;
  const model = context.activeModel;
  if (!configuration) {
    return {
      reranker: createReranker(undefined, environment),
      embedding: model ? { embedder: createEmbedder(model, environment), modelId: model.id } : null,
    };
  }
  const reranker = createProductionReranker(configuration.rerankerId, runtime());
  if (!model) return { reranker, embedding: null };
  const embedder = model.id === configuration.embeddingModelId ? createProductionEmbedder(model, runtime()) : createEmbedder(model, environment);
  return { reranker, embedding: { embedder, modelId: model.id } };
}

let applicationRuntime: ProviderRuntime | null = null;

/**
 * The application's Bedrock runtime (eu-central-1), created on first use: credentials come from
 * the SDK's default chain (federation, D-11) and are only resolved at the first call.
 */
export function applicationProviderRuntime(): ProviderRuntime {
  applicationRuntime ??= { bedrock: createSdkBedrockTransport({ region: EU_SOURCE_REGION }) };
  return applicationRuntime;
}
