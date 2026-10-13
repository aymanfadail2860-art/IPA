import type { EmbeddingModelSpec, EmbeddingProvider } from "../../src/lib/knowledge/core/embedding.ts";
import type { RuntimeEnv } from "../../src/lib/knowledge/core/grade.ts";
import { modelLabel } from "../../src/lib/knowledge/core/embedding.ts";
import { createEmbedder } from "../../src/lib/knowledge/core/registry.ts";

/**
 * The worker's embedders (docs/07 §9.1). The worker embeds with exactly the models the registry
 * has made active or candidates — nothing is configured here — through the fail-closed registry:
 * the development test embedder, and only in local/test. The production providers of 8B (AWS
 * Bedrock) were removed in the beta's L2 (docs/beta.md §14); a production model is refused.
 */
export function workerEmbedderFactory(options: { environment: RuntimeEnv }): (model: EmbeddingModelSpec) => EmbeddingProvider {
  return (model) => createEmbedder(model, options.environment);
}

export interface EmbedderProblem {
  model: string;
  /** The error class: ProviderError kind, or the error's name. Never a message with values. */
  code: string;
}

/**
 * The startup check: every active or candidate model must resolve to an implementation this
 * runtime may use — before the job loop starts. No provider call is made.
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
