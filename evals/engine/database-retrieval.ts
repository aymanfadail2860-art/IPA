import { syntheticText } from "../../src/lib/egress/synthetic.ts";
import type { EmbeddingProvider } from "../../src/lib/knowledge/core/embedding.ts";
import { retrievalFingerprintMaterial } from "../../src/lib/knowledge/core/provider.ts";
import type { RerankingProvider } from "../../src/lib/knowledge/core/reranker.ts";
import {
  DEFAULT_RETRIEVAL_CONFIG,
  RETRIEVAL_ALGORITHM_VERSION,
  runRetrieval,
  type KnowledgeRpcClient,
  type RetrievalConfig,
  type RetrievalObserver,
} from "../../src/lib/knowledge/retrieval-core.ts";

import { actorEmail, type ActorSession, type CorpusSnapshot, type EvaluationEnvironment } from "./evaluation-environment.ts";
import type { ConfigurationInput, EvalCase, Manifest, RetrievalRun, RetrievalUnderTest } from "./types.ts";

/**
 * The evaluation environment adapter (docs/08b §4.5; 8B-I7) — replaces the fixture adapter for
 * real runs. It runs the REAL retrieval (`runRetrieval`, the real SQL functions, RLS and the
 * access filter) against the evaluation project, signed in as each evaluation user. There is
 * no evaluation code in retrieval.
 *
 *   * environment: "evaluation" only because the database says so (checked before the run);
 *     the adapter refuses to start otherwise (H7).
 *   * actor: the identity the database reports for the call (knowledge.retrieval_context's
 *     executedAs) is compared with the evaluation user's id; a mismatch is reported, so H7 fails.
 *   * raw: every row the SQL functions returned — searched for leaks (H2).
 *   * chunkerVersions: from the corpus snapshot (P7/H6) — a chunk outside the corpus is uncovered.
 *   * observe: the duration of every step (§12), for the performance measurement.
 */

export interface DatabaseRetrievalOptions {
  env: EvaluationEnvironment;
  manifest: Manifest;
  /** Read before the run (provisioned corpus). */
  snapshot: CorpusSnapshot;
  embedder: EmbeddingProvider;
  /** The embedding model's id in the evaluation environment (its embeddings exist for every chunk). */
  embeddingModelId: string;
  reranker: RerankingProvider;
  baselineReranker: RerankingProvider;
  config?: RetrievalConfig;
  now?: () => Date;
  /** Step timings of the main run (not the Q7 baseline). */
  observe?: RetrievalObserver;
}

/** Captures what the SQL functions returned (H2) without changing it. */
function recording(db: KnowledgeRpcClient, log: unknown[]): KnowledgeRpcClient {
  return {
    async rpc(fn, args) {
      const result = await db.rpc(fn, args);
      if (fn !== "retrieval_context") log.push({ fn, data: result.data });
      return result;
    },
  };
}

export function createDatabaseRetrieval(options: DatabaseRetrievalOptions): RetrievalUnderTest {
  const { env, manifest, snapshot } = options;
  const config = options.config ?? DEFAULT_RETRIEVAL_CONFIG;
  const sessions = new Map<string, Promise<ActorSession & { verifiedUserId: string | null }>>();

  async function session(actor: string) {
    if (!manifest.actors.some((entry) => entry.id === actor)) throw new Error(`Ukendt evalueringsbruger: ${actor}.`);
    let pending = sessions.get(actor);
    if (!pending) {
      pending = (async () => {
        const signedIn = await env.signInUser(actorEmail(manifest.setId, actor), `Evalueringsbruger ${actor} (fiktiv)`, []);
        // Who the database says this client is (P6/H7).
        const { data } = await signedIn.client.schema("knowledge").rpc("retrieval_context");
        const executedAs = (data as { executedAs?: { role?: string; userId?: string | null } } | null)?.executedAs;
        const verifiedUserId = executedAs?.role === "authenticated" ? executedAs.userId ?? null : null;
        return { ...signedIn, verifiedUserId };
      })();
      sessions.set(actor, pending);
    }
    return pending;
  }

  function configuration(reranker: RerankingProvider): ConfigurationInput {
    return retrievalFingerprintMaterial({
      embedding: options.embedder.descriptor,
      reranker: reranker.descriptor,
      algorithmVersion: RETRIEVAL_ALGORITHM_VERSION,
      params: { ...config },
      chunkerVersions: [...new Set(Object.values(snapshot.chunkerVersions))].sort(),
    });
  }

  function adapter(reranker: RerankingProvider, baseline: boolean): RetrievalUnderTest {
    return {
      name: baseline ? "evaluation-database (uden reranker)" : "evaluation-database",
      environment: "evaluation",
      configuration: () => configuration(reranker),
      binding: () => snapshot.binding,
      versionText: (document, version) => snapshot.texts.get(`${document}\u0000${version}`) ?? null,
      // Read anew: a corpus that changes during the run is an H7 breach.
      corpusChecksum: async () => (await env.snapshot(manifest)).checksum,
      async run(evalCase: EvalCase): Promise<RetrievalRun> {
        const actor = await session(evalCase.actor);
        const log: unknown[] = [];
        const filters = evalCase.filters ?? {};
        const unknown = "00000000-0000-4000-8000-000000000000";
        const set = await runRetrieval(
          {
            // An evaluation question is synthetic material, scanned for customer data (8B-I2.5).
            query: syntheticText(evalCase.question),
            mode: evalCase.mode,
            ...(evalCase.asOf ? { asOf: evalCase.asOf } : {}),
            language: evalCase.language,
            ...(filters.products ? { productIds: filters.products.map((key) => snapshot.binding.products[key] ?? unknown) } : {}),
            ...(filters.documents ? { documentIds: filters.documents.map((key) => snapshot.binding.documents[key]?.documentId ?? unknown) } : {}),
            ...(filters.documentTypes ? { documentTypes: filters.documentTypes } : {}),
          },
          {
            db: recording(actor.client.schema("knowledge"), log),
            embedding: { embedder: options.embedder, modelId: options.embeddingModelId },
            reranker,
            config,
            now: options.now,
            ...(baseline ? {} : { observe: options.observe }),
          },
        );
        // H7: the run counts as the case's actor only when the database confirms the identity.
        const confirmed = actor.verifiedUserId !== null && actor.verifiedUserId === actor.authId;
        return { actor: confirmed ? evalCase.actor : `unverified:${evalCase.actor}`, set, raw: log, chunkerVersions: snapshot.chunkerVersions };
      },
      withoutReranker: () => (baseline ? null : adapter(options.baselineReranker, true)),
    };
  }

  return adapter(options.reranker, false);
}

/** The id of the embedder's model in the evaluation environment (it must exist; provisioning creates it). */
export async function embeddingModelIdFor(env: EvaluationEnvironment, embedder: EmbeddingProvider): Promise<string> {
  await env.assertEvaluation();
  const d = embedder.descriptor;
  const { data, error } = await env.admin
    .schema("knowledge")
    .from("embedding_models")
    .select("id, status")
    .eq("provider", d.provider)
    .eq("model_name", d.model)
    .eq("model_version", d.modelVersion)
    .in("status", ["active", "candidate"]);
  if (error) throw new Error(`modeller: ${error.message}`);
  const id = (data as { id: string }[] | null)?.[0]?.id;
  if (!id) throw new Error(`Modellen ${d.provider}:${d.model}@${d.modelVersion} findes ikke i evalueringsmiljøet. Kør provisioneringen først.`);
  return id;
}
