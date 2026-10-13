import type { EmbeddingProvider } from "../core/embedding.ts";
import { runtimeEnv, type RuntimeEnv } from "../core/grade.ts";
import { createEmbedder, createReranker } from "../core/registry.ts";
import type { RerankingProvider } from "../core/reranker.ts";
import type { RetrievalContext } from "../core/retrieval-context.ts";

/**
 * Which implementations retrieval uses (8B-I6, docs/08b §10; B-035 L2). The configuration IN
 * SERVICE (active, or suspended) decides — never an environment variable, a request or a
 * candidate:
 *
 *   * product_documents (B-035): no embedder and no reranker are constructed — nothing can leave
 *     the platform during retrieval.
 *   * A hybrid configuration in service needs its production embedder and reranker. The beta has
 *     none (the AWS Bedrock adapters were removed in L2; docs/beta.md §14), so the fail-closed
 *     registry refuses them and retrieval is unavailable — never silently development.
 *   * Without a configuration in service, the fail-closed registry is used as before: only the
 *     development implementations, and only in local/test.
 */
export type ConfiguredProviders =
  | { method: "hybrid"; embedding: { embedder: EmbeddingProvider; modelId: string } | null; reranker: RerankingProvider }
  | { method: "product_documents"; embedding: null; reranker: null };

export function providersForContext(context: RetrievalContext, environment: RuntimeEnv = runtimeEnv()): ConfiguredProviders {
  const configuration = context.configuration;
  const model = context.activeModel;
  if (!configuration) {
    return {
      method: "hybrid",
      reranker: createReranker(undefined, environment),
      embedding: model ? { embedder: createEmbedder(model, environment), modelId: model.id } : null,
    };
  }
  if (configuration.method === "product_documents") return { method: "product_documents", embedding: null, reranker: null };
  if (configuration.rerankerId === null) throw new Error("Den hybride konfiguration mangler en reranker.");
  // The registry knows only the development implementations; a production reranker or embedder
  // (8B) is refused here — fail-closed.
  const reranker = createReranker(configuration.rerankerId, environment);
  if (!model) return { method: "hybrid", reranker, embedding: null };
  return { method: "hybrid", reranker, embedding: { embedder: createEmbedder(model, environment), modelId: model.id } };
}
