import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { writeVersionedReport } from "../../../evals/engine/operations.ts";
import { buildPerformanceMeasurement, type PerformanceMeasurement } from "../../../evals/engine/performance.ts";
import { createEvaluationPublisher, sqlPublisherConnection, type SqlClient } from "../../../evals/engine/publication.ts";
import { publishEvaluation } from "../../../workers/evaluation/publish-run.ts";
import type { Alert, AlertSink } from "@/lib/observability/alerts";
import { evaluateHealth, INITIAL_HEALTH_STATE, parseSystemHealth } from "@/lib/observability/health";
import type { EvaluationReport } from "../../../evals/engine/runner.ts";
import { userText } from "@/lib/egress/classification";
import { EvidenceGradeError, requireProductionEvidence } from "@/lib/knowledge/core/evidence";
import { DEFAULT_RETRIEVAL_CONFIG, runRetrieval, type RetrievalRequest } from "@/lib/knowledge/retrieval-core";

import { buildReport, GATES_V1, UNCERTAIN_PILOT_COUNTS, UNCERTAIN_STANDARD_COUNTS } from "../fixtures/evaluation-report";
import { buildPdf } from "../fixtures/knowledge-pdfs";
import { fixtureMaterial, productionProviders, type FixtureScopeEntry } from "../fixtures/production-config";

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
  let scope: FixtureScopeEntry[];
  let registerProductId: string;
  let otherProductId: string;
  let namesakeProductId: string;
  const configurations: Record<string, string> = {};
  let startedAt: Date;

  const knowledge = (client: SupabaseClient) => client.schema("knowledge");
  const publish = (report: EvaluationReport) => createEvaluationPublisher(sqlPublisherConnection(publisherSql)).publish(report, GATES_V1);
  const report = (label: string, options: Parameters<typeof buildReport>[0] = {}) =>
    buildReport({ runId: randomUUID(), label, scope, ...options });
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
      // The evaluated product only — the corpus of other suites is outside the approved scope.
      { query: userText(`Dækker forsikringen ${marker}?`, { caseBound: false, redacted: true }), productIds: [registerProductId], ...request },
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
    registerProductId = productId;
    const version = await uploadVersion(adminClient, await buildPdf([{ lines: [{ text: `Registerbetingelser ${RUN}`, size: 16, bold: true }, { text: "§ 1 Dækning", size: 13, bold: true, spaceBefore: 10 }, { text: `Forsikringen dækker fiktiv skade ${marker}.`, spaceBefore: 4 }] }]), {
      title: `Registerbetingelser ${RUN}`,
      productId,
      documentType: "terms",
      validFrom: "2020-01-01",
    });
    // A product that is never evaluated: same document type, other product family (8B-I6.1). Other
    // wording than ours, so it is not linked as duplicate content (a conflict counterpart is an item).
    otherProductId = await runProduct(adminClient, "Uevalueret");
    const other = await uploadVersion(adminClient, await buildPdf([{ lines: [{ text: `Uevaluerede betingelser ${RUN}`, size: 16, bold: true }, { text: "§ 1 Dækning", size: 13, bold: true, spaceBefore: 10 }, { text: `Den uevaluerede produktfamilie dækker også fiktiv skade ${marker}.`, spaceBefore: 4 }] }]), {
      title: `Uevaluerede betingelser ${RUN}`,
      productId: otherProductId,
      documentType: "terms",
      validFrom: "2020-01-01",
    });
    // A product that will later carry the evaluated product's old name (8B-I6.2): another stable id.
    namesakeProductId = await runProduct(adminClient, "Navnefælle");
    const namesake = await uploadVersion(adminClient, await buildPdf([{ lines: [{ text: `Navnefællens betingelser ${RUN}`, size: 16, bold: true }, { text: "§ 1 Dækning", size: 13, bold: true, spaceBefore: 10 }, { text: `Navnefællens forsikring omfatter ligeledes fiktiv skade ${marker}.`, spaceBefore: 4 }] }]), {
      title: `Navnefællens betingelser ${RUN}`,
      productId: namesakeProductId,
      documentType: "terms",
      validFrom: "2020-01-01",
    });
    await runWorkerOnce();
    let error: Awaited<ReturnType<typeof rpc>> = null;
    for (const versionId of [version.versionId, other.versionId, namesake.versionId]) {
      error = await rpc(adminClient, "start_review", { p_version_id: versionId });
      if (error) throw error;
      error = await rpc(adminClient, "approve_version", { p_version_id: versionId, p_acknowledged_warnings: ["predecessor_superseded", "no_grants"] });
      if (error) throw error;
    }

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

    // The evaluated area: our own product's terms only (pilot scope, 8B-I6.1).
    // The product is identified by its stable id; the name is the snapshot at evaluation time (8B-I6.2).
    scope = [{ documentType: "terms", productId: registerProductId, productName: `Testprodukt Register ${RUN} (fiktiv)` }];

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

  it("pilot: 'uncertain' is never converted automatically — it needs an explicit human acceptance (B-030)", async () => {
    const small = report("it-config-uncertain", { configuration: material({ minScore: 0.15 }), counts: UNCERTAIN_PILOT_COUNTS });
    expect(small.verdict).toBe("uncertain");
    expect(small.tier).toBe("pilot");
    await publish(small);
    const id = await configurationOf(small.configuration.declaredFingerprint);
    const run = await latestRun(id);
    const [registered] = await admin<{ outcome: string; uncertain_gates: string[] }[]>`select outcome, uncertain_gates from knowledge.evaluation_runs where id = ${run}`;
    expect(registered).toEqual({ outcome: "pass_with_uncertainty", uncertain_gates: ["Q1", "Q4", "Q5"] });
    expect((await approve(id, run))?.message).toMatch(/ikke accepteret af et menneske/);
    expect((await rpc(advisorClient, "accept_evaluation_uncertainty", { p_run_id: run, p_justification: "Rådgiverens forsøg på at acceptere usikkerheden." }))?.code).toBe("42501");
    expect(await rpc(adminClient, "accept_evaluation_uncertainty", { p_run_id: run, p_justification: "Fiktiv accept: begrænset pilot med tæt opfølgning." })).toBeNull();
    const [acceptance] = await admin<{ accepted_by: string; scope: unknown; gates: string[] }[]>`
      select accepted_by, scope, (select array_agg(g ->> 'id' order by g ->> 'id') from jsonb_array_elements(uncertain_gates) g) as gates
      from knowledge.evaluation_uncertainty_acceptances where run_id = ${run}`;
    expect(acceptance).toMatchObject({ scope, gates: ["Q1", "Q4", "Q5"] });
    expect(acceptance!.accepted_by).toBeTruthy();
    expect(await approve(id, run)).toBeNull();
  });

  it("standard: an uncertain run can neither be approved nor accepted — the quality bar is unchanged", async () => {
    const wide = report("it-config-standard-uncertain", { configuration: material({ minScore: 0.16 }), counts: UNCERTAIN_STANDARD_COUNTS });
    expect(wide).toMatchObject({ verdict: "uncertain", tier: "standard" });
    await publish(wide);
    const id = await configurationOf(wide.configuration.declaredFingerprint);
    const run = await latestRun(id);
    expect((await approve(id, run))?.message).toMatch(/statistisk sikre/);
    expect((await rpc(adminClient, "accept_evaluation_uncertainty", { p_run_id: run, p_justification: "Forsøg på at acceptere standard-usikkerhed." }))?.message).toMatch(/not_uncertain/);
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

  it("pilot scope: a never-evaluated product with the same document type does not inherit production grade (P3)", async () => {
    const outside = await retrieve(adminClient, { productIds: [otherProductId] });
    expect(outside.items.length).toBeGreaterThan(0);
    expect(outside.items.every((item) => item.document.type === "terms")).toBe(true);
    expect(outside.retrieval.grade).toBe("development");
    expect(outside.retrieval.unmet).toEqual(["P3"]);
    expect(() => requireProductionEvidence(outside)).toThrow(EvidenceGradeError);
    // Both products together: one item outside the scope makes the whole set development.
    const mixed = await retrieve(adminClient, { productIds: [registerProductId, otherProductId] });
    expect(new Set(mixed.items.map((item) => item.product.id)).size).toBe(2);
    expect(mixed.retrieval.unmet).toEqual(["P3"]);
    // The evaluated product stays production.
    expect((await retrieve(adminClient)).retrieval.grade).toBe("production");
  });

  it("stable identity: a renamed product stays in scope, a new product with its old name does not; history keeps the old name (8B-I6.2)", async () => {
    const oldName = `Testprodukt Register ${RUN} (fiktiv)`;
    const newName = `Testprodukt Register ${RUN} omdøbt (fiktiv)`;
    const rename = async (id: string, name: string) => {
      const { error } = await adminClient.schema("knowledge").from("products").update({ name }).eq("id", id);
      if (error) throw error;
    };
    await rename(registerProductId, newName);
    // The evaluated product keeps its id: still production, under its new name.
    const renamed = await retrieve(adminClient);
    expect(renamed.items.length).toBeGreaterThan(0);
    expect(renamed.items.every((item) => item.product.id === registerProductId && item.product.name === newName)).toBe(true);
    expect(renamed.retrieval.unmet).toEqual([]);
    expect(renamed.retrieval.grade).toBe("production");

    // Another product takes over the old name: another id, so it never inherits the approval.
    await rename(namesakeProductId, oldName);
    const namesake = await retrieve(adminClient, { productIds: [namesakeProductId] });
    expect(namesake.items.length).toBeGreaterThan(0);
    expect(namesake.items.every((item) => item.product.name === oldName && item.document.type === "terms")).toBe(true);
    expect(namesake.retrieval.unmet).toEqual(["P3"]);
    expect(() => requireProductionEvidence(namesake)).toThrow(EvidenceGradeError);

    // History is never rewritten: the approving run and the acceptance keep id AND the old name.
    const [history] = await admin<{ evaluated: unknown }[]>`
      select r.evaluated_scope as evaluated
      from knowledge.retrieval_configurations c join knowledge.evaluation_runs r on r.id = c.approval_run_id
      where c.status = 'active'`;
    expect(history!.evaluated).toEqual(scope);
    const [acceptance] = await admin<{ scope: unknown }[]>`
      select a.scope from knowledge.evaluation_uncertainty_acceptances a
      join knowledge.evaluation_runs r on r.id = a.run_id
      where r.evaluated_scope @> ${JSON.stringify([{ productId: registerProductId }])}::text::jsonb
      order by a.accepted_at desc limit 1`;
    expect(acceptance!.scope).toEqual(scope);
    // Admin shows the out-of-scope product under its current name.
    const { data: context } = await adminClient.schema("knowledge").rpc("retrieval_context");
    expect((context as { configuration: { scopeGaps: string[] } }).configuration.scopeGaps).toContain(`${oldName} / terms`);
    expect((context as { configuration: { scopeGaps: string[] } }).configuration.scopeGaps).not.toContain(`${newName} / terms`);
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
    const alerts: Alert[] = [];
    const sink: AlertSink = { send: async (alert) => void alerts.push(alert) };
    const publishFiles = async (reportX: EvaluationReport, performance: PerformanceMeasurement | null, mode: "baseline" | "regression") => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ipa-eval-"));
      const written = writeVersionedReport(dir, reportX, performance);
      const files = Object.fromEntries(written.filter((file) => !file.endsWith(".sha256")).map((file) => [path.basename(file), fs.readFileSync(file, "utf8")]));
      return publishEvaluation(
        { report: reportX, gates: GATES_V1, performance, mode, files, checksums: fs.readFileSync(written.find((file) => file.endsWith(".sha256"))!, "utf8") },
        publisherSql as unknown as SqlClient,
        sink,
        () => {},
      );
    };

    // 8B-I7: a QUALITY regression is registered through the publication step: an alarm for
    // review, the configuration stays active, and the event names set, gate set and fingerprint.
    const quality = report("it-config-c", {
      configuration: material({ minScore: 0.25 }),
      observe: (cases) => cases.filter((c) => c.type === "direct").forEach((c) => Object.assign(c, { sourceRank: null, firstGrade3Rank: null, requiredCovered: 0 })),
    });
    const performance = buildPerformanceMeasurement({
      runId: quality.runId, configurationFingerprint: quality.configuration.runtimeFingerprint, environment: "evaluation",
      retrieval: { total: [700, 750, 1700], queryEmbedding: [120, 140, 400], search: [80, 90, 100], rerank: [200, 210, 220] },
      ingestion: { documents: [{ pages: 52, seconds: 200 }], corpusPages: 52, corpusSeconds: 200 },
    });
    expect(await publishFiles(quality, performance, "regression")).toMatchObject({ status: "published" });
    expect(alerts.map((alert) => alert.code)).toEqual(["quality_regression"]);
    expect(alerts[0]!.details).toMatchObject({ eval_set_checksum: quality.evalSet.checksum, gate_set_checksum: quality.gateSet.checksum, runtime_fingerprint: quality.configuration.runtimeFingerprint });
    expect((await admin<{ status: string }[]>`select status from knowledge.retrieval_configurations where id = ${configurations.c}`)[0]!.status).toBe("active");
    const [qualityEvent] = await admin<{ details: Record<string, unknown> }[]>`
      select a.details from audit.audit_log a join knowledge.evaluation_runs r on r.id::text = a.entity_id
      where a.action = 'knowledge.evaluation_run.regression' and r.run_id = ${quality.runId}`;
    expect(qualityEvent!.details).toMatchObject({
      result: "quality_regression",
      eval_set: { id: quality.evalSet.setId, version: quality.evalSet.version, checksum: quality.evalSet.checksum },
      gate_set: { checksum: quality.gateSet.checksum },
      runtime_fingerprint: quality.configuration.runtimeFingerprint,
    });
    // The performance measurement is registered with the run and the fingerprint; the deviations
    // (p95 total, query embedding; corpus not measured) need a documented approval.
    const [measurement] = await admin<{ id: string; deviations: string[]; configuration_fingerprint: string }[]>`
      select id, deviations, configuration_fingerprint from knowledge.performance_measurements where measurement_id = ${performance.measurementId}`;
    expect(measurement!.configuration_fingerprint).toBe(quality.configuration.runtimeFingerprint);
    expect(measurement!.deviations).toEqual(["retrieval_total_p95", "query_embedding_p95", "ingestion_corpus_2000_pages_seconds"]);
    expect(await rpc(adminClient, "accept_performance_deviation", { p_measurement_id: measurement!.id, p_justification: "Fiktiv godkendelse: målt i evalueringsmiljøet, gentages i drift." })).toBeNull();
    // The scheduled health check sees the same: a quality regression of the active configuration.
    const health = parseSystemHealth((await admin<{ h: unknown }[]>`select ops.system_health() as h`)[0]!.h);
    expect(evaluateHealth(health, INITIAL_HEALTH_STATE).alerts.map((alert) => alert.code)).toContain("quality_regression");
    expect((await admin<{ p: { accepted: boolean } }[]>`select ops.system_health() -> 'performance' as p`)[0]!.p.accepted).toBe(true);

    // A hard-gate regression: suspended in the same transaction (D-8), no fallback; critical alarm.
    alerts.length = 0;
    const hard = report("it-config-c", { configuration: material({ minScore: 0.25 }), violations: [{ gate: "H1", caseId: null, explanation: "Fiktivt brud i regression." }] });
    expect(await publishFiles(hard, null, "regression")).toMatchObject({ status: "published" });
    expect(alerts.map((alert) => alert.code)).toEqual(["hard_gate_regression"]);
    expect(alerts[0]!.details).toMatchObject({ failed_hard_gates: "H1", runtime_fingerprint: hard.configuration.runtimeFingerprint });
    // A run-level H1 breach is registered as a regression run and suspends.
    const [row] = await admin<{ status: string; suspension_reason: string }[]>`select status, suspension_reason from knowledge.retrieval_configurations where id = ${configurations.c}`;
    expect(row).toEqual({ status: "suspended", suspension_reason: "hard_gate_failed" });
    const suspendedHealth = parseSystemHealth((await admin<{ h: unknown }[]>`select ops.system_health() as h`)[0]!.h);
    const suspendedAlerts = evaluateHealth(suspendedHealth, INITIAL_HEALTH_STATE).alerts;
    expect(suspendedAlerts.find((alert) => alert.code === "configuration_suspended")?.details).toMatchObject({ reason: "hard_gate_failed", runtime_fingerprint: hard.configuration.runtimeFingerprint });

    // A tampered file is refused before anything is sent — and raises the alarm.
    alerts.length = 0;
    const tampered = report("it-config-c", { configuration: material({ minScore: 0.25 }) });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ipa-eval-"));
    const written = writeVersionedReport(dir, tampered, null);
    const outcome = await publishEvaluation(
      { report: tampered, gates: GATES_V1, performance: null, mode: "baseline", files: { [`${tampered.runId}.json`]: `${fs.readFileSync(written[0]!, "utf8")} ` }, checksums: fs.readFileSync(written.at(-1)!, "utf8") },
      publisherSql as unknown as SqlClient,
      sink,
      () => {},
    );
    expect(outcome.status).toBe("refused");
    expect(alerts.map((alert) => alert.code)).toEqual(["publication_refused"]);
    expect((await admin<{ n: number }[]>`select count(*)::int as n from knowledge.evaluation_runs where run_id = ${tampered.runId}`)[0]!.n).toBe(0);
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
