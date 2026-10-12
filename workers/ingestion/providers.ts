import type { EmbeddingModelSpec, EmbeddingProvider } from "../../src/lib/knowledge/core/embedding.ts";
import type { RuntimeEnv } from "../../src/lib/knowledge/core/grade.ts";
import { modelLabel } from "../../src/lib/knowledge/core/embedding.ts";
import type { ProviderRuntime } from "../../src/lib/knowledge/providers/catalog.ts";
import { CONTAINER_CREDENTIAL_SOURCES } from "../../src/lib/knowledge/providers/credentials-container.ts";
import { createRuntimeEmbedder, providerRuntimeFor, type RuntimeProviders } from "../../src/lib/knowledge/providers/runtime.ts";

export { observedRuntime } from "../../src/lib/knowledge/providers/provider-metrics.ts";

/**
 * The worker's embedders (docs/08b §2, §6.1; 8B-I8 C7). The worker embeds with exactly the
 * models the registry has made active or candidates — nothing is configured here — through the
 * shared resolution path (providers/runtime.ts). In production the provider transport uses the
 * ECS task role (credentials-container.ts); the evaluation environment's worker is the same code.
 */

/** The production provider runtime: Bedrock in eu-central-1 with the ECS task role, nothing else. */
export function workerProviderRuntime(env: Record<string, string | undefined>): RuntimeProviders {
  return providerRuntimeFor("worker", env, CONTAINER_CREDENTIAL_SOURCES);
}

/** The embedder of a registered model. The runtime is built once, on first need. */
export function workerEmbedderFactory(options: { environment: RuntimeEnv; runtime: () => ProviderRuntime }): (model: EmbeddingModelSpec) => EmbeddingProvider {
  let built: ProviderRuntime | null = null;
  const runtime = () => (built ??= options.runtime());
  return (model) => createRuntimeEmbedder(model, runtime, options.environment);
}

export interface EmbedderProblem {
  model: string;
  /** The error class: ProviderError kind, or the error's name. Never a message with values. */
  code: string;
}

/**
 * The startup check: every active or candidate model must resolve to an implementation this
 * runtime may use, with its credential path constructible — before the job loop starts. No
 * provider call is made.
 */
export function checkEmbeddingModels(models: readonly EmbeddingModelSpec[], embedderFor: (model: EmbeddingModelSpec) => EmbeddingProvider): EmbedderProblem[] {
  const problems: EmbedderProblem[] = [];
  for (const model of models) {
    try {
      const embedder = embedderFor(model);
      if (embedder.descriptor.dimensions !== model.dimensions) problems.push({ model: modelLabel(model), code: "dimensions" });
    } catch (error) {
      const kind = (error as { kind?: unknown }).kind;
      problems.push({ model: modelLabel(model), code: typeof kind === "string" ? kind : error instanceof Error ? error.name : "error" });
    }
  }
  return problems;
}
