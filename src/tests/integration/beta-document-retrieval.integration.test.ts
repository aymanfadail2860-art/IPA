import { randomBytes, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createEvaluationPublisher, sqlPublisherConnection } from "../../../evals/engine/publication.ts";
import type { EvaluationReport } from "../../../evals/engine/runner.ts";
import { userText } from "@/lib/egress/classification";
import { EvidenceGradeError, requireProductionEvidence } from "@/lib/knowledge/core/evidence";
import { runProductDocumentRetrieval, type RetrievalRequest } from "@/lib/knowledge/retrieval-core";

import { buildReport, GATES_V1 } from "../fixtures/evaluation-report";
import { buildPdf } from "../fixtures/knowledge-pdfs";
import { fixtureDocumentMaterial, type FixtureScopeEntry } from "../fixtures/production-config";

import { integrationConfigured, signedInClient, userIdOf } from "./helpers";
import { RUN, runProduct, runWorkerOnce, uploadVersion, workerConfigured, type UploadedVersion } from "./knowledge-helpers";

/**
 * B-035 (beta, L1) — product_documents against the real local database:
 *
 *   * the real SQL function (knowledge.product_document_chunks), RLS and the access filter: an
 *     advisor sees only the documents granted to him, in full, for the one chosen product;
 *   * the real registration path: the publisher registers a report for a product_documents
 *     configuration (no embedding model), a human approves and activates — the embedding models
 *     are not touched;
 *   * production evidence only then, only inside the evaluated area, and never once the
 *     configuration is suspended; before registration and approval it is development.
 *
 * The report is the real engine's fixture report with product_documents material: it tests the
 * register's mechanics, not the method's quality (docs/beta.md §5.1). Local only.
 */

const adminUrl = process.env.IPA_TEST_DB_ADMIN_URL ?? "";
const configured = integrationConfigured && workerConfigured && Boolean(adminUrl) && /@(127\.0\.0\.1|localhost):/.test(adminUrl);
const marker = `dokumentlama${RUN}`;

describe.skipIf(!configured)("product_documents against the local database (B-035, L1)", () => {
  let admin: Sql;
  let publisherSql: Sql;
  let adminClient: SupabaseClient;
  let advisorClient: SupabaseClient;
  let otherAdvisorClient: SupabaseClient;
  let productId: string;
  let outsideProductId: string;
  let terms: UploadedVersion;
  let guidance: UploadedVersion;
  let outside: UploadedVersion;
  let scope: FixtureScopeEntry[];
  let configurationId: string;
  let report: EvaluationReport;
  let modelsBefore: { id: string; status: string }[];
  // A budget of its own per run: the register never forgets a configuration, so each run evaluates a new one.
  const material = fixtureDocumentMaterial({ params: { maxChars: 300_000 + (parseInt(RUN.slice(0, 6), 16) % 100_000) } });

  const knowledge = (client: SupabaseClient) => client.schema("knowledge");
  const rpc = async (client: SupabaseClient, fn: string, args: Record<string, unknown>) => (await knowledge(client).rpc(fn, args)).error;
  const retrieve = (client: SupabaseClient, request: Partial<RetrievalRequest> = {}) =>
    runProductDocumentRetrieval(
      { query: userText(`Er ${marker} dækket?`, { caseBound: false, redacted: true }), productIds: [productId], ...request },
      { db: knowledge(client), params: { ...material.params } },
    );
  async function grant(documentId: string, userId: string) {
    const { error } = await knowledge(adminClient).from("document_access_grants").insert({ document_id: documentId, permission_key: "knowledge.document.read", grantee_type: "user", user_id: userId });
    if (error) throw error;
  }
  async function takeOutOfService() {
    for (const row of await admin<{ id: string; status: string }[]>`select id, status from knowledge.retrieval_configurations where status in ('active', 'suspended', 'approved')`) {
      if (row.status === "active") await rpc(adminClient, "suspend_retrieval_configuration", { p_configuration_id: row.id, p_reason: "integrationstest: oprydning" });
      await rpc(adminClient, "retire_retrieval_configuration", { p_configuration_id: row.id, p_reason: "integrationstest: oprydning" });
    }
  }
  const pdf = (title: string, text: string) =>
    buildPdf([{ lines: [{ text: title, size: 16, bold: true }, { text: "§ 1 Dækning", size: 13, bold: true, spaceBefore: 10 }, { text, spaceBefore: 4 }] }]);

  beforeAll(async () => {
    admin = postgres(adminUrl, { max: 2, onnotice: () => {} });
    adminClient = await signedInClient("admin");
    advisorClient = await signedInClient("advisorA");
    otherAdvisorClient = await signedInClient("advisorB");

    const password = randomBytes(24).toString("hex");
    await admin`select ops.evaluation_publisher_prepare()`;
    await admin.unsafe(`alter role evaluation_publisher_login password '${password}'`);
    const target = new URL(adminUrl);
    publisherSql = postgres({ host: target.hostname, port: Number(target.port), database: target.pathname.slice(1), username: "evaluation_publisher_login", password, max: 1, prepare: false, onnotice: () => {} });

    // Our product: terms and guidance, both published through the normal path (quarantine, scan,
    // worker, review, approval). Another product's terms, outside the evaluated area.
    productId = await runProduct(adminClient, "Dokumentmetode");
    outsideProductId = await runProduct(adminClient, "Dokumentmetode udenfor");
    terms = await uploadVersion(adminClient, await pdf(`Dokumentbetingelser ${RUN}`, `Forsikringen dækker fiktiv skade ${marker}.`), {
      title: `Dokumentbetingelser ${RUN}`, productId, documentType: "terms", validFrom: "2020-01-01",
    });
    guidance = await uploadVersion(adminClient, await pdf(`Dokumentvejledning ${RUN}`, `Vejledning om fiktiv rådgivning ${marker} i praksis.`), {
      title: `Dokumentvejledning ${RUN}`, productId, documentType: "guidance", validFrom: "2020-01-01",
    });
    outside = await uploadVersion(adminClient, await pdf(`Udenfor betingelser ${RUN}`, `Den anden produktfamilie omfatter fiktiv hændelse ${marker}.`), {
      title: `Udenfor betingelser ${RUN}`, productId: outsideProductId, documentType: "terms", validFrom: "2020-01-01",
    });
    await runWorkerOnce();
    for (const version of [terms, guidance, outside]) {
      let error = await rpc(adminClient, "start_review", { p_version_id: version.versionId });
      if (error) throw error;
      error = await rpc(adminClient, "approve_version", { p_version_id: version.versionId, p_acknowledged_warnings: ["predecessor_superseded", "no_grants"] });
      if (error) throw error;
    }
    // advisorA may read our terms and the other product's terms — not our guidance. advisorB nothing.
    const advisorA = await userIdOf("advisorA");
    await grant(terms.documentId, advisorA);
    await grant(outside.documentId, advisorA);

    await takeOutOfService();
    modelsBefore = await admin<{ id: string; status: string }[]>`select id, status from knowledge.embedding_models order by id`;
    scope = [{ documentType: "terms", productId, productName: `Testprodukt Dokumentmetode ${RUN} (fiktiv)` }];
    const gateSetId = await sqlPublisherConnection(publisherSql).registerGateSet(GATES_V1);
    const [gate] = await admin<{ approved_at: Date | null }[]>`select approved_at from knowledge.evaluation_gate_sets where id = ${gateSetId}`;
    if (!gate!.approved_at) {
      const error = await rpc(adminClient, "approve_evaluation_gate_set", { p_gate_set_id: gateSetId });
      if (error) throw error;
    }
  }, 300_000);

  afterAll(async () => {
    if (!admin) return;
    await takeOutOfService();
    await admin`select ops.evaluation_publisher_deactivate('retired')`;
    await publisherSql?.end();
    await admin.end();
  });

  it("the advisor gets exactly the granted documents of the chosen product, in full — the others nothing", async () => {
    const set = await retrieve(advisorClient);
    expect(set.retrieval.method).toBe("product_documents");
    expect(new Set(set.items.map((item) => item.documentVersionId))).toEqual(new Set([terms.versionId]));
    expect(set.items.map((item) => item.excerpt.text).join(" ")).toContain(marker);
    expect(set.items.every((item) => item.product.id === productId)).toBe(true);
    // Guidance is published but not granted; the other product is granted but not chosen.
    expect((await retrieve(otherAdvisorClient)).items).toEqual([]);
    expect(new Set((await retrieve(adminClient)).items.map((item) => item.documentVersionId))).toEqual(new Set([terms.versionId, guidance.versionId]));
    expect(new Set((await retrieve(adminClient, { documentTypes: ["terms"] })).items.map((item) => item.documentVersionId))).toEqual(new Set([terms.versionId]));
  });

  it("before registration and approval, nothing is production (no configuration in service)", async () => {
    const set = await retrieve(advisorClient);
    expect(set.retrieval.grade).toBe("development");
    expect(() => requireProductionEvidence(set)).toThrow(EvidenceGradeError);
  });

  it("the publisher registers a product_documents configuration; the database stores no embedding model", async () => {
    report = buildReport({ runId: randomUUID(), label: "it-product-documents", scope, configuration: material, runtime: material });
    await createEvaluationPublisher(sqlPublisherConnection(publisherSql)).publish(report, GATES_V1);
    const [row] = await admin<{ id: string; status: string; embedding_model_id: string | null; reranker_id: string | null }[]>`
      select id, status, embedding_model_id, reranker_id from knowledge.retrieval_configurations where fingerprint = ${report.configuration.declaredFingerprint}`;
    expect(row).toMatchObject({ status: "candidate", embedding_model_id: null, reranker_id: null });
    configurationId = row!.id;
    // Registered is not approved: still development.
    expect((await retrieve(advisorClient)).retrieval.grade).toBe("development");
  });

  it("an advisor cannot approve or activate; an administrator with system.settings.manage can — no model changes", async () => {
    const [run] = await admin<{ id: string }[]>`select id from knowledge.evaluation_runs where configuration_id = ${configurationId} order by registered_at desc limit 1`;
    expect(await rpc(advisorClient, "approve_retrieval_configuration", { p_configuration_id: configurationId, p_run_id: run!.id, p_root_cause_notes: [] })).not.toBeNull();
    expect(await rpc(adminClient, "approve_retrieval_configuration", { p_configuration_id: configurationId, p_run_id: run!.id, p_root_cause_notes: [] })).toBeNull();
    expect(await rpc(advisorClient, "activate_retrieval_configuration", { p_configuration_id: configurationId })).not.toBeNull();
    expect(await rpc(adminClient, "activate_retrieval_configuration", { p_configuration_id: configurationId })).toBeNull();
    expect(await admin<{ id: string; status: string }[]>`select id, status from knowledge.embedding_models order by id`).toEqual(modelsBefore);
  });

  it("then production evidence — only inside the evaluated area, and only as the signed-in user", async () => {
    const set = await retrieve(advisorClient);
    expect(set.retrieval.grade).toBe("production");
    expect(set.retrieval.unmet).toEqual([]);
    expect(requireProductionEvidence(set)).toBe(set);
    // Guidance was not evaluated (the area is our product's terms): the whole set is development (P3).
    const withGuidance = await retrieve(adminClient);
    expect(withGuidance.retrieval.unmet).toContain("P3");
    // Another product, granted but not evaluated: development (P3).
    const other = await retrieve(advisorClient, { productIds: [outsideProductId] });
    expect(other.items.length).toBeGreaterThan(0);
    expect(other.retrieval.unmet).toContain("P3");
  });

  it("a budget other than the approved one is not the configuration (P4)", async () => {
    const set = await runProductDocumentRetrieval(
      { query: userText("x", { caseBound: false, redacted: true }), productIds: [productId] },
      { db: knowledge(advisorClient), params: { maxChars: material.params.maxChars + 1 } },
    );
    expect(set.retrieval.unmet).toContain("P4");
  });

  it("a hard-gate breach in regression suspends the configuration at once: no production evidence", async () => {
    const breach = buildReport({
      runId: randomUUID(), label: "it-product-documents", scope, configuration: material, runtime: material,
      violations: [{ gate: "H1", caseId: null, explanation: "integrationstest: fiktivt brud" }],
    });
    await createEvaluationPublisher(sqlPublisherConnection(publisherSql)).publish(breach, GATES_V1);
    const [row] = await admin<{ status: string }[]>`select status from knowledge.retrieval_configurations where id = ${configurationId}`;
    expect(row!.status).toBe("suspended");
    const set = await retrieve(advisorClient);
    expect(set.retrieval.grade).toBe("development");
    expect(set.retrieval.unmet).toContain("P3");
  });
});
