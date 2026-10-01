import "server-only";

import { isDemoMode } from "@/dev/demo/demo-mode";
import { authorize } from "@/lib/auth/server-session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import type { Embedder, EmbeddingModelSpec } from "./core/embedding";
import type { EvidenceSet } from "./core/evidence";
import { createEmbedder, createReranker } from "./core/registry";
import type { Reranker } from "./core/reranker";
import { DEFAULT_RETRIEVAL_CONFIG, RetrievalError, runRetrieval, type RetrievalRequest } from "./retrieval-core";

/**
 * retrieveEvidence (docs/07 §8.2) — server-only, no HTTP route. Later modules call it
 * server-side; the Admin tool "Afprøv retrieval" calls exactly this function with exactly
 * this configuration.
 *
 *   * Runs as the signed-in user: the database filters by that user's document access (RLS
 *     and the access filter in knowledge.search_chunks). There is no way to search as someone
 *     else, and no admin shortcut.
 *   * The embedder and the reranker come from the fail-closed registry (docs/07 §9.1). They are
 *     never parameters, so a caller cannot choose a reranker or set the evidence grade.
 *   * The query is not stored or logged.
 */

const READ = { allOf: ["knowledge.document.read"] } as const;

let configuredReranker: Reranker | null = null;
const embedders = new Map<string, Embedder>();

/** The configured reranker (IPA_RERANKER). Throws — fail-closed — when it is not allowed here. */
export function retrievalReranker(): Reranker {
  configuredReranker ??= createReranker();
  return configuredReranker;
}

function embedderFor(model: EmbeddingModelSpec): Embedder {
  const cached = embedders.get(model.id);
  if (cached) return cached;
  const embedder = createEmbedder(model);
  embedders.set(model.id, embedder);
  return embedder;
}

export { RetrievalError, type RetrievalRequest };

export async function retrieveEvidence(request: RetrievalRequest): Promise<EvidenceSet> {
  if (isDemoMode()) throw new RetrievalError("unavailable", "Retrieval er ikke tilgængelig i demoen uden database.");
  if (!(await authorize(READ))) throw new RetrievalError("denied", "Du har ikke adgang til vidensgrundlaget.");

  let reranker: Reranker;
  try {
    reranker = retrievalReranker();
  } catch (error) {
    throw new RetrievalError("unavailable", `Retrieval er slået fra: ${(error as Error).message}`);
  }

  const knowledge = (await createSupabaseServerClient()).schema("knowledge");
  const { data: models, error } = await knowledge.rpc("active_embedding_model");
  if (error) throw new RetrievalError("unavailable", "Søgningen kunne ikke gennemføres. Prøv igen.");
  const model = ((models ?? []) as EmbeddingModelSpec[])[0] ?? null;

  let embedding: { embedder: Embedder; modelId: string } | null = null;
  if (model) {
    try {
      embedding = { embedder: embedderFor(model), modelId: model.id };
    } catch (failure) {
      throw new RetrievalError("unavailable", `Retrieval er slået fra: ${(failure as Error).message}`);
    }
  }

  return runRetrieval(request, { db: knowledge, embedding, reranker, config: DEFAULT_RETRIEVAL_CONFIG });
}
