import { randomBytes, randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createEvaluationPublisher, sqlPublisherConnection } from "../../../evals/engine/publication.ts";
import type { EvaluationReport } from "../../../evals/engine/runner.ts";
import { userText } from "@/lib/egress/classification";
import { EvidenceGradeError, requireProductionEvidence } from "@/lib/knowledge/core/evidence";
import { DEFAULT_RETRIEVAL_CONFIG, runRetrieval, type RetrievalRequest } from "@/lib/knowledge/retrieval-core";

import { buildReport, GATES_V1 } from "../fixtures/evaluation-report";
import { buildPdf } from "../fixtures/knowledge-pdfs";
import { fixtureMaterial, productionProviders } from "../fixtures/production-config";

import { env, integrationConfigured, signedInClient } from "./helpers";
import { RUN, runProduct, runWorkerOnce, uploadVersion, workerConfigured } from "./knowledge-helpers";

/**
 * 8B-I6 — the configuration register against the real local database (docs/08b §9–§10):
 *
 *   * evaluation_publisher logs in with its own role (a throwaway local password) and registers
 *     a report built by the real engine; ordinary users, administrators and service_role cannot;
 *   * a human with system.settings.manage approves and activates — concurrently, too — and the
 *     database keeps exactly one configuration in service;
 *   * retrieval as a signed-in user, with the production adapters over a fake transport and the
 *     configuration's model, issues a ProductionEvidenceSet (P1–P9) — and falls to development
 *     with a changed parameter, as service_role, or once the configuration is suspended;
 *   * a regression run with a failed hard gate suspends; there is no fallback.
 *
 * No AWS and no production database: the Bedrock model row and its vectors are fixtures, and the
 * local test model is restored afterwards. Needs IPA_TEST_DB_ADMIN_URL (a LOCAL admin URL).
 */

const adminUrl = process.env.IPA_TEST_DB_ADMIN_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const configured = integrationConfigured && workerConfigured && Boolean(adminUrl) && /@(127\.0\.0\.1|localhost):/.test(adminUrl);

const BEDROCK_MODEL = { provider: "aws-bedrock", model_name: "cohere.embed-v4:0", model_version: "eu-1024-v1", dimensions: 1024 };
const marker = `registerkobolt${RUN}`;

function material(params: Partial<typeof DEFAULT_RETRIEVAL_CONFIG> = {}) {
  return fixtureMaterial({ params: { ...DEFAULT_RETRIEVAL_CONFIG, ...params } });
}

describe.skipIf(!configured)("retrieval configuration register against the local database (8B-I6)", () => {
  let admin: Sql;
  let publisherSql: Sql;
  let adminClient: SupabaseClient;
  let advisorClient: SupabaseClient;
  let serviceClient: SupabaseClient;
  let bedrockModelId: string;
  let testModelId: string | null;
  let documentTypes: string[];
  const configurations: Record<string, string> = {};
  let startedAt: Date;

  const knowledge = (client: SupabaseClient) => client.schema("knowledge");
  const publish = (report: EvaluationReport) => createEvaluationPublisher(sqlPublisherConnection(publisherSql)).publish(report, GATES_V1);
  const report = (label: string, options: Parameters<typeof buildReport>[0] = {}) =>
    buildReport({ runId: randomUUID(), label, documentTypes, ...options });
  const configurationOf = async (fingerprint: string) => (await admin<{ id: string }[]>`select id from knowledge.retrieval_configurations where fingerprint = ${fingerprint}`)[0]!.id;
  const latestRun = async (configurationId: string) =>
    (await admin<{ id: string }[]>`select id from knowledge.evaluation_runs where configuration_id = ${configurationId} order by registered_at desc limit 1`)[0]!.id;
  const rpc = async (client: SupabaseClient, fn: string, args: Record<string, unknown>) => {
    const { error } = await knowledge(client).rpc(fn, args);
    return error;
  };
  const approve = (configurationId: string, runId: string, notes: string[] = []) =>
    rpc(adminClient, "approve_retrieval_configuration", { p_configuration_id: configurationId, p_run_id: runId, p_root_cause_notes: notes });
  const activate = (client: SupabaseClient, configurationId: string) => rpc(client, "activate_retrieval_configuration", { p_configuration_id: configurationId });
  const retrieve = (client: SupabaseClient, request: Partial<RetrievalRequest> = {}) => {
    const providers = productionProviders();
    return runRetrieval(
      { query: userText(`Dækker forsikringen ${marker}?`, { caseBound: false, redacted: true }), ...request },
      { db: knowledge(client), embedding: { embedder: providers.embedder, modelId: bedrockModelId }, reranker: providers.reranker, config: DEFAULT_RETRIEVAL_CONFIG },
    );
  };

  /** Retire whatever is in service through the real functions (suspend, then retire). */
  async function takeOutOfService() {
    for (const row of await admin<{ id: string; status: string }[]>`select id, status from knowledge.retrieval_configurations where status in ('active', 'suspended', 'approved')`) {
      if (row.status === "active") await rpc(adminClient, "suspend_retrieval_configuration", { p_configuration_id: row.id, p_reason: "integrationstest: oprydning" });
      await rpc(adminClient, "retire_retrieval_configuration", { p_configuration_id: row.id, p_reason: "integrationstest: oprydning" });
    }
  }

  beforeAll(async () => {
    admin = postgres(adminUrl, { max: 2, onnotice: () => {} });
    adminClient = await signedInClient("admin");
    advisorClient = await signedInClient("advisorA");
    serviceClient = createClient(env.url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    // The publisher's identity: activated as in the runbook, with a throwaway local password.
    const password = randomBytes(24).toString("hex");
    await admin`select ops.evaluation_publisher_prepare()`;
    await admin.unsafe(`alter role evaluation_publisher_login password '${password}'`);
    const target = new URL(adminUrl);
    publisherSql = postgres({ host: target.hostname, port: Number(target.port), database: target.pathname.slice(1), username: "evaluation_publisher_login", password, max: 1, prepare: false, onnotice: () => {} });

    // A published document of our own (chunker structure/1).
    const productId = await runProduct(adminClient, "Register");
    const version = await uploadVersion(adminClient, await buildPdf([{ lines: [{ text: `Registerbetingelser ${RUN}`, size: 16, bold: true }, { text: "§ 1 Dækning", size: 13, bold: true, spaceBefore: 10 }, { text: `Forsikringen dækker fiktiv skade ${marker}.`, spaceBefore: 4 }] }]), {
      title: `Registerbetingelser ${RUN}`,
      productId,
      documentType: "terms",
      validFrom: "2020-01-01",
    });
    await runWorkerOnce();
    let error = await rpc(adminClient, "start_review", { p_version_id: version.versionId });
    if (error) throw error;
    error = await rpc(adminClient, "approve_version", { p_version_id: version.versionId, p_acknowledged_warnings: ["predecessor_superseded", "no_grants"] });
    if (error) throw error;

    // Nothing from earlier runs in service; the local test model is remembered for the restore.
    await takeOutOfService();
    testModelId = (await admin<{ id: string }[]>`select id from knowledge.embedding_models where provider = 'test' order by activated_at desc nulls last limit 1`)[0]?.id ?? null;
    startedAt = new Date();

    // The Bedrock model row (a fixture — models normally come with a migration) and its vectors
    // for every relevant chunk (100 % coverage, docs/08b §2.5). Local only.
    const [model] = await admin<{ id: string }[]>`
      insert into knowledge.embedding_models (provider, model_name, model_version, dimensions, status)
      values (${BEDROCK_MODEL.provider}, ${BEDROCK_MODEL.model_name}, ${BEDROCK_MODEL.model_version}, ${BEDROCK_MODEL.dimensions}, 'candidate')
      on conflict (provider, model_name, model_version) do update set status = 'candidate', retired_at = null
      returning id`;
    bedrockModelId = model!.id;
    await admin`
      insert into knowledge.chunk_embeddings (chunk_id, embedding_model_id, embedding, language, input_hash)
      select c.id, ${bedrockModelId}, ('[' || array_to_string(array_fill(0.01::numeric, array[1024]), ',') || ']')::extensions.vector, 'da',
             encode(sha256(convert_to(c.id::text || ${bedrockModelId}, 'UTF8')), 'hex')
      from knowledge.document_chunks c join knowledge.document_versions v on v.id = c.document_version_id
      where v.status in ('processed', 'under_review', 'rejected', 'published')
        and not exists (select 1 from knowledge.chunk_embeddings e where e.chunk_id = c.id and e.embedding_model_id = ${bedrockModelId})`;

    // The evaluated document types cover the local corpus (pilot scope).
    documentTypes = (await admin<{ t: string }[]>`
      select distinct d.document_type as t from knowledge.document_versions v join knowledge.documents d on d.id = v.document_id
      where v.status = 'published' order by 1`).map((row) => row.t);

    // The gate set: registered by the publisher, approved by a human (idempotent across runs).
    const gateSetId = await sqlPublisherConnection(publisherSql).registerGateSet(GATES_V1);
    const [gate] = await admin<{ approved_at: Date | null }[]>`select approved_at from knowledge.evaluation_gate_sets where id = ${gateSetId}`;
    if (!gate!.approved_at) {
      error = await rpc(adminClient, "approve_evaluation_gate_set", { p_gate_set_id: gateSetId });
      if (error) throw error;
    }
  }, 300_000);

  afterAll(async () => {
    if (!admin) return;
    await takeOutOfService();
    // Restore the local development model for the other suites (as the local seed does).
    // The worker embeds with the active model and every candidate: the fixture model must not stay either.
    await admin`update knowledge.embedding_models set status = 'retired', retired_at = now() where id = ${bedrockModelId ?? null} and status in ('active', 'candidate')`;
    if (testModelId) await admin`update knowledge.embedding_models set status = 'active', retired_at = null where id = ${testModelId}`;
    await admin`select ops.evaluation_publisher_deactivate('retired')`;
    await publisherSql?.end();
    await admin.end();
  });

  it("only evaluation_publisher can register a run — not a user, an administrator or service_role", async () => {
    const forged = report("it-forged");
    for (const client of [advisorClient, adminClient, serviceClient]) {
      const error = await rpc(client, "record_evaluation_run", { p_report: forged });
      expect(error, "record_evaluation_run").not.toBeNull();
    }
    const { error } = await knowledge(adminClient).from("evaluation_runs").insert({ run_id: "x" });
    expect(error).not.toBeNull();
    const { error: serviceInsert } = await knowledge(serviceClient).from("retrieval_configurations").update({ status: "active" }).neq("status", "x");
    expect(serviceInsert).not.toBeNull();
  });

  it("publishes the real engine's report as the publisher; the database registers a candidate", async () => {
    const reportA = report("it-config-a", { configuration: material() });
    const published = await publish(reportA);
    expect(published.reportChecksum).toBe(reportA.checksums.report);
    configurations.a = await configurationOf(reportA.configuration.declaredFingerprint);
    const [row] = await admin<{ status: string; passed: boolean; tier: string }[]>`
      select c.status, r.passed, r.tier from knowledge.retrieval_configurations c join knowledge.evaluation_runs r on r.configuration_id = c.id
      where c.id = ${configurations.a} and r.report_checksum = ${reportA.checksums.report}`;
    expect(row).toMatchObject({ passed: true, tier: "pilot" });
    expect(["candidate", "retired"]).toContain(row!.status);
  });

  it("refuses a report the publisher would refuse, even over the publisher's own connection", async () => {
    const tampered = report("it-tampered", { configuration: material() });
    tampered.metrics.mrr_at_k.value = 0.4;
    await expect(publisherSql`select knowledge.record_evaluation_run(${publisherSql.json(JSON.parse(JSON.stringify(tampered)))})`).rejects.toThrow(/report_checksum/);
  });

  it("'uncertain' is not 'pass': a 36-question pilot cannot be approved", async () => {
    const small = report("it-config-uncertain", { configuration: material({ minScore: 0.15 }), counts: { direct: 20, historical: 3, conflict: 2, distractor: 3, unanswerable: 5, permission: 3 } });
    expect(small.verdict).toBe("uncertain");
    await publish(small);
    const id = await configurationOf(small.configuration.declaredFingerprint);
    const error = await approve(id, await latestRun(id));
    expect(error?.message).toMatch(/afgørelsen er "uncertain"/);
  });

  it("every failure needs a written root-cause note before approval (pilot rule 3)", async () => {
    const withMiss = report("it-config-notes", {
      configuration: material({ minScore: 0.12 }),
      counts: { direct: 150 },
      observe: (cases) => {
        cases[0]!.sourceRank = null;
      },
    });
    expect(withMiss.verdict).toBe("pass");
    expect(withMiss.failures).toHaveLength(1);
    await publish(withMiss);
    configurations.notes = await configurationOf(withMiss.configuration.declaredFingerprint);
    const run = await latestRun(configurations.notes);
    expect((await approve(configurations.notes, run))?.message).toMatch(/root_cause_notes/);
    expect((await approve(configurations.notes, run, ["kort"]))?.message).toMatch(/root_cause_notes/);
    expect(await approve(configurations.notes, run, ["Fiktiv årsag: spørgsmålet henviser til et afsnit uden for korpusset."])).toBeNull();
    const [transition] = await admin<{ root_cause_notes: unknown }[]>`
      select root_cause_notes from knowledge.retrieval_configuration_transitions where configuration_id = ${configurations.notes} and to_status = 'approved' order by id desc limit 1`;
    expect(transition!.root_cause_notes).toEqual(["Fiktiv årsag: spørgsmålet henviser til et afsnit uden for korpusset."]);
  });

  it("an administrator approves and activates; an advisor cannot; direct updates are refused", async () => {
    expect((await rpc(advisorClient, "approve_retrieval_configuration", { p_configuration_id: configurations.a, p_run_id: await latestRun(configurations.a), p_root_cause_notes: [] }))?.code).toBe("42501");
    expect(await approve(configurations.a, await latestRun(configurations.a))).toBeNull();
    const { error: direct } = await knowledge(adminClient).from("retrieval_configurations").update({ status: "active" }).eq("id", configurations.a);
    expect(direct).not.toBeNull();
    expect((await activate(advisorClient, configurations.a))?.code).toBe("42501");
    expect(await activate(adminClient, configurations.a)).toBeNull();
    const [state] = await admin<{ active: number; model: string }[]>`
      select (select count(*)::int from knowledge.retrieval_configurations where status = 'active') as active,
             (select status from knowledge.embedding_models where id = ${bedrockModelId}) as model`;
    expect(state).toEqual({ active: 1, model: "active" });
  });

  it("P1–P9 end to end: retrieval as the signed-in user issues a ProductionEvidenceSet", async () => {
    const set = await retrieve(adminClient);
    expect(set.retrieval.unmet).toEqual([]);
    expect(set.retrieval.grade).toBe("production");
    expect(set.retrieval.configuration?.id).toBe(configurations.a);
    expect(set.items.some((item) => item.excerpt.text.includes(marker))).toBe(true);
    expect(set.items.every((item) => item.chunkerVersion === "structure/1")).toBe(true);
    expect(requireProductionEvidence(set)).toBe(set);
  });

  it("falls to development with a changed parameter (P4) and is never production as service_role (P6)", async () => {
    const changed = await retrieve(adminClient, { topK: 3 });
    expect(changed.retrieval.unmet).toEqual(["P4"]);
    expect(() => requireProductionEvidence(changed)).toThrow(EvidenceGradeError);
    const asService = await retrieve(serviceClient).catch((error: unknown) => error);
    if (asService instanceof Error) expect(asService.name).toBe("RetrievalError");
    else expect((asService as Awaited<ReturnType<typeof retrieve>>).retrieval.grade).toBe("development");
  });

  it("concurrent activations never leave two configurations active", async () => {
    const reportB = report("it-config-b", { configuration: material({ minScore: 0.2 }) });
    await publish(reportB);
    configurations.b = await configurationOf(reportB.configuration.declaredFingerprint);
    expect(await approve(configurations.b, await latestRun(configurations.b))).toBeNull();
    const secondAdmin = await signedInClient("admin");
    const results = await Promise.all([activate(adminClient, configurations.b), activate(secondAdmin, configurations.notes), activate(secondAdmin, configurations.b)]);
    // B and the notes configuration were both approved: each activation replaces the one before;
    // the second activation of B finds it no longer approved, or replaced — never two active.
    expect(results.filter((error) => error !== null).every((error) => /status|godkendt/.test(error!.message))).toBe(true);
    const [state] = await admin<{ active: number; in_service: number }[]>`
      select count(*) filter (where status = 'active')::int as active, count(*) filter (where status in ('active', 'suspended'))::int as in_service
      from knowledge.retrieval_configurations`;
    expect(state).toEqual({ active: 1, in_service: 1 });
  });

  it("suspension: development evidence at once, retrieval continues, no fallback", async () => {
    const [active] = await admin<{ id: string }[]>`select id from knowledge.retrieval_configurations where status = 'active'`;
    expect(await rpc(adminClient, "suspend_retrieval_configuration", { p_configuration_id: active!.id, p_reason: "integrationstest: fiktiv vurdering" })).toBeNull();
    const set = await retrieve(adminClient);
    expect(set.retrieval.grade).toBe("development");
    expect(set.retrieval.unmet).toContain("P3");
    expect(set.retrieval.configuration?.id).toBe(active!.id);
    expect((await admin`select 1 from knowledge.retrieval_configurations where status = 'active'`).length).toBe(0);
  });

  it("a regression run with a failed hard gate suspends the active configuration automatically (D-8)", async () => {
    await takeOutOfService();
    const reportC = report("it-config-c", { configuration: material({ minScore: 0.25 }) });
    await publish(reportC);
    configurations.c = await configurationOf(reportC.configuration.declaredFingerprint);
    expect(await approve(configurations.c, await latestRun(configurations.c))).toBeNull();
    expect(await activate(adminClient, configurations.c)).toBeNull();
    await publish(report("it-config-c", { configuration: material({ minScore: 0.25 }), violations: [{ gate: "H1", caseId: null, explanation: "Fiktivt brud i regression." }] }));
    // A run-level H1 breach is registered as a regression run and suspends.
    const [row] = await admin<{ status: string; suspension_reason: string }[]>`select status, suspension_reason from knowledge.retrieval_configurations where id = ${configurations.c}`;
    expect(row).toEqual({ status: "suspended", suspension_reason: "hard_gate_failed" });
  });

  it("history explains every decision with ids, checksums and fingerprints — never document text", async () => {
    const { data: runs, error } = await knowledge(adminClient).from("evaluation_runs").select("report_checksum, gate_set_checksum, configuration_fingerprint, tier, verdict").eq("configuration_id", configurations.a);
    expect(error).toBeNull();
    expect(runs!.length).toBeGreaterThan(0);
    const { data: advisorView } = await knowledge(advisorClient).from("evaluation_runs").select("id");
    expect(advisorView).toEqual([]);
    const audit = await admin<{ action: string; details: Record<string, unknown> }[]>`
      select action, details from audit.audit_log
      where (action like 'knowledge.retrieval_configuration.%' or action = 'knowledge.evaluation_run.published') and occurred_at >= ${startedAt}`;
    expect([...new Set(audit.map((entry) => entry.action))]).toEqual(
      expect.arrayContaining(["knowledge.evaluation_run.published", "knowledge.retrieval_configuration.approved", "knowledge.retrieval_configuration.activated",
                              "knowledge.retrieval_configuration.replaced", "knowledge.retrieval_configuration.suspended", "knowledge.retrieval_configuration.retired"]),
    );
    expect(audit.filter((entry) => entry.action !== "knowledge.evaluation_run.published").every((entry) => typeof entry.details.fingerprint === "string")).toBe(true);
    expect(JSON.stringify(audit)).not.toContain(marker);
  });
});
