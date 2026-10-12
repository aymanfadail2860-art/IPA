import { modelLabel, type EmbeddingModelSpec, type EmbeddingProvider } from "../core/embedding.ts";
import type { RuntimeEnv } from "../core/grade.ts";
import { ProviderError } from "../core/provider.ts";
import { createEmbedder } from "../core/registry.ts";

import { credentialPlanFor, type AwsCredentialSource, type AwsCredentialSources, type ProviderEntry } from "./aws-credentials.ts";
import { EU_SOURCE_REGION } from "./bedrock/cohere-embed-v4.ts";
import { createSdkBedrockTransport } from "./bedrock/sdk-transport.ts";
import { createProductionEmbedder, findEmbeddingDescriptor, PRODUCTION_EMBEDDING_DESCRIPTORS, type ProviderRuntime } from "./catalog.ts";

/**
 * The single embedder resolution path of every runtime (docs/08b §2, §10; 8B-I8 C7):
 *
 *   embedding model row → production catalogue → runtime provider factory → embedder
 *
 * The model comes from knowledge.embedding_models (the registry decides which models are active
 * or candidates); nothing about a model is configured here. A model in the production catalogue
 * gets its production adapter on the runtime's provider transport. Every other model goes to
 * the fail-closed development registry, which only builds the test embedder, and only in
 * local/test. There is no fallback: a production provider with an unknown model, version or
 * dimension, a development model in production, or a runtime that cannot be constructed fails.
 */

const PRODUCTION_EMBEDDING_PROVIDERS: ReadonlySet<string> = new Set(PRODUCTION_EMBEDDING_DESCRIPTORS.map((descriptor) => descriptor.provider));

export function createRuntimeEmbedder(model: EmbeddingModelSpec, runtime: () => ProviderRuntime, environment: RuntimeEnv): EmbeddingProvider {
  if (findEmbeddingDescriptor(model)) {
    const embedder = createProductionEmbedder(model, runtime());
    if (embedder.descriptor.dimensions !== model.dimensions) {
      throw new ProviderError("configuration", model.provider, `${modelLabel(model)} har ${model.dimensions} dimensioner i registret, men adapteren leverer ${embedder.descriptor.dimensions}.`);
    }
    return embedder;
  }
  if (PRODUCTION_EMBEDDING_PROVIDERS.has(model.provider)) {
    throw new ProviderError("configuration", model.provider, `${modelLabel(model)} med ${model.dimensions} dimensioner findes ikke i production-kataloget.`);
  }
  return createEmbedder(model, environment);
}

export interface RuntimeProviders extends ProviderRuntime {
  credentialSource: AwsCredentialSource;
}

/**
 * The provider runtime of an entry point: the Bedrock transport with that runtime's one
 * credential path. Constructing it makes no network call.
 */
export function providerRuntimeFor(entry: ProviderEntry, env: Record<string, string | undefined>, sources: AwsCredentialSources): RuntimeProviders {
  const plan = credentialPlanFor(entry, env, sources);
  return { bedrock: createSdkBedrockTransport({ region: EU_SOURCE_REGION, credentials: plan.credentials, env }), credentialSource: plan.source };
}
