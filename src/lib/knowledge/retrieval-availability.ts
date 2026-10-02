import type { EmbeddingModelSpec } from "./core/embedding";
import type { Grade, RuntimeEnv } from "./core/grade";
import { combinedGrade, runtimeEnv } from "./core/grade";
import { createEmbedder, createReranker } from "./core/registry";

/**
 * Whether retrieval can run at all — a state the rest of the system can read, not only a log
 * line (docs/07 §9.1 point 2, §20.2).
 *
 * docs/04 §16: "Insufficient" and "Error" must never look alike. "Der findes ikke
 * tilstrækkelig dokumentation" is a competent answer; "Retrieval er utilgængelig" is a system
 * failure. Everything that shows retrieval results decides how to show them with
 * presentRetrieval(), which can only map an unavailable retrieval to an error.
 */

export type RetrievalAvailability =
  | {
      state: "available";
      reranker: { id: string; grade: Grade };
      embeddingModel: { label: string; grade: Grade } | null;
      /** Production only with a production embedder AND a production reranker (§9.1). */
      grade: Grade;
    }
  | { state: "unavailable"; reason: string };

export interface AvailabilityInput {
  demo: boolean;
  databaseConfigured: boolean;
  /** The active embedding model; null = none active; undefined = could not be read. */
  activeModel: EmbeddingModelSpec | null | undefined;
  rerankerId?: string;
  environment?: RuntimeEnv;
}

export function assessRetrieval(input: AvailabilityInput): RetrievalAvailability {
  if (input.demo) return { state: "unavailable", reason: "Retrieval kræver en database og er ikke tilgængelig i demoen." };
  if (!input.databaseConfigured) return { state: "unavailable", reason: "Der er ingen forbindelse til vidensgrundlaget (databasen er ikke konfigureret)." };
  if (input.activeModel === undefined) return { state: "unavailable", reason: "Den aktive embedding-model kunne ikke læses fra databasen." };
  const environment = input.environment ?? runtimeEnv();
  let reranker;
  try {
    reranker = createReranker(input.rerankerId ?? (process.env.IPA_RERANKER || "none"), environment);
  } catch (error) {
    return { state: "unavailable", reason: (error as Error).message };
  }
  let embedder = null;
  if (input.activeModel) {
    try {
      embedder = createEmbedder(input.activeModel, environment);
    } catch (error) {
      return { state: "unavailable", reason: (error as Error).message };
    }
  }
  return {
    state: "available",
    reranker: { id: reranker.id, grade: reranker.grade },
    embeddingModel: embedder ? { label: embedder.id, grade: embedder.grade } : null,
    grade: embedder ? combinedGrade(embedder.grade, reranker.grade) : "development",
  };
}
