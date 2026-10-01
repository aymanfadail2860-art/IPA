import { modelLabel, type Embedder, type EmbeddingModelSpec } from "./embedding.ts";
import { assertGradeAllowed, runtimeEnv, type RuntimeEnv } from "./grade.ts";
import { createTestEmbedder, TEST_EMBEDDER } from "./test-embedder.ts";

/**
 * Fail-closed registry (docs/07 §9.1). Picks an implementation for a configured model and
 * refuses development-grade implementations unless IPA_RUNTIME_ENV is explicitly local/test.
 *
 * No real embedding provider is chosen in phase 7 (docs/07 §17.4). A model whose provider
 * has no implementation here cannot be used — it fails at startup, not silently.
 */

export class ProviderNotConfiguredError extends Error {
  constructor(label: string) {
    super(`Der er ingen implementering af embedding-modellen ${label}. Udbyderen er ikke valgt endnu (docs/07 §17.4).`);
    this.name = "ProviderNotConfiguredError";
  }
}

export function createEmbedder(model: EmbeddingModelSpec, environment: RuntimeEnv = runtimeEnv()): Embedder {
  const label = modelLabel(model);
  if (
    model.provider === TEST_EMBEDDER.provider &&
    model.model_name === TEST_EMBEDDER.model_name &&
    model.model_version === TEST_EMBEDDER.model_version &&
    model.dimensions === TEST_EMBEDDER.dimensions
  ) {
    const embedder = createTestEmbedder();
    assertGradeAllowed(label, embedder.grade, environment);
    return embedder;
  }
  throw new ProviderNotConfiguredError(label);
}
