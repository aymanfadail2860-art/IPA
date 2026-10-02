import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runGateway, type GatewayDeps } from "@/lib/ai/core/gateway-core";
import { createModel } from "@/lib/ai/core/registry";
import type { StubModel } from "@/lib/ai/core/stub-model";
import type { AiRequest } from "@/lib/ai/core/types";
import { createGatewayDbDeps } from "@/lib/ai/gateway-deps";
import type { PermissionKey, PermissionScope } from "@/lib/auth/permissions";
import type { EmbeddingModelSpec } from "@/lib/knowledge/core/embedding";
import { createEmbedder, createReranker } from "@/lib/knowledge/core/registry";
import { runRetrieval } from "@/lib/knowledge/retrieval-core";

import { buildPdf } from "../fixtures/knowledge-pdfs";

import { env, integrationConfigured, signedInClient, userIdOf, type SeedUserKey } from "./helpers";
import { RUN, runProduct, runWorkerOnce, uploadVersion, workerConfigured } from "./knowledge-helpers";

/**
 * Fase 8 — AI Gateway mod den rigtige lokale Supabase: rigtige brugersessioner, rigtig
 * retrieval, matricen, gating-tilstanden og den opdelte log i databasen (docs/08 §14).
 *
 * runAiRequest (server-only) kører runGateway med den indloggede brugers klient og
 * stub-modellen fra registret; testen gør præcis det samme for hver seed-bruger og beholder
 * stubben, så den kan se, hvad der ville have forladt platformen.
 */

let activeModel: EmbeddingModelSpec;
const marker = `ravfugl${RUN}`;
const company = `Integrationstest Tømrer ${RUN} ApS`;

async function gatewayAs(key: SeedUserKey): Promise<{ deps: GatewayDeps; stub: StubModel; client: SupabaseClient }> {
  const client = await signedInClient(key);
  const stub = createModel("stub", "test") as StubModel;
  const { data: me } = await client.schema("identity").rpc("current_user_id");
  const { data: user } = await client.schema("identity").from("users").select("id, display_name").eq("id", me).single();
  const { data: permissions } = await client.schema("identity").rpc("my_permissions");
  const grants = (permissions ?? []) as { permission: string; scope: string }[];
  return {
    client,
    stub,
    deps: {
      ...createGatewayDbDeps(client),
      user: async () => (user ? { id: user.id as string, name: user.display_name as string } : null),
      hasPermission: async (permission: PermissionKey, scope?: PermissionScope) => grants.some((g) => g.permission === permission && (!scope || g.scope === scope)),
      retrieve: (request, dev) =>
        runRetrieval(request, {
          db: client.schema("knowledge"),
          embedding: { embedder: createEmbedder(activeModel, "test"), modelId: activeModel.id },
          reranker: createReranker("none", "test"),
          devForceInsufficient: dev.devForceInsufficient,
        }),
      model: () => stub,
      environment: "test",
    },
  };
}

const copilot = (input: string, context: AiRequest["context"] = {}): AiRequest => ({ profile: "copilot", action: "answer_question", input, context });

async function lastCall(client: SupabaseClient) {
  const { data, error } = await client.schema("ai").from("gateway_calls").select("*").order("created_at", { ascending: false }).limit(1).single();
  if (error) throw error;
  return data as Record<string, unknown>;
}

describe.skipIf(!integrationConfigured || !workerConfigured)("AI Gateway end to end", () => {
  let documentId: string;
  let caseId: string;

  beforeAll(async () => {
    const admin = await signedInClient("admin");
    const { data: models, error } = await admin.schema("knowledge").rpc("active_embedding_model");
    if (error) throw error;
    activeModel = (models as EmbeddingModelSpec[])[0]!;
    const productId = await runProduct(admin, "Gateway");
    const version = await uploadVersion(
      admin,
      await buildPdf([
        {
          lines: [
            { text: `Gatewaybetingelser ${RUN}`, size: 16, bold: true },
            { text: "§ 2 Dækning", size: 13, bold: true, spaceBefore: 10 },
            { text: `Forsikringen dækker skade forårsaget af droner. Fiktiv markør ${marker}.`, spaceBefore: 4 },
          ],
        },
      ]),
      { title: `Gatewaybetingelser ${RUN}`, productId, documentType: "terms", validFrom: "2020-01-01" },
    );
    documentId = version.documentId;
    await runWorkerOnce();
    const knowledge = admin.schema("knowledge");
    const review = await knowledge.rpc("start_review", { p_version_id: version.versionId });
    if (review.error) throw review.error;
    const approval = await knowledge.rpc("approve_version", { p_version_id: version.versionId, p_acknowledged_warnings: ["no_grants"] });
    if (approval.error) throw approval.error;
    const granted = await knowledge
      .from("document_access_grants")
      .insert({ document_id: documentId, permission_key: "knowledge.document.read", grantee_type: "user", user_id: await userIdOf("advisorA") });
    if (granted.error) throw granted.error;

    const advisorA = await signedInClient("advisorA");
    const created = await advisorA.schema("advise").from("customer_cases").insert({ company_name: company, owner_id: await userIdOf("advisorA") }).select("id").single();
    if (created.error) throw created.error;
    caseId = created.data.id as string;
  }, 300_000);

  // The case would otherwise change other tests' view of advisorA's cases. There is no delete
  // policy on cases (docs/06), so the test removes it with the service role — test rig only.
  afterAll(async () => {
    if (!caseId) return;
    const service = createClient(env.url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", { auth: { persistSession: false } });
    await service.schema("advise").from("customer_cases").delete().eq("id", caseId);
  });

  it("answers an advisor with a grant — through retrieval, the stub and the log — without identifiers leaving the platform", async () => {
    const { deps, stub, client } = await gatewayAs("advisorA");
    const outcome = await runGateway(copilot(`Dækker vi droner? ${marker} Kundens cpr er 010180-1234.`), deps);
    expect(outcome.kind).toBe("answer");
    if (outcome.kind !== "answer") return;
    expect(outcome.evidence.some((item) => item.documentId === documentId)).toBe(true);
    expect(outcome.grade).toBe("development");
    expect(JSON.stringify(stub.received)).not.toContain("010180-1234");

    const call = await lastCall(client);
    expect(call).toMatchObject({ outcome: "answer", model_id: "stub", model_grade: "development", case_bound: false });
    const { data: payload } = await client.schema("ai").from("gateway_payloads").select("sent, returned").eq("call_id", call.id).single();
    expect(JSON.stringify(payload)).toContain("[CPR-1]");
    expect(JSON.stringify(payload)).not.toContain("010180-1234");
    const { data: sources } = await client.schema("ai").from("gateway_call_sources").select("evidence_id, sent, cited").eq("call_id", call.id);
    expect((sources ?? []).some((source) => source.cited)).toBe(true);
  });

  it("an advisor without a grant to the document gets 'insufficient' — the model is not called — and a knowledge gap with the redacted text", async () => {
    const { deps, stub, client } = await gatewayAs("advisorB");
    // Scoped to the test document: other tests grant advisorB other documents, and the test
    // embedder always finds nearest neighbours (docs/07 §20.4).
    const scoped: GatewayDeps = { ...deps, retrieve: (request, dev) => deps.retrieve({ ...request, documentIds: [documentId] }, dev) };
    const outcome = await runGateway(copilot(`Dækker vi droner? ${marker} CVR 12345678`), scoped);
    expect(outcome.kind).toBe("insufficient");
    expect(stub.received).toHaveLength(0);
    const call = await lastCall(client);
    const { data: gap } = await client.schema("ai").from("knowledge_gaps").select("question, case_bound").eq("call_id", call.id).single();
    expect(gap).toEqual({ question: `Dækker vi droner? ${marker} CVR [CVR-1]`, case_bound: false });
  });

  it("content and metadata are private: other users and administrators cannot read them directly; admin reading is switched off", async () => {
    const a = await signedInClient("advisorA");
    const callId = (await lastCall(a)).id;
    for (const key of ["advisorB", "admin"] as const) {
      const other = (await signedInClient(key)).schema("ai");
      expect((await other.from("gateway_calls").select("id").eq("id", callId)).data, key).toEqual([]);
      expect((await other.from("gateway_payloads").select("call_id").eq("call_id", callId)).data, key).toEqual([]);
    }
    const { error } = await (await signedInClient("admin")).schema("ai").rpc("admin_call_metadata", {});
    expect(error?.message).toBe("Administratorers læsning af AI-loggen er slået fra.");
  });

  it("a case-bound call: the company name never leaves the platform, its gap has no text, and a non-participant cannot read it", async () => {
    const { deps, stub, client } = await gatewayAs("advisorA");
    const answered = await runGateway(copilot(`Dækker ${company} droner? ${marker}`, { caseId }), deps);
    expect(answered.kind).toBe("answer");
    expect(JSON.stringify(stub.received)).not.toContain(company);
    expect(JSON.stringify(stub.received)).toContain("[VIRKSOMHED-1]");
    expect(await lastCall(client)).toMatchObject({ case_bound: true, case_id: caseId });

    const gapOutcome = await runGateway(copilot(`Hvad gælder for ${company} ved oversvømmelse ${RUN}xyz?`, { caseId }), { ...deps, retrieve: async (request, dev) => (await deps.retrieve({ ...request, documentIds: ["00000000-0000-4000-8000-000000000000"] }, dev)) });
    expect(gapOutcome.kind).toBe("insufficient");
    const gapCall = await lastCall(client);
    const { data: gap } = await client.schema("ai").from("knowledge_gaps").select("question, case_bound").eq("call_id", gapCall.id).single();
    expect(gap).toEqual({ question: null, case_bound: true });

    const b = await gatewayAs("advisorB");
    expect(await runGateway(copilot("Hvad med droner?", { caseId }), b.deps)).toMatchObject({ kind: "denied", message: "Sagen findes ikke." });
    expect(b.stub.received).toHaveLength(0);
  });

  it("gating: an active Assessment locks Copilot for the user — read from the database — and lifts at once after submission", async () => {
    const { deps, stub, client } = await gatewayAs("advisorA");
    const started = await client.schema("assessment").rpc("start_attempt", {});
    expect(started.error).toBeNull();
    try {
      expect(await runGateway(copilot(`Dækker vi droner? ${marker}`), deps)).toEqual({ kind: "locked", reason: "assessment_active" });
      expect(await runGateway({ profile: "learn", action: "explain", input: "Forklar droner" }, deps)).toEqual({ kind: "locked", reason: "assessment_active" });
      expect(stub.received).toHaveLength(0);
      expect(await lastCall(client)).toMatchObject({ outcome: "locked", reason_code: "assessment_active" });
      // Another user is not affected.
      const other = await gatewayAs("advisorB");
      expect((await runGateway(copilot("Hvad med droner?"), other.deps)).kind).not.toBe("locked");
    } finally {
      await client.schema("assessment").rpc("submit_attempt", { p_id: started.data });
    }
    expect((await runGateway(copilot(`Dækker vi droner? ${marker}`), deps)).kind).toBe("answer");
  });

  it("gating: an active roleplay locks all AI except the roleplay itself", async () => {
    const { deps, client } = await gatewayAs("advisorA");
    const started = await client.schema("practice").rpc("start_roleplay");
    expect(started.error).toBeNull();
    try {
      expect(await runGateway(copilot(`Dækker vi droner? ${marker}`), deps)).toEqual({ kind: "locked", reason: "roleplay_active" });
      const turn = await runGateway({ profile: "practice", action: "roleplay_turn", input: "Goddag, jeg ringer om jeres forsikring.", context: { roleplaySessionId: started.data as string } }, deps);
      expect(turn.kind).toBe("answer");
    } finally {
      await client.schema("practice").rpc("end_roleplay", { p_id: started.data });
    }
    expect((await runGateway(copilot(`Dækker vi droner? ${marker}`), deps)).kind).toBe("answer");
  });

  it("the matrix in the database decides: denying knowledge blocks the call, and only system.settings.manage can change it", async () => {
    const advisor = await signedInClient("advisorA");
    const refused = await advisor.schema("ai").rpc("set_data_category_rule", { p_model_id: "stub", p_category: "knowledge", p_rule: "allow" });
    expect(refused.error?.code).toBe("42501");

    const admin = (await signedInClient("admin")).schema("ai");
    expect((await admin.rpc("set_data_category_rule", { p_model_id: "stub", p_category: "knowledge", p_rule: "deny" })).error).toBeNull();
    try {
      const { deps, stub } = await gatewayAs("advisorA");
      expect(await runGateway(copilot(`Dækker vi droner? ${marker}`), deps)).toMatchObject({ kind: "blocked_policy", category: "knowledge" });
      expect(stub.received).toHaveLength(0);
    } finally {
      expect((await admin.rpc("set_data_category_rule", { p_model_id: "stub", p_category: "knowledge", p_rule: "allow" })).error).toBeNull();
    }
  });
});
