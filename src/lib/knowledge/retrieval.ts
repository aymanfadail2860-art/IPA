import "server-only";

import { isDemoMode } from "@/dev/demo/demo-mode";
import { getServerSession } from "@/lib/auth/server-session";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import type { Embedder, EmbeddingModelSpec } from "./core/embedding";
import type { EvidenceSet } from "./core/evidence";
import { createEmbedder, createReranker } from "./core/registry";
import type { Reranker } from "./core/reranker";
import { assessRetrieval, type RetrievalAvailability } from "./retrieval-availability";
import { DEFAULT_RETRIEVAL_CONFIG, RetrievalError, runRetrieval, type ClassifiedRetrievalRequest, type RetrievalRequest } from "./retrieval-core";
import type { RetrievalOutcome } from "./result-presentation";

/**
 * retrieveEvidence (docs/07 §8.2) — server-only, no HTTP route. Later modules call it
 * server-side; the Admin tool "Afprøv retrieval" calls exactly this function with exactly
 * this configuration.
 *
 *   * Runs as the signed-in user: the database filters by that user's document access (RLS
 *     and the access filter in knowledge.search_chunks). There is no way to search as someone
 *     else, and no admin shortcut. Advisors and leaders reach knowledge only through document
 *     grants (docs/07 §4.3), so no role permission is required here — the database decides.
 *   * The embedder and the reranker come from the fail-closed registry (docs/07 §9.1). They are
 *     never parameters, so a caller cannot choose a reranker or set the evidence grade.
 *   * The query is not stored or logged.
 */

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

export { RetrievalError, type ClassifiedRetrievalRequest, type RetrievalAvailability, type RetrievalRequest };

async function activeModel(knowledge: KnowledgeClient): Promise<EmbeddingModelSpec | null | undefined> {
  const { data, error } = await knowledge.rpc("active_embedding_model");
  if (error) return undefined;
  return ((data ?? []) as EmbeddingModelSpec[])[0] ?? null;
}

type KnowledgeClient = ReturnType<Awaited<ReturnType<typeof createSupabaseServerClient>>["schema"]>;

/**
 * Whether retrieval can run right now (docs/07 §20.2): readable by everything that shows
 * results and by Admin — not only a line in the server log.
 */
export async function getRetrievalAvailability(): Promise<RetrievalAvailability> {
  if (isDemoMode() || !getSupabaseConfig()) return assessRetrieval({ demo: isDemoMode(), databaseConfigured: false, activeModel: null });
  const knowledge = (await createSupabaseServerClient()).schema("knowledge");
  return assessRetrieval({ demo: false, databaseConfigured: true, activeModel: await activeModel(knowledge) });
}

/** Development tools for one call — refused outside IPA_RUNTIME_ENV=local/test (B-009). */
export interface RetrievalDevOptions {
  devForceInsufficient?: boolean;
}

export async function retrieveEvidence(request: ClassifiedRetrievalRequest, dev: RetrievalDevOptions = {}): Promise<EvidenceSet> {
  if (isDemoMode()) throw new RetrievalError("unavailable", "Retrieval kræver en database og er ikke tilgængelig i demoen.");
  // An active platform user is required. WHICH documents the user may read is decided by the
  // database (docs/07 §4.1): administrators through the role, advisors and leaders through
  // document grants — never through a role permission, so the role is not checked here.
  if (!(await getServerSession())) throw new RetrievalError("denied", "Du har ikke adgang til vidensgrundlaget.");

  const knowledge = (await createSupabaseServerClient()).schema("knowledge");
  const model = await activeModel(knowledge);
  const availability = assessRetrieval({ demo: false, databaseConfigured: true, activeModel: model });
  // Unavailable is a system failure, never an empty (= "insufficient") result.
  if (availability.state === "unavailable") throw new RetrievalError("unavailable", availability.reason);

  const reranker = retrievalReranker();
  const embedding = model ? { embedder: embedderFor(model), modelId: model.id } : null;
  return runRetrieval(request, { db: knowledge, embedding, reranker, config: DEFAULT_RETRIEVAL_CONFIG, devForceInsufficient: dev.devForceInsufficient === true });
}

/** retrieveEvidence as an explicit outcome for the UI: a failure is never an empty result. */
export async function retrieveEvidenceOutcome(request: ClassifiedRetrievalRequest, dev: RetrievalDevOptions = {}): Promise<RetrievalOutcome> {
  try {
    return { kind: "evidence", set: await retrieveEvidence(request, dev) };
  } catch (error) {
    if (error instanceof RetrievalError) {
      if (error.code === "invalid_request") return { kind: "invalid_request", message: error.message };
      if (error.code === "denied") return { kind: "denied", message: error.message };
      return { kind: "unavailable", message: error.message };
    }
    return { kind: "unavailable", message: "Søgningen kunne ikke gennemføres." };
  }
}
