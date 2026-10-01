import { modelLabel, type Embedder, type EmbeddingModelSpec } from "./embedding.ts";
import { assertGradeAllowed, runtimeEnv, type RuntimeEnv } from "./grade.ts";
import { createNoneReranker, NONE_RERANKER_ID, type Reranker } from "./reranker.ts";
import { createTestEmbedder, TEST_EMBEDDER } from "./test-embedder.ts";

/**
 * Fail-closed registry (docs/07 §9.1). Picks an implementation from configuration and
 * refuses development-grade implementations unless IPA_RUNTIME_ENV is explicitly local/test.
 * It is the only place the test embedder and the "none" reranker are constructed (enforced
 * by a guardrail test).
 *
 * No real embedding or reranking provider is chosen in phase 7 (docs/07 §17.4). A configured
 * provider without an implementation here cannot be used — it fails, never silently.
 */

export class ProviderNotConfiguredError extends Error {
  constructor(label: string) {
    super(`Der er ingen implementering af embedding-modellen ${label}. Udbyderen er ikke valgt endnu (docs/07 §17.4).`);
    this.name = "ProviderNotConfiguredError";
  }
}

export class RerankerNotConfiguredError extends Error {
  constructor(id: string) {
    super(`Der er ingen implementering af rerankeren "${id}". Udbyderen er ikke valgt endnu (docs/07 §17.4).`);
    this.name = "RerankerNotConfiguredError";
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

/** The configured reranker: IPA_RERANKER, default "none". */
export function createReranker(id: string = process.env.IPA_RERANKER || NONE_RERANKER_ID, environment: RuntimeEnv = runtimeEnv()): Reranker {
  if (id === NONE_RERANKER_ID) {
    const reranker = createNoneReranker();
    assertGradeAllowed(`Rerankeren "${NONE_RERANKER_ID}"`, reranker.grade, environment);
    return reranker;
  }
  throw new RerankerNotConfiguredError(id);
}
