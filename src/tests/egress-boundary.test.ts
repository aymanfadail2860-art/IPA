import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CASE_DATA_BLOCKED_MESSAGE, runGateway, type CallRecord, type GatewayDeps } from "@/lib/ai/core/gateway-core";
import { invokeModel } from "@/lib/ai/core/invoke";
import type { Model } from "@/lib/ai/core/model";
import type { PolicyRow } from "@/lib/ai/core/policy";
import { createModel } from "@/lib/ai/core/registry";
import type { ModelInput, SentPart } from "@/lib/ai/core/types";
import {
  customerCaseText,
  isClassified,
  knowledgeText,
  missingProvenance,
  narrowed,
  unknownText,
  userText,
  type ClassifiedText,
} from "@/lib/egress/classification";
import {
  assertTransmittable,
  authorizeEgress,
  EGRESS_ALLOWED,
  EgressPolicyError,
  NEVER_EXTERNAL,
  type EgressDenialLogEntry,
  type EgressOperation,
  type EgressRole,
} from "@/lib/egress/policy";
import { syntheticText } from "@/lib/egress/synthetic";
import { requireProductionEvidence } from "@/lib/knowledge/core/evidence";
import { runRetrieval, type KnowledgeRpcClient, type SearchRow } from "@/lib/knowledge/retrieval-core";
import { createCohereEmbedV4, EMBED_V4_EU_1024_DESCRIPTOR } from "@/lib/knowledge/providers/bedrock/cohere-embed-v4";
import { COHERE_RERANK_35_ID } from "@/lib/knowledge/providers/bedrock/cohere-rerank-3-5";
import { createProductionEmbedder, createProductionReranker, embeddingModelRow, type ProviderRuntime } from "@/lib/knowledge/providers/catalog";

import { evidenceItem, issueEvidence } from "./fixtures/ai-evidence";
import { embedResponse, fakeBedrock, noSleep, type FakeCall } from "./fixtures/bedrock-fake";

/**
 * 8B-I2.5 — the external-AI data boundary. Customer-identifiable data may not leave the
 * platform's approved trust boundary to an external AI provider — for model generation, query
 * embedding, document embedding and reranking alike. Every test that denies also proves that
 * ZERO external calls were made. Everything is fictional; no AWS account, no network.
 */

const CASE_TEXT = "Kunden Fiktiv Tømrer ApS vil vide, om deres lift er dækket";
const PUBLIC_QUESTION = "Dækker erhvervsansvar skade på ting under reparation?";
const publicQuery = () => userText(PUBLIC_QUESTION, { caseBound: false, redacted: true });
const caseQuery = (redacted = true) => userText(CASE_TEXT, { caseBound: true, redacted });

function bedrockHandler(call: FakeCall): unknown {
  if (Array.isArray(call.body.texts)) return embedResponse(call.body.texts as string[]);
  return { results: (call.body.documents as string[]).map((_, index) => ({ index, relevance_score: 1 / (index + 1) })) };
}

function bedrock() {
  const fake = fakeBedrock(bedrockHandler);
  const denials: EgressDenialLogEntry[] = [];
  const runtime: ProviderRuntime = { bedrock: fake.transport, retryDeps: noSleep, egressLog: (entry) => denials.push(entry) };
  return {
    calls: fake.calls,
    denials,
    embedder: createProductionEmbedder(embeddingModelRow(EMBED_V4_EU_1024_DESCRIPTOR), runtime),
    reranker: createProductionReranker(COHERE_RERANK_35_ID, runtime),
  };
}

const ROW: SearchRow = {
  chunk_id: "chunk-1", chunk_index: 0, kind: "prose", text: "Forsikringen dækker ikke skade på ting under reparation.", lead_in: null, heading: "§ 2",
  heading_path: ["§ 2 Behandlingsskade"], section_number: "2", page_start: 1, page_end: 1, char_start: 0, char_end: 56, overlap_chars: 0,
  version_id: "v", version_label: "1", language: "da", valid_from: "2025-01-01", valid_to: null, approved_at: null, superseded_by: null,
  document_id: "d", document_title: "Testbetingelser (fiktiv)", document_type: "terms", product_id: "p", product_name: "Testprodukt (fiktiv)",
  source_type: "manual_upload", temporal_status: "current", vector_rank: 1, vector_score: 0.9, lexical_rank: 1, lexical_score: 1, lexical_terms: ["reparation"], chunker_version: "structure/1",
};
const db: KnowledgeRpcClient = { rpc: async (fn) => ({ data: fn === "search_chunks" ? [ROW] : [], error: null }) };

async function denialOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "allowed";
  } catch (error) {
    if (error instanceof EgressPolicyError) return error.reason;
    // A ProviderError wrapping an egress denial would be a bug: the boundary must not be retried.
    return `other:${(error as Error).name}:${(error as Error).message}`;
  }
}

const silent = { log: () => {} };

// ---------------------------------------------------------------------------------------------

describe("classification and provenance", () => {
  it("case-bound user text is customer_identifiable — redacted or not", () => {
    for (const redacted of [true, false]) {
      expect(caseQuery(redacted).provenance).toEqual({ category: "customer_identifiable", source: "user_input", caseBound: true, redacted });
    }
    expect(publicQuery().provenance).toEqual({ category: "user_question", source: "user_input", caseBound: false, redacted: true });
    expect(customerCaseText("x").provenance).toMatchObject({ category: "customer_identifiable", caseBound: true });
  });

  it("only constructed values are classified: copies and hand-built objects are not", () => {
    const real = knowledgeText("x");
    expect(isClassified(real)).toBe(true);
    expect(Object.isFrozen(real) && Object.isFrozen(real.provenance)).toBe(true);
    expect(isClassified({ ...real })).toBe(false);
    expect(isClassified(structuredClone(real))).toBe(false);
    expect(isClassified({ text: "x", provenance: { category: "knowledge", source: "knowledge_engine", caseBound: false, redacted: false } })).toBe(false);
    expect(isClassified("x")).toBe(false);
  });

  it("provenance can only be narrowed to a part of the original text — never laundered onto other text", () => {
    const query = publicQuery();
    expect(narrowed(query, "erhvervsansvar").provenance).toEqual(query.provenance);
    expect(() => narrowed(knowledgeText("godkendt viden"), CASE_TEXT)).toThrow(/del af den oprindelige tekst/);
    expect(narrowed({ text: CASE_TEXT, provenance: knowledgeText("x").provenance } as ClassifiedText, "Kunden").provenance.source).toBe("missing");
  });
});

describe("the central egress policy", () => {
  const request = (operation: EgressOperation, parts: { role: EgressRole; content: unknown }[]) =>
    ({ provider: "aws-bedrock", operation, module: "test", parts }) as Parameters<typeof authorizeEgress>[0];

  it.each([
    ["customer-case text", () => customerCaseText(CASE_TEXT), "case_bound"],
    ["case-bound user text (even redacted)", () => caseQuery(true), "case_bound"],
    ["case-bound user text (not redacted)", () => caseQuery(false), "case_bound"],
    ["unknown provenance", () => unknownText(PUBLIC_QUESTION), "never_external"],
    ["missing provenance (a plain string)", () => PUBLIC_QUESTION, "missing_provenance"],
    ["missing provenance (marked by the retrieval layer)", () => missingProvenance(PUBLIC_QUESTION), "missing_provenance"],
    ["missing provenance (nothing)", () => undefined, "missing_provenance"],
    ["a hand-built classification", () => ({ text: PUBLIC_QUESTION, provenance: { category: "user_question", source: "user_input", caseBound: false, redacted: true } }), "unclassified"],
    ["unredacted user text", () => userText(PUBLIC_QUESTION, { caseBound: false, redacted: false }), "not_redacted"],
    ["an empty text", () => knowledgeText(""), "invalid_text"],
  ])("denies %s for every operation", (_label, content, reason) => {
    for (const operation of ["embed_query", "rerank"] as const) {
      expect(() => authorizeEgress(request(operation, [{ role: "query", content: content() }]), silent)).toThrow(EgressPolicyError);
      try {
        authorizeEgress(request(operation, [{ role: "query", content: content() }]), silent);
      } catch (error) {
        expect((error as EgressPolicyError).reason).toBe(reason);
      }
    }
  });

  it("never lets customer_identifiable, audit_access or unknown out — the list is fixed in code", () => {
    expect([...NEVER_EXTERNAL]).toEqual(["customer_identifiable", "audit_access", "unknown"]);
    expect(Object.isFrozen(NEVER_EXTERNAL)).toBe(true);
    for (const operation of Object.keys(EGRESS_ALLOWED) as EgressOperation[]) {
      for (const categories of Object.values(EGRESS_ALLOWED[operation])) {
        for (const category of NEVER_EXTERNAL) expect(categories).not.toContain(category);
      }
    }
    expect(Object.isFrozen(EGRESS_ALLOWED) && Object.isFrozen(EGRESS_ALLOWED.rerank)).toBe(true);
  });

  it("allows only what each operation and role may send", () => {
    const allowed = (operation: EgressOperation, role: EgressRole, content: ClassifiedText) => {
      try {
        authorizeEgress(request(operation, [{ role, content }]), silent);
        return true;
      } catch {
        return false;
      }
    };
    expect(allowed("embed_query", "query", publicQuery())).toBe(true);
    expect(allowed("embed_document", "document", knowledgeText("§ 1"))).toBe(true);
    expect(allowed("rerank", "document", knowledgeText("§ 1"))).toBe(true);
    expect(allowed("generate", "evidence", knowledgeText("§ 1"))).toBe(true);
    expect(allowed("embed_query", "query", syntheticText("syntetisk spørgsmål"))).toBe(true);
    // A user's question is not a document; knowledge is not a query; synthetic is not for generation.
    expect(allowed("embed_document", "document", publicQuery())).toBe(false);
    expect(allowed("embed_query", "query", knowledgeText("§ 1"))).toBe(false);
    expect(allowed("generate", "question", syntheticText("x-tekst"))).toBe(false);
    expect(allowed("generate", "question", knowledgeText("x-tekst"))).toBe(false);
  });

  it("denies the WHOLE request when one part may not leave (no partial transmission)", () => {
    const parts = [
      { role: "query" as const, content: publicQuery() },
      { role: "document" as const, content: knowledgeText("§ 1 godkendt") },
      { role: "document" as const, content: customerCaseText("Kundens egne vilkår") },
    ];
    const error = (() => {
      try {
        authorizeEgress(request("rerank", parts), silent);
      } catch (caught) {
        return caught as EgressPolicyError;
      }
    })();
    expect(error).toMatchObject({ reason: "case_bound", partIndex: 2, category: "customer_identifiable" });
  });

  it("logs a denial as technical metadata only — never the text, PII or the raw query", () => {
    const log: EgressDenialLogEntry[] = [];
    expect(() => authorizeEgress({ provider: "aws-bedrock", operation: "embed_query", module: "knowledge.retrieval", correlationId: "corr-1", parts: [{ role: "query", content: caseQuery() }] }, { log: (entry) => log.push(entry) })).toThrow();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ event: "external_ai_egress_denied", correlationId: "corr-1", module: "knowledge.retrieval", provider: "aws-bedrock", operation: "embed_query", reason: "case_bound", category: "customer_identifiable", role: "query", partIndex: 0 });
    const serialized = JSON.stringify(log);
    for (const fragment of ["Fiktiv Tømrer", "Kunden", "lift"]) expect(serialized).not.toContain(fragment);
    expect(Object.keys(log[0]!).sort()).toEqual(["at", "category", "correlationId", "event", "module", "operation", "partIndex", "provider", "reason", "role"]);
  });

  it("the default log writes the same metadata to the server log, without the text", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => authorizeEgress({ provider: "p", operation: "embed_query", module: "m", parts: [{ role: "query", content: caseQuery() }] })).toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/external_ai_egress_denied/);
    expect(String(warn.mock.calls[0]![0])).not.toContain("Tømrer");
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------------------------

describe("query and document embedding: zero external calls on deny", () => {
  it("a customer-identifiable query is never embedded", async () => {
    const { embedder, calls, denials } = bedrock();
    expect(await denialOf(embedder.embed([caseQuery()], { inputType: "query" }))).toBe("case_bound");
    expect(calls).toHaveLength(0);
    expect(denials[0]).toMatchObject({ module: "bedrock.embed-v4", operation: "embed_query" });
  });

  it("unknown and missing provenance are never embedded", async () => {
    const { embedder, calls } = bedrock();
    expect(await denialOf(embedder.embed([unknownText(PUBLIC_QUESTION)], { inputType: "query" }))).toBe("never_external");
    expect(await denialOf(embedder.embed([PUBLIC_QUESTION] as never, { inputType: "query" }))).toBe("missing_provenance");
    expect(calls).toHaveLength(0);
  });

  it("an allowed public query is embedded", async () => {
    const { embedder, calls } = bedrock();
    await embedder.embed([publicQuery()], { inputType: "query" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.texts).toEqual([PUBLIC_QUESTION]);
  });

  it("customer documents never get the rights of Knowledge Engine documents", async () => {
    const { embedder, calls } = bedrock();
    expect(await denialOf(embedder.embed([knowledgeText("§ 1 godkendt viden"), customerCaseText("Kundens police nr. 123")], { inputType: "document" }))).toBe("case_bound");
    expect(await denialOf(embedder.embed([publicQuery()], { inputType: "document" }))).toBe("category_not_allowed");
    expect(calls).toHaveLength(0);
    await embedder.embed([knowledgeText("§ 1 godkendt viden")], { inputType: "document" });
    expect(calls).toHaveLength(1);
  });

  it("synthetic evaluation material can be used (evaluation flow)", async () => {
    const { embedder, calls } = bedrock();
    await embedder.embed([syntheticText("Fiktivt evalueringsspørgsmål")], { inputType: "query" });
    await embedder.embed([syntheticText("Fiktivt evalueringsdokument")], { inputType: "document" });
    expect(calls).toHaveLength(2);
  });
});

describe("reranking: zero external calls on deny", () => {
  const candidate = (i: number, document: ClassifiedText) => ({ chunkId: `c${i}`, document, retrieval: { fusedScore: 1 / (i + 1) } });

  it("a customer-identifiable query is never reranked", async () => {
    const { reranker, calls } = bedrock();
    expect(await denialOf(reranker.rerank({ query: caseQuery(), topN: 2, candidates: [candidate(0, knowledgeText("§ 1")), candidate(1, knowledgeText("§ 2"))] }))).toBe("case_bound");
    expect(calls).toHaveLength(0);
  });

  it("one illegal passage denies the whole rerank — nothing is sent, not even the allowed passages", async () => {
    const { reranker, calls } = bedrock();
    const candidates = [candidate(0, knowledgeText("§ 1 godkendt")), candidate(1, customerCaseText("Kundens skadesbeskrivelse")), candidate(2, knowledgeText("§ 3 godkendt"))];
    expect(await denialOf(reranker.rerank({ query: publicQuery(), topN: 3, candidates }))).toBe("case_bound");
    expect(await denialOf(reranker.rerank({ query: publicQuery(), topN: 1, candidates: [candidate(0, unknownText("ukendt passage"))] }))).toBe("never_external");
    expect(calls).toHaveLength(0);
  });

  it("an allowed query with Knowledge Engine passages is reranked", async () => {
    const { reranker, calls } = bedrock();
    await reranker.rerank({ query: publicQuery(), topN: 2, candidates: [candidate(0, knowledgeText("§ 1")), candidate(1, knowledgeText("§ 2"))] });
    expect(calls).toHaveLength(1);
  });
});

describe("retrieval carries provenance from the entry to embedding and reranking", () => {
  it("a case-bound query: no embedding request and no rerank request — the retrieval fails closed", async () => {
    const { embedder, reranker, calls } = bedrock();
    const failing = runRetrieval({ query: caseQuery() }, { db, embedding: { embedder, modelId: "m" }, reranker });
    expect(await denialOf(failing)).toBe("case_bound");
    expect(calls).toHaveLength(0);
  });

  it("without an embedding model the case-bound query still never reaches the reranker", async () => {
    const { reranker, calls } = bedrock();
    expect(await denialOf(runRetrieval({ query: caseQuery() }, { db, embedding: null, reranker }))).toBe("case_bound");
    expect(calls).toHaveLength(0);
  });

  it("a query without provenance (a plain string) never reaches an external provider", async () => {
    const { embedder, reranker, calls } = bedrock();
    expect(await denialOf(runRetrieval({ query: PUBLIC_QUESTION }, { db, embedding: { embedder, modelId: "m" }, reranker }))).toBe("missing_provenance");
    expect(calls).toHaveLength(0);
  });

  it("an allowed public query: the trimmed query keeps its provenance to embedding and reranking", async () => {
    const { embedder, reranker, calls } = bedrock();
    const set = await runRetrieval({ query: userText(`  ${PUBLIC_QUESTION}  `, { caseBound: false, redacted: true }) }, { db, embedding: { embedder, modelId: "m" }, reranker });
    expect(calls.map((call) => call.body.input_type ?? "rerank")).toEqual(["search_query", "rerank"]);
    expect(calls[0]!.body.texts).toEqual([PUBLIC_QUESTION]);
    expect(calls[1]!.body.query).toBe(PUBLIC_QUESTION);
    expect(set.items).toHaveLength(1);
  });

  it("the in-process providers keep working for case-bound queries (nothing leaves)", async () => {
    const { createEmbedder, createReranker } = await import("@/lib/knowledge/core/registry");
    const { TEST_EMBEDDER } = await import("@/lib/knowledge/core/test-embedder");
    const set = await runRetrieval({ query: caseQuery() }, { db, embedding: { embedder: createEmbedder({ id: "m", ...TEST_EMBEDDER }, "test"), modelId: "m" }, reranker: createReranker("none", "test") });
    expect(set.items).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------

function spyModel(grade: "production" | "development") {
  const calls: { input: ModelInput; egress: unknown }[] = [];
  const model = {
    id: `spy-${grade}`,
    version: "1",
    grade,
    async generate(input: ModelInput, egress?: unknown) {
      calls.push({ input, egress });
      return { raw: {} };
    },
  } as Model;
  return { model, calls };
}

function modelInput(question: ClassifiedText): ModelInput {
  const set = issueEvidence([evidenceItem(1)], { embedder: "production", reranker: "production" });
  const item = set.items[0]!;
  const parts: SentPart[] = [
    { kind: "question", category: "user_question", text: question.text, content: question },
    {
      kind: "evidence",
      category: "knowledge",
      text: item.excerpt.text,
      content: knowledgeText(item.excerpt.text),
      evidence: { evidenceId: item.evidenceId, label: item.sourceReference.label, temporalStatus: "current", inConflict: false },
    },
  ];
  return { profile: { id: "copilot", version: "1" }, action: "answer_question", system: "", parts, outputContract: "copilot.answer.v1" };
}

describe("model generation uses the same boundary (invokeModel)", () => {
  const evidence = () => requireProductionEvidence(issueEvidence([evidenceItem(1)], { embedder: "production", reranker: "production" }));

  it("an external model never receives case-bound text — redaction does not open it", async () => {
    for (const redacted of [true, false]) {
      const { model, calls } = spyModel("production");
      expect(await denialOf(invokeModel(model as Model<"production">, evidence(), modelInput(caseQuery(redacted)), { egressLog: () => {} }))).toBe("case_bound");
      expect(calls).toHaveLength(0);
    }
  });

  it("an external model never receives parts without provenance, or with mismatching text", async () => {
    const { model, calls } = spyModel("production");
    const input = modelInput(publicQuery());
    const stripped = { ...input, parts: input.parts.map((part) => Object.fromEntries(Object.entries(part).filter(([key]) => key !== "content"))) } as unknown as ModelInput;
    expect(await denialOf(invokeModel(model as Model<"production">, evidence(), stripped, { egressLog: () => {} }))).toBe("missing_provenance");
    const swapped = { ...input, parts: [{ ...input.parts[0]!, text: CASE_TEXT }, input.parts[1]!] };
    expect(await denialOf(invokeModel(model as Model<"production">, evidence(), swapped, { egressLog: () => {} }))).toBe("missing_provenance");
    expect(await denialOf(invokeModel(model as Model<"production">, evidence(), modelInput(userText(PUBLIC_QUESTION, { caseBound: false, redacted: false })), { egressLog: () => {} }))).toBe("not_redacted");
    expect(calls).toHaveLength(0);
  });

  it("an allowed call reaches the external model WITH its authorization", async () => {
    const { model, calls } = spyModel("production");
    await invokeModel(model as Model<"production">, evidence(), modelInput(publicQuery()));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.egress).toMatchObject({ provider: "spy-production", operation: "generate", texts: [PUBLIC_QUESTION, expect.any(String)] });
  });

  it("the pairing rule (B-012) is still checked first and still refuses development evidence", async () => {
    const { model, calls } = spyModel("production");
    const development = issueEvidence([evidenceItem(1)]);
    await expect(invokeModel(model as Model<"production">, development as never, modelInput(publicQuery()))).rejects.toThrow(/evidensgraden er "development"/);
    expect(calls).toHaveLength(0);
  });

  it("the in-process stub model is unchanged: case-bound text works locally and in test", async () => {
    const stub = createModel("stub", "test") as Model<"development">;
    await expect(invokeModel(stub, issueEvidence([evidenceItem(1)]), modelInput(caseQuery()))).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------------------------

describe("the gateway end to end: customer data cannot be allowed by configuration", () => {
  // invokeModel logs denials to the server log; keep the test output clean.
  beforeEach(() => void vi.spyOn(console, "warn").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());
  const CASE_ID = "11111111-1111-4111-8111-111111111111";
  // An administrator's attempt to allow customer data in the matrix (the database refuses this
  // row since 8B-I2.5; here it is fed in directly to prove the boundary does not read it).
  const permissiveRows = (modelId: string): PolicyRow[] =>
    ["knowledge", "user_question", "customer_identifiable"].map((category) => ({ model_id: modelId, category, rule: "allow" }));

  function deps(options: { model: Model; retrieve?: GatewayDeps["retrieve"] }) {
    const records: CallRecord[] = [];
    const value: GatewayDeps = {
      user: async () => ({ id: "u1", name: "Anne Rådgiver" }),
      hasPermission: async () => true,
      loadCase: async (id) => (id === CASE_ID ? { id, companyName: "Fiktiv Tømrer ApS" } : null),
      gatingState: async () => ({ assessmentActive: false, roleplaySessionId: null }),
      policyRows: async (modelId) => permissiveRows(modelId),
      retrieve: options.retrieve ?? (async () => issueEvidence([evidenceItem(1)], { embedder: "production", reranker: "production" })),
      model: () => options.model,
      record: async (entry) => void records.push(structuredClone(entry)),
      environment: "test",
    };
    return { value, records };
  }

  const ask = (caseId?: string) => ({ profile: "copilot" as const, action: "answer_question", input: "Er liften dækket af erhvervsansvaret?", context: caseId ? { caseId } : {} });

  it("a case-bound call to an external model is blocked — the matrix allowing customer data changes nothing", async () => {
    const { model, calls } = spyModel("production");
    const { value, records } = deps({ model });
    const outcome = await runGateway(ask(CASE_ID), value);
    expect(outcome).toEqual({ kind: "blocked_policy", category: "customer_identifiable", message: CASE_DATA_BLOCKED_MESSAGE });
    expect(calls).toHaveLength(0);
    expect(records[0]!.call).toMatchObject({ outcome: "blocked_policy", reason_code: "egress_denied_case_bound", case_id: CASE_ID });
    expect(records[0]!.payload).toBeNull(); // Nothing was sent, so nothing is logged as sent.
  });

  it("the same call without a case reaches the external model", async () => {
    const { model, calls } = spyModel("production");
    await runGateway(ask(), deps({ model }).value);
    expect(calls).toHaveLength(1);
  });

  it("case-bound retrieval with external providers: zero Bedrock calls, blocked_policy for the user", async () => {
    const providers = bedrock();
    const stub = createModel("stub", "test");
    const { value } = deps({
      model: stub,
      retrieve: (request) => runRetrieval(request, { db, embedding: { embedder: providers.embedder, modelId: "m" }, reranker: providers.reranker }),
    });
    const outcome = await runGateway(ask(CASE_ID), value);
    expect(outcome).toMatchObject({ kind: "blocked_policy", message: CASE_DATA_BLOCKED_MESSAGE });
    expect(providers.calls).toHaveLength(0);
    expect(providers.denials[0]).toMatchObject({ operation: "embed_query", category: "customer_identifiable" });
  });

  it("the gateway's own query reaches the external providers when no case is involved", async () => {
    const providers = bedrock();
    const { value } = deps({
      model: createModel("stub", "test"),
      retrieve: (request) => runRetrieval(request, { db, embedding: { embedder: providers.embedder, modelId: "m" }, reranker: providers.reranker }),
    });
    await runGateway(ask(), value);
    expect(providers.calls.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------

describe("no way around the boundary", () => {
  it("customer data cannot be allowed through a provider descriptor", async () => {
    const fake = fakeBedrock(bedrockHandler);
    const descriptor = { ...EMBED_V4_EU_1024_DESCRIPTOR, settings: { ...EMBED_V4_EU_1024_DESCRIPTOR.settings, allowCustomerData: true, euOnly: true } };
    const embedder = createCohereEmbedV4({ transport: fake.transport, descriptor, retryDeps: noSleep, egressLog: () => {} });
    expect(await denialOf(embedder.embed([caseQuery()], { inputType: "query" }))).toBe("case_bound");
    expect(fake.calls).toHaveLength(0);
  });

  it("a transport refuses a body without a genuine authorization, or with text that was not authorized", () => {
    const egress = authorizeEgress({ provider: "aws-bedrock", operation: "embed_query", module: "test", parts: [{ role: "query", content: publicQuery() }] }, silent);
    const send = (token: unknown, body: unknown, provider = "aws-bedrock", modelId = "eu.cohere.embed-v4:0") =>
      () => assertTransmittable(token as never, { provider, modelId, body, log: () => {} });
    expect(send(egress, { texts: [PUBLIC_QUESTION], input_type: "search_query" })).not.toThrow();
    expect(send(undefined, { texts: [PUBLIC_QUESTION] })).toThrow(EgressPolicyError);
    expect(send({ ...egress }, { texts: [PUBLIC_QUESTION] })).toThrow(EgressPolicyError); // A copy is not an authorization.
    expect(send(egress, { texts: [PUBLIC_QUESTION, CASE_TEXT] })).toThrow(EgressPolicyError);
    expect(send(egress, { texts: [PUBLIC_QUESTION], note: "Kunden" })).toThrow(EgressPolicyError);
    expect(send(egress, { texts: [PUBLIC_QUESTION] }, "other-provider")).toThrow(EgressPolicyError);
    expect(send(egress, { texts: [PUBLIC_QUESTION] }, "aws-bedrock", "Kunden Fiktiv")).toThrow(EgressPolicyError);
  });

  it("calling the real SDK transport directly with customer text sends nothing", async () => {
    vi.resetModules();
    const send = vi.fn();
    vi.doMock("@aws-sdk/client-bedrock-runtime", () => ({
      BedrockRuntimeClient: class {
        send = send;
      },
      InvokeModelCommand: class {},
    }));
    const { createSdkBedrockTransport } = await import("@/lib/knowledge/providers/bedrock/sdk-transport");
    const policy = await import("@/lib/egress/policy");
    const classification = await import("@/lib/egress/classification");
    const transport = createSdkBedrockTransport({ region: "eu-central-1", env: { IPA_RUNTIME_ENV: "test" } });
    const signal = new AbortController().signal;
    const allowed = policy.authorizeEgress({ provider: "aws-bedrock", operation: "embed_query", module: "test", parts: [{ role: "query", content: classification.userText(PUBLIC_QUESTION, { caseBound: false, redacted: true }) }] }, silent);
    const attempts = [
      () => transport.invoke({ modelId: "eu.cohere.embed-v4:0", egress: undefined as never, body: { texts: [CASE_TEXT] }, signal }),
      () => transport.invoke({ modelId: "eu.cohere.embed-v4:0", egress: { ...allowed } as never, body: { texts: [CASE_TEXT] }, signal }),
      () => transport.invoke({ modelId: "eu.cohere.embed-v4:0", egress: allowed, body: { texts: [CASE_TEXT] }, signal }),
    ];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const attempt of attempts) await expect(attempt()).rejects.toMatchObject({ name: "EgressPolicyError", reason: "unauthorized_transmission" });
    warn.mockRestore();
    expect(send).not.toHaveBeenCalled();
    vi.doUnmock("@aws-sdk/client-bedrock-runtime");
  });
});
