import { randomUUID } from "node:crypto";

import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseRetrieval, embeddingModelIdFor } from "../../../evals/engine/database-retrieval.ts";
import { connectEvaluationEnvironment, NotAnEvaluationEnvironmentError, type EvaluationEnvironment } from "../../../evals/engine/evaluation-environment.ts";
import { loadInputs, type LoadedInputs } from "../../../evals/engine/loader.ts";
import { runEvaluationOperation } from "../../../evals/engine/operations.ts";
import { performanceResults } from "../../../evals/engine/performance.ts";
import { provisionEvaluationCorpus } from "../../../evals/engine/provision.ts";
import { runEvaluation } from "../../../evals/engine/runner.ts";
import { createEmbedder, createEvaluationBaselineReranker, createReranker } from "@/lib/knowledge/core/registry";
import { TEST_EMBEDDER } from "@/lib/knowledge/core/test-embedder";
import { EMBED_V4_EU_1024_DESCRIPTOR } from "@/lib/knowledge/providers/bedrock/cohere-embed-v4";
import { COHERE_RERANK_35_ID } from "@/lib/knowledge/providers/bedrock/cohere-rerank-3-5";
import { createProductionReranker, embeddingModelRow } from "@/lib/knowledge/providers/catalog";
import { createRuntimeEmbedder } from "@/lib/knowledge/providers/runtime";

import { devFakeBedrockTransport } from "../../../workers/ingestion/dev-fake-bedrock.ts";

import { env, integrationConfigured } from "./helpers";
import { RUN, runWorkerOnce, workerConfigured } from "./knowledge-helpers";

/**
 * 8B-I7 — evaluation operations against a local evaluation environment (docs/08b §4.5):
 *
 *   * the evaluation refuses a database that is not an evaluation environment, before anything
 *     is read or written;
 *   * provisioning ingests the evaluation corpus through the normal path (quarantine, the real
 *     worker, review, publication), creates the evaluation users with exactly the manifest's
 *     grants and flags the conflicts — idempotently;
 *   * a run executes the REAL retrieval as each evaluation user: the database confirms the
 *     identity (H7), the corpus checksum is stable, the scope names the stable product ids, and
 *     every step is timed for the performance measurement;
 *   * a corpus that changes during the run is an H7 breach.
 *
 * The local database plays the evaluation environment for this file only (ops.environment is
 * set and restored). Development providers: the run is invalid by H6 — on purpose.
 *
 * 8B-I8 C7: the PRODUCTION adapters (Cohere Embed v4, Rerank 3.5) on the development fake
 * Bedrock transport, end to end: provisioning registers Embed v4, the real worker (a separate
 * process, IPA_DEV_FAKE_BEDROCK=1) embeds the corpus with it, and the evaluation retrieves with
 * the same model — every hard gate passes, H6 included.
 */

const adminUrl = process.env.IPA_TEST_DB_ADMIN_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const configured = integrationConfigured && workerConfigured && Boolean(adminUrl) && /@(127\.0\.0\.1|localhost):/.test(adminUrl);

describe.skipIf(!configured)("evaluation operations against a local evaluation environment (8B-I7)", () => {
  let admin: Sql;
  let previousKind: string | null;
  let evaluation: EvaluationEnvironment;
  let inputs: LoadedInputs;
  const embedder = createEmbedder({ id: "00000000-0000-4000-b000-000000000001", ...TEST_EMBEDDER });
  const reranker = createReranker();
  const baselineReranker = createReranker("none");

  const setKind = (kind: string) => admin`select ops.set_environment_kind(${kind})`;

  beforeAll(async () => {
    admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
    previousKind = (await admin<{ kind: string }[]>`select kind from ops.environment`)[0]?.kind ?? null;
    await setKind("evaluation");
    evaluation = connectEvaluationEnvironment({ url: env.url, anonKey: env.anonKey, serviceRoleKey: serviceKey });
    const loaded = loadInputs({ set: "example-v1", gates: "gates-v1", configuration: "fixture-development" });
    // This run's own copy: unique set id, products with fresh stable ids and names (the local
    // database is shared with the other suites).
    loaded.set.manifest = {
      ...loaded.set.manifest,
      setId: `itest-${RUN}`,
      products: loaded.set.manifest.products.map((product) => ({ ...product, id: randomUUID(), name: `${product.name} ${RUN}` })),
    };
    inputs = loaded;
  }, 120_000);

  afterAll(async () => {
    if (!admin) return;
    if (previousKind) await setKind(previousKind);
    else await admin`delete from ops.environment`;
    await admin.end();
  });

  it("refuses a database that is not an evaluation environment — before anything is read or written", async () => {
    await setKind("production");
    try {
      const other = connectEvaluationEnvironment({ url: env.url, anonKey: env.anonKey, serviceRoleKey: serviceKey });
      await expect(other.assertEvaluation()).rejects.toBeInstanceOf(NotAnEvaluationEnvironmentError);
      await expect(other.snapshot(inputs.set.manifest)).rejects.toBeInstanceOf(NotAnEvaluationEnvironmentError);
      await expect(provisionEvaluationCorpus({ env: other, manifest: inputs.set.manifest, fixtures: inputs.fixtures, embedders: [embedder] })).rejects.toBeInstanceOf(
        NotAnEvaluationEnvironmentError,
      );
      const [{ n }] = await admin<{ n: number }[]>`select count(*)::int as n from knowledge.products where name like ${`%${RUN}`}`;
      expect(n).toBe(0);
    } finally {
      await setKind("evaluation");
    }
  });

  it("provisions the corpus through the normal path, idempotently, with exactly the manifest's grants", async () => {
    const first = await provisionEvaluationCorpus({ env: evaluation, manifest: inputs.set.manifest, fixtures: inputs.fixtures, embedders: [embedder], awaitWorker: async () => void (await runWorkerOnce()) });
    const versions = inputs.set.manifest.documents.reduce((n, document) => n + document.versions.length, 0);
    expect(first.uploaded).toBe(versions);
    expect(first.published).toBe(versions);
    // Ingestion is measured per version (pages and seconds) for §12.
    expect(first.ingestion.documents).toHaveLength(versions);
    expect(first.ingestion.documents.every((d) => d.pages >= 1 && d.seconds >= 0)).toBe(true);

    const snapshot = await evaluation.snapshot(inputs.set.manifest);
    // The products carry the manifest's stable ids (B-031).
    expect(snapshot.binding.products).toEqual(Object.fromEntries(inputs.set.manifest.products.map((p) => [p.key, p.id])));
    const statuses = [...snapshot.versions.values()].map((version) => version.status);
    expect(statuses.every((status) => status === "published")).toBe(true);
    // Every manifest conflict is flagged; every evaluation user has exactly its grants and no role.
    expect(Object.keys(snapshot.binding.conflicts).sort()).toEqual(inputs.set.manifest.conflicts.map((c) => c.id).sort());
    type Actor = (typeof inputs.set.manifest.actors)[number];
    const userOf = async (actor: Actor) => {
      const [user] = await admin<{ id: string; roles: number }[]>`
        select u.id, (select count(*)::int from identity.user_roles r where r.user_id = u.id) as roles
        from identity.users u join auth.users a on a.id = u.auth_id where a.email = ${`eval.${inputs.set.manifest.setId}.${actor.id}@evaluation.invalid`}`;
      return user!;
    };
    const grantsOf = async (actor: Actor) => {
      const grants = await admin<{ document_id: string; permission_key: string }[]>`
        select document_id, permission_key from knowledge.document_access_grants where grantee_type = 'user' and user_id = ${(await userOf(actor)).id}`;
      return grants.map((g) => `${g.document_id}|${g.permission_key}`).sort();
    };
    const expectedOf = (actor: Actor) =>
      actor.grants.flatMap((grant) => [
        `${snapshot.binding.documents[grant.document]!.documentId}|knowledge.document.read`,
        ...(grant.historical ? [`${snapshot.binding.documents[grant.document]!.documentId}|knowledge.document.read_historical`] : []),
      ]).sort();
    for (const actor of inputs.set.manifest.actors) {
      expect((await userOf(actor)).roles).toBe(0);
      expect(await grantsOf(actor)).toEqual(expectedOf(actor));
    }

    // A grant given by hand outside the manifest is removed by the next provisioning.
    const documentKeys = Object.keys(snapshot.binding.documents);
    const restricted = inputs.set.manifest.actors.find((actor) => documentKeys.some((key) => !actor.grants.some((grant) => grant.document === key)))!;
    const stray = documentKeys.find((key) => !restricted.grants.some((grant) => grant.document === key))!;
    await admin`insert into knowledge.document_access_grants (document_id, permission_key, grantee_type, user_id)
      values (${snapshot.binding.documents[stray]!.documentId}, 'knowledge.document.read', 'user', ${(await userOf(restricted)).id})`;
    expect(await grantsOf(restricted)).not.toEqual(expectedOf(restricted));

    // Again: nothing new — the same corpus (checksum) for a reproducible regression.
    const second = await provisionEvaluationCorpus({ env: evaluation, manifest: inputs.set.manifest, fixtures: inputs.fixtures, embedders: [embedder], awaitWorker: async () => void (await runWorkerOnce()) });
    expect(second.uploaded).toBe(0);
    expect(second.published).toBe(0);
    expect((await evaluation.snapshot(inputs.set.manifest)).checksum).toBe(snapshot.checksum);
    expect(await grantsOf(restricted)).toEqual(expectedOf(restricted));
  }, 600_000);

  it("runs the real retrieval as each evaluation user: identity confirmed (H7), stable ids in the scope, every step timed", async () => {
    const { report, performance } = await runEvaluationOperation({ inputs, mode: "baseline", embedder, reranker, baselineReranker, env: evaluation, provision: false });
    expect(report.configuration.environment).toBe("evaluation");
    expect(report.hardGates.find((gate) => gate.id === "H7")).toMatchObject({ status: "pass", violations: 0 });
    // The real SQL functions, RLS and the evaluation users' grants: no access, leak, validity,
    // filter or conflict breach (H1–H5).
    expect(report.hardGates.filter((gate) => ["H1", "H2", "H3", "H4", "H5"].includes(gate.id)).every((gate) => gate.status === "pass")).toBe(true);
    // Development providers: invalid by H6, so never registrable — on purpose here.
    expect(report.hardGates.find((gate) => gate.id === "H6")?.status).toBe("fail");
    expect(report.corpus.checksumBefore).toBe(report.corpus.checksumAfter);
    expect(new Set(report.corpus.scope.map((entry) => entry.productId))).toEqual(new Set(inputs.set.manifest.products.map((p) => p.id)));

    const active = inputs.set.cases.filter((c) => !c.retired).length;
    expect(performance.environment).toBe("evaluation");
    expect(performance.runId).toBe(report.runId);
    expect(performance.configurationFingerprint).toBe(report.configuration.runtimeFingerprint);
    expect(performance.retrieval.total).toHaveLength(active);
    expect(performance.retrieval.search).toHaveLength(active);
    expect(performance.retrieval.queryEmbedding).toHaveLength(active);
    expect(performance.results).toEqual(performanceResults(performance.retrieval, performance.ingestion));
  }, 300_000);

  it("the production adapters run end to end: Embed v4 in the worker, the same model in retrieval and evaluation (8B-I8 C7)", async () => {
    const previous = process.env.IPA_DEV_FAKE_BEDROCK;
    process.env.IPA_DEV_FAKE_BEDROCK = "1";
    // The model row comes with a migration in production (§2.5); another suite may have retired the same fixture row.
    const row = embeddingModelRow(EMBED_V4_EU_1024_DESCRIPTOR);
    await admin`
      insert into knowledge.embedding_models (provider, model_name, model_version, dimensions, status)
      values (${row.provider}, ${row.model_name}, ${row.model_version}, ${row.dimensions}, 'candidate')
      on conflict (provider, model_name, model_version) do update set status = 'candidate', retired_at = null`;
    let modelId = "";
    try {
      const runtime = () => ({ bedrock: devFakeBedrockTransport() });
      const v4 = createRuntimeEmbedder({ id: "00000000-0000-4000-b000-0000000000c7", ...row }, runtime, "test");
      const rerank35 = createProductionReranker(COHERE_RERANK_35_ID, runtime());
      expect(v4.grade).toBe("production");

      // Provisioning: the corpus (already ingested with the development model) gets Embed v4 —
      // re-embedding requested and done by the worker with the production adapter.
      await provisionEvaluationCorpus({ env: evaluation, manifest: inputs.set.manifest, fixtures: inputs.fixtures, embedders: [v4], awaitWorker: async () => void (await runWorkerOnce()) });
      modelId = await embeddingModelIdFor(evaluation, v4);
      const snapshot = await evaluation.snapshot(inputs.set.manifest);
      const versionIds = [...snapshot.versions.keys()];
      const [mine] = await admin<{ chunks: number; embedded: number; wrong: number; distinct: number }[]>`
        select count(distinct c.id)::int as chunks, count(e.chunk_id)::int as embedded,
               count(*) filter (where e.chunk_id is not null and extensions.vector_dims(e.embedding) <> 1024)::int as wrong,
               count(distinct e.embedding::text)::int as distinct
        from knowledge.document_chunks c
        left join knowledge.chunk_embeddings e on e.chunk_id = c.id and e.embedding_model_id = ${modelId}
        where c.document_version_id = any(${versionIds}::uuid[])`;
      // Every chunk of the evaluation corpus, 1024 dimensions, real per-text vectors (not a fixture constant).
      expect(mine!.embedded).toBe(mine!.chunks);
      expect(mine!.wrong).toBe(0);
      expect(mine!.distinct).toBeGreaterThan(1);
      const [model] = await admin<{ provider: string; model_name: string; model_version: string; dimensions: number }[]>`
        select provider, model_name, model_version, dimensions from knowledge.embedding_models where id = ${modelId}`;
      expect(model).toEqual(row);

      // The evaluation: the declared production configuration, run with exactly these adapters.
      const declared = loadInputs({ set: "example-v1", gates: "gates-v1", configuration: "bedrock-embed-v4-eu-1024-rerank-3-5-structure-1" }).declared;
      const { report } = await runEvaluationOperation({
        inputs: { ...inputs, declared }, mode: "baseline", embedder: v4, reranker: rerank35, baselineReranker: createEvaluationBaselineReranker(), env: evaluation, provision: false,
      });
      // Ingestion, retrieval and evaluation agree on the model and the configuration.
      expect(report.configuration.runtime.embedding).toMatchObject({ provider: row.provider, model: row.model_name, modelVersion: row.model_version, dimensions: row.dimensions });
      expect({ declared: report.configuration.declared, runtime: report.configuration.runtime }).toEqual({ declared: report.configuration.runtime, runtime: report.configuration.runtime });
      expect(report.configuration.matches).toBe(true);
      expect(report.configuration.runtimeFingerprint).toBe(report.configuration.declaredFingerprint);
      expect(report.hardGates.map((gate) => [gate.id, gate.status])).toEqual(["H1", "H2", "H3", "H4", "H5", "H6", "H7"].map((id) => [id, "pass"]));
    } finally {
      if (previous === undefined) delete process.env.IPA_DEV_FAKE_BEDROCK;
      else process.env.IPA_DEV_FAKE_BEDROCK = previous;
      // The other suites' workers run without the fake transport: the model must not stay a candidate.
      await admin`update knowledge.embedding_models set status = 'retired', retired_at = now()
        where provider = ${row.provider} and model_name = ${row.model_name} and model_version = ${row.model_version} and status in ('active', 'candidate')`;
    }
  }, 600_000);

  it("a corpus that changes during the run is an H7 breach", async () => {
    const snapshot = await evaluation.snapshot(inputs.set.manifest);
    const inner = createDatabaseRetrieval({
      env: evaluation, manifest: inputs.set.manifest, snapshot, embedder, embeddingModelId: await embeddingModelIdFor(evaluation, embedder), reranker, baselineReranker,
    });
    const documentId = Object.values(snapshot.binding.documents)[0]!.documentId;
    let changed = false;
    const report = await runEvaluation({
      set: inputs.set, gates: inputs.gates, declared: { label: inputs.declared.label, configuration: inputs.declared.configuration },
      retrieval: {
        ...inner,
        async run(evalCase) {
          if (!changed) {
            changed = true;
            await admin`insert into knowledge.document_access_grants (document_id, permission_key, grantee_type) values (${documentId}, 'knowledge.document.read', 'all_users')`;
          }
          return inner.run(evalCase);
        },
      },
    });
    await admin`delete from knowledge.document_access_grants where document_id = ${documentId} and grantee_type = 'all_users'`;
    expect(report.corpus.checksumAfter).not.toBe(report.corpus.checksumBefore);
    expect(report.failures.filter((f) => f.gate === "H7").map((f) => f.explanation)).toEqual(["Korpussets checksum ændrede sig under kørslen."]);
    expect(report.hardGates.find((gate) => gate.id === "H7")).toMatchObject({ status: "fail", violations: 1 });
  }, 300_000);
});
