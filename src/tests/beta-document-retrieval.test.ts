import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { userText } from "@/lib/egress/classification";
import { EvidenceGradeError, issueEvidenceSet, requireProductionEvidence, type EvidenceSet } from "@/lib/knowledge/core/evidence";
import { assessProduction } from "@/lib/knowledge/core/production-conditions";
import { documentMaterialProblem, retrievalFingerprint, retrievalMethodOf } from "@/lib/knowledge/core/provider";
import { parseRetrievalContext } from "@/lib/knowledge/core/retrieval-context";
import { providersForContext } from "@/lib/knowledge/providers/configured";
import { activeModelFromContext, assessRetrieval } from "@/lib/knowledge/retrieval-availability";
import {
  DEFAULT_DOCUMENT_RETRIEVAL_PARAMS,
  PRODUCT_DOCUMENTS_ALGORITHM_VERSION,
  RetrievalError,
  runProductDocumentRetrieval,
  runRetrieval,
  type DocumentRetrievalDeps,
  type DocumentRow,
  type RetrievalRequest,
} from "@/lib/knowledge/retrieval-core";

import { createFixtureRetrieval } from "../../evals/engine/fixture-retrieval.ts";
import { developmentEvidence } from "../../evals/engine/observe.ts";
import { isDevelopmentConfiguration } from "../../evals/engine/publication.ts";
import { runEvaluation } from "../../evals/engine/runner.ts";
import { validateDeclaredConfiguration } from "../../evals/engine/schema.ts";
import type { EvalCase, RetrievalRun } from "../../evals/engine/types.ts";

import { loadExample } from "./fixtures/eval-retrieval";
import {
  FIXTURE_CHUNKER_VERSION,
  FIXTURE_MODEL,
  FIXTURE_PRODUCT_ID,
  FIXTURE_TEST_PRODUCT_ID,
  fixtureContext,
  fixtureDb,
  fixtureDocumentMaterial,
  fixtureDocumentRow,
  fixtureMaterial,
  fixtureQuery,
  productionProviders,
  type ContextOverrides,
} from "./fixtures/production-config";

/**
 * B-035 (beta, L1) — the retrieval method product_documents: no embedding, no reranker; the
 * chosen product's authorized, published and valid document versions in full, within a budget.
 *
 *   * P1/P2 and H6 are adapted EXPLICITLY and only for this method; P3–P9 are unchanged.
 *   * The method is the code path that ran — never a request value — and the database's
 *     configuration in service decides it.
 *   * Nothing becomes production automatically: an unevaluated, unapproved, suspended or
 *     out-of-scope configuration gives development evidence.
 */

const NOW = () => new Date("2026-10-05T10:00:00Z");
const DOC_CONTEXT = (overrides: ContextOverrides = {}) => fixtureContext({ material: fixtureDocumentMaterial(), ...overrides });
const REQUEST = (overrides: Partial<RetrievalRequest> = {}): RetrievalRequest => ({ query: fixtureQuery(), productIds: [FIXTURE_PRODUCT_ID], ...overrides });

function docDeps(overrides: { context?: Record<string, unknown> | null; rows?: DocumentRow[]; error?: { code: string; message: string }; args?: Record<string, unknown>[]; calls?: string[]; params?: DocumentRetrievalDeps["params"] } = {}): DocumentRetrievalDeps {
  return {
    db: fixtureDb({
      documentRows: overrides.rows,
      documentError: overrides.error,
      context: overrides.context !== undefined ? overrides.context : DOC_CONTEXT(),
      args: overrides.args,
      calls: overrides.calls,
    }),
    params: overrides.params ?? { ...DEFAULT_DOCUMENT_RETRIEVAL_PARAMS },
    now: NOW,
  };
}

const retrieveDocs = (overrides: Parameters<typeof docDeps>[0] = {}, request: Partial<RetrievalRequest> = {}) => runProductDocumentRetrieval(REQUEST(request), docDeps(overrides));

function expectDevelopment(set: EvidenceSet, condition: string) {
  expect(set.retrieval.grade).toBe("development");
  expect(set.retrieval.unmet).toContain(condition);
  expect(() => requireProductionEvidence(set)).toThrow(EvidenceGradeError);
}

describe("the material of product_documents (as the database decides it)", () => {
  it("a valid material has no problem, and hybrid material is unchanged (no method field)", () => {
    expect(documentMaterialProblem(fixtureDocumentMaterial())).toBeNull();
    expect(retrievalMethodOf(fixtureDocumentMaterial())).toBe("product_documents");
    expect("method" in fixtureMaterial()).toBe(false);
    expect(retrievalMethodOf(fixtureMaterial())).toBe("hybrid");
  });

  it.each([
    [{ embedding: fixtureMaterial().embedding }, "metoden product_documents har ingen embedding-model"],
    [{ reranker: fixtureMaterial().reranker }, "metoden product_documents har ingen reranker"],
    [{ method: "hybrid" }, "ukendt retrieval-metode"],
    [{ topK: 8 }, "materialet har ikke de definerende felter"],
    [{ algorithmVersion: "hybrid-rrf-1" }, "algoritmeversionen er ugyldig"],
    [{ params: { maxChars: 9_999 } }, "parameteren maxChars er ugyldig"],
    [{ params: { maxChars: 20_000.5 } }, "parameteren maxChars er ugyldig"],
    [{ params: { maxChars: 20_000, minScore: 0.1 } }, "parametrene er ufuldstændige"],
    [{ chunkerVersions: [] }, "chunker-versionerne er ugyldige"],
  ])("rejects %j", (change, message) => {
    expect(documentMaterialProblem({ ...fixtureDocumentMaterial(), ...change })).toBe(message);
  });

  it("the configuration files are valid; an embedding in a product_documents file is refused", () => {
    for (const name of ["product-documents-fixture", "product-documents-structure-1"]) {
      const file = JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../evals/retrieval/configurations/${name}.json`), "utf8")) as Record<string, unknown>;
      const declared = validateDeclaredConfiguration(file);
      expect(retrievalMethodOf(declared.configuration)).toBe("product_documents");
      expect(documentMaterialProblem(declared.configuration)).toBeNull();
      const withEmbedding = { ...file, configuration: { ...(file.configuration as object), embedding: fixtureMaterial().embedding } };
      expect(() => validateDeclaredConfiguration(withEmbedding)).toThrow(/embedding/);
    }
  });

  it("the publisher's rule matches the database: valid product_documents is not development; invalid always is", () => {
    expect(isDevelopmentConfiguration(fixtureDocumentMaterial())).toBe(false);
    expect(isDevelopmentConfiguration({ ...fixtureDocumentMaterial(), params: { maxChars: 5 } })).toBe(true);
    expect(isDevelopmentConfiguration({ ...fixtureMaterial(), reranker: { ...fixtureMaterial().reranker, id: "none" } })).toBe(true);
  });
});

describe("the retrieval context of a product_documents configuration", () => {
  it("parses the method, and neither embedding model nor reranker", () => {
    const configuration = parseRetrievalContext(DOC_CONTEXT())!.configuration!;
    expect(configuration).toMatchObject({ method: "product_documents", embeddingModelId: null, rerankerId: null, rerankerVersion: null, params: { maxChars: 360_000 } });
  });

  it.each([
    ["the stated method is not the material's", { method: "hybrid" }],
    ["an embedding model", { embeddingModelId: FIXTURE_MODEL.id }],
    ["a reranker", { rerankerId: "none", rerankerVersion: "1" }],
    ["hybrid parameters", { params: fixtureMaterial().params }],
  ])("is rejected as a whole (fail-closed): %s", (_, change) => {
    const context = DOC_CONTEXT();
    expect(parseRetrievalContext({ ...context, configuration: { ...(context.configuration as object), ...change } })).toBeNull();
  });

  it("a hybrid material stated as product_documents is rejected (the material decides the method)", () => {
    const context = fixtureContext();
    const configuration = { ...(context.configuration as object), method: "product_documents", embeddingModelId: null, rerankerId: null, rerankerVersion: null, params: { maxChars: 360_000 } };
    expect(parseRetrievalContext({ ...context, configuration })).toBeNull();
  });

  it("a hybrid configuration without an embedding model is rejected too", () => {
    const context = fixtureContext();
    expect(parseRetrievalContext({ ...context, configuration: { ...(context.configuration as object), embeddingModelId: null } })).toBeNull();
  });
});

describe("runProductDocumentRetrieval", () => {
  it("issues production evidence when P1–P9 hold: the whole version, in order, without embedder or reranker", async () => {
    const set = await retrieveDocs();
    expect(set.schemaVersion).toBe(3);
    expect(set.retrieval).toMatchObject({ method: "product_documents", embeddingModel: null, reranker: null, grade: "production", unmet: [] });
    expect(set.retrieval.configuration).toEqual({
      id: "f6000000-0000-4000-8000-000000000002",
      fingerprint: retrievalFingerprint(fixtureDocumentMaterial()),
      algorithmVersion: PRODUCT_DOCUMENTS_ALGORITHM_VERSION,
    });
    expect(set.items.map((item) => item.chunkIndex)).toEqual([0, 1]);
    expect(set.items.every((item) => item.relevance.score === 1 && item.relevance.reasons.length === 0)).toBe(true);
    expect(requireProductionEvidence(set)).toBe(set);
  });

  it("asks the database for exactly the product, mode, filters and budget — never the question", async () => {
    const args: Record<string, unknown>[] = [];
    await retrieveDocs({ args }, { documentTypes: ["terms"], documentIds: ["f9000000-0000-4000-8000-000000000001"], mode: "as_of", asOf: "2026-01-01" });
    const call = args.find((entry) => entry.fn === "product_document_chunks")!;
    expect(call).toEqual({
      fn: "product_document_chunks",
      p_product_id: FIXTURE_PRODUCT_ID,
      p_mode: "as_of",
      p_as_of: "2026-01-01",
      p_language: "da",
      p_document_ids: ["f9000000-0000-4000-8000-000000000001"],
      p_document_types: ["terms"],
      p_max_chars: 360_000,
    });
    expect(JSON.stringify(args)).not.toContain(fixtureQuery().text);
    expect(args.some((entry) => entry.fn === "search_chunks")).toBe(false);
  });

  it("requires exactly one product", async () => {
    await expect(runProductDocumentRetrieval({ query: fixtureQuery() }, docDeps())).rejects.toMatchObject({ code: "invalid_request", message: "Vælg ét produkt." });
    await expect(retrieveDocs({}, { productIds: [FIXTURE_PRODUCT_ID, FIXTURE_TEST_PRODUCT_ID] })).rejects.toMatchObject({ code: "invalid_request" });
  });

  it.each([
    ["a chunk is missing", [fixtureDocumentRow(0, 3), fixtureDocumentRow(1, 3)]],
    ["a chunk occurs twice", [fixtureDocumentRow(0, 2), fixtureDocumentRow(0, 2)]],
    ["the counts disagree", [fixtureDocumentRow(0, 2), fixtureDocumentRow(1, 3)]],
    ["a count is not positive", [fixtureDocumentRow(0, 0)]],
  ])("an incomplete version is a system failure, never a shorter basis: %s", async (_, rows) => {
    await expect(retrieveDocs({ rows })).rejects.toMatchObject({ code: "unavailable" });
  });

  it("a basis over the budget is refused with the database's message, never truncated", async () => {
    const error = { code: "54000", message: "Dokumentgrundlaget for produktet er for stort til ét samlet svar." };
    await expect(retrieveDocs({ error })).rejects.toEqual(new RetrievalError("invalid_request", error.message));
    await expect(retrieveDocs({ error: { code: "22023", message: "Vælg et produkt" } })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(retrieveDocs({ error: { code: "XX000", message: "intern fejl" } })).rejects.toMatchObject({ code: "unavailable" });
  });

  it("looks up conflicts in batches the database accepts (at most 200 chunks per call)", async () => {
    const rows = Array.from({ length: 450 }, (_, i) => fixtureDocumentRow(i, 450));
    const args: Record<string, unknown>[] = [];
    const set = await retrieveDocs({ rows, args });
    const lookups = args.filter((entry) => entry.fn === "evidence_conflicts").map((entry) => (entry.p_chunk_ids as string[]).length);
    expect(lookups).toEqual([200, 200, 50]);
    expect(set.items).toHaveLength(450);
  });

  it("the development tool gives a marked, empty development set — only locally and in test", async () => {
    const set = await runProductDocumentRetrieval(REQUEST(), { ...docDeps(), devForceInsufficient: true });
    expect(set.items).toEqual([]);
    expect(set.retrieval).toMatchObject({ method: "product_documents", devOverride: "force_insufficient", grade: "development" });
  });
});

describe("P1–P9 for product_documents: nothing becomes production by itself", () => {
  it("no configuration in service: development", async () => {
    expectDevelopment(await retrieveDocs({ context: fixtureContext({ configuration: null }) }), "P1");
  });

  it("a HYBRID configuration in service and the document method run: P1 and P2 fail", async () => {
    const set = await retrieveDocs({ context: fixtureContext() });
    expectDevelopment(set, "P1");
    expect(set.retrieval.unmet).toEqual(expect.arrayContaining(["P1", "P2", "P4"]));
  });

  it("a product_documents configuration in service and the HYBRID path run: P1 and P2 fail", async () => {
    const providers = productionProviders();
    const set = await runRetrieval(REQUEST(), {
      db: fixtureDb({ context: DOC_CONTEXT() }),
      embedding: { embedder: providers.embedder, modelId: FIXTURE_MODEL.id },
      reranker: providers.reranker,
      now: NOW,
    });
    expectDevelopment(set, "P1");
    expect(set.retrieval.unmet).toEqual(expect.arrayContaining(["P1", "P2"]));
  });

  it("an embedder or a reranker present: P1 or P2 fails", () => {
    const providers = productionProviders();
    const base = {
      context: parseRetrievalContext(DOC_CONTEXT()),
      method: "product_documents" as const,
      algorithmVersion: PRODUCT_DOCUMENTS_ALGORITHM_VERSION,
      params: { ...DEFAULT_DOCUMENT_RETRIEVAL_PARAMS },
      query: { text: "x", mode: "current" as const, asOf: "2026-10-05", language: "da", filters: {} },
      items: [],
      devOverride: false,
      schemaVersion: 3,
    };
    expect(assessProduction({ ...base, embedding: null, reranker: null }).unmet).toEqual([]);
    expect(assessProduction({ ...base, embedding: { embedder: providers.embedder, modelId: FIXTURE_MODEL.id }, reranker: null }).unmet).toContain("P1");
    expect(assessProduction({ ...base, embedding: null, reranker: providers.reranker }).unmet).toContain("P2");
  });

  it("P1 and P2 check the methods themselves, not only the absence of a model and a reranker", () => {
    const parsed = parseRetrievalContext(DOC_CONTEXT())!;
    // A hand-built context (assessProduction is pure): a hybrid configuration without model or reranker.
    const hybridWithoutProviders = { ...parsed, configuration: { ...parsed.configuration!, method: "hybrid" as const } };
    const input = {
      method: "product_documents" as const,
      embedding: null,
      reranker: null,
      algorithmVersion: PRODUCT_DOCUMENTS_ALGORITHM_VERSION,
      params: { ...DEFAULT_DOCUMENT_RETRIEVAL_PARAMS },
      query: { text: "x", mode: "current" as const, asOf: "2026-10-05", language: "da", filters: {} },
      items: [],
      devOverride: false,
      schemaVersion: 3,
    };
    expect(assessProduction({ ...input, context: hybridWithoutProviders }).unmet).toEqual(expect.arrayContaining(["P1"]));
    // The hybrid path ran, without a reranker, against a product_documents configuration.
    expect(assessProduction({ ...input, method: "hybrid", context: parsed }).unmet).toEqual(expect.arrayContaining(["P1", "P2"]));
  });

  it("a budget other than the evaluated one: the runtime is not the configuration (P4)", async () => {
    expectDevelopment(await runProductDocumentRetrieval(REQUEST(), docDeps({ params: { maxChars: 100_000 } })), "P4");
  });

  it("a product outside the evaluated area (P3), an unapproved evaluation (P3) or a suspended configuration (P3)", async () => {
    expectDevelopment(await retrieveDocs({ context: DOC_CONTEXT({ scope: [{ documentType: "terms", productId: FIXTURE_TEST_PRODUCT_ID, productName: "Testprodukt (fiktiv)" }] }) }), "P3");
    expectDevelopment(await retrieveDocs({ context: DOC_CONTEXT({ passed: false }) }), "P3");
    expectDevelopment(await retrieveDocs({ context: DOC_CONTEXT({ status: "suspended" }) }), "P3");
    expectDevelopment(await retrieveDocs({ context: DOC_CONTEXT({ outcome: "pass_with_uncertainty", uncertaintyAccepted: false }) }), "P3");
  });

  it("a chunker version the configuration was not evaluated with (P7), and not run as a signed-in user (P6)", async () => {
    expectDevelopment(await retrieveDocs({ rows: [fixtureDocumentRow(0, 1, { chunker_version: "structure/0" })] }), "P7");
    expectDevelopment(await retrieveDocs({ context: DOC_CONTEXT({ role: "service_role", userId: null }) }), "P6");
  });

  it("a copy of a production set is never production evidence", async () => {
    const set = await retrieveDocs();
    expect(() => requireProductionEvidence(structuredClone(set))).toThrow(EvidenceGradeError);
  });

  it("issueEvidenceSet cannot pass a hybrid set off as product_documents, or the reverse", () => {
    const context = parseRetrievalContext(DOC_CONTEXT());
    const common = {
      query: { text: "x", mode: "current" as const, asOf: "2026-10-05", language: "da", filters: {} },
      context,
      candidateCount: 0,
      generatedAt: NOW().toISOString(),
      items: [],
    };
    const hybridClaim = issueEvidenceSet({ ...common, embedding: null, reranker: null, method: "hybrid", algorithmVersion: PRODUCT_DOCUMENTS_ALGORITHM_VERSION, params: { ...DEFAULT_DOCUMENT_RETRIEVAL_PARAMS } });
    expectDevelopment(hybridClaim, "P1");
  });
});

describe("providers and availability for product_documents", () => {
  const touched = () => {
    throw new Error("udbyderens runtime må ikke røres");
  };

  it("constructs no embedder and no reranker and never touches a provider runtime", () => {
    const context = parseRetrievalContext(DOC_CONTEXT())!;
    expect(providersForContext(context, touched, "production")).toEqual({ method: "product_documents", embedding: null, reranker: null });
  });

  it("a context that was read without an active model means none active — never 'could not be read'", () => {
    const context = parseRetrievalContext(DOC_CONTEXT({ activeModel: null }))!;
    expect(activeModelFromContext(context)).toBeNull();
    expect(activeModelFromContext(null)).toBeUndefined();
    expect(assessRetrieval({ demo: false, databaseConfigured: true, activeModel: activeModelFromContext(context), context, runtime: touched, environment: "production" }).state).toBe("available");
  });

  it("is available — also without any active embedding model — and production when the configuration is ready", () => {
    const context = parseRetrievalContext(DOC_CONTEXT({ activeModel: null }))!;
    expect(assessRetrieval({ demo: false, databaseConfigured: true, activeModel: null, context, runtime: touched, environment: "production" })).toMatchObject({
      state: "available",
      method: "product_documents",
      reranker: null,
      embeddingModel: null,
      grade: "production",
      productionUnavailable: null,
    });
  });
});

describe("H6 for product_documents (the evaluation verifies the method that ran)", () => {
  async function run(change: (set: EvidenceSet) => EvidenceSet = (set) => set, counts: Record<string, number> | null = { "f8000000-0000-4000-8000-000000000001": 2 }): Promise<RetrievalRun> {
    const set = change(await retrieveDocs());
    const chunkerVersions = Object.fromEntries(set.items.flatMap((item) => item.chunkIds.map((id) => [id, FIXTURE_CHUNKER_VERSION])));
    return { actor: "a", set, chunkerVersions, ...(counts ? { versionChunkCounts: counts } : {}) };
  }
  const h6 = async (...args: Parameters<typeof run>) => developmentEvidence("c", await run(...args), fixtureDocumentMaterial()).map((violation) => violation.explanation);

  it("complete versions from the declared method: no breach", async () => {
    expect(await h6()).toEqual([]);
  });

  it("a version not included in full is a breach", async () => {
    expect(await h6((set) => ({ ...set, items: set.items.slice(0, 1) }))).toEqual([expect.stringMatching(/ikke medtaget i fuld længde \(1 af 2 chunks\)/)]);
  });

  it("without the corpus counts, completeness cannot be verified: a breach (fail-closed)", async () => {
    expect(await h6(undefined, null)).toEqual([expect.stringMatching(/Fuldstændigheden kan ikke efterprøves/)]);
  });

  it("an embedder, a reranker or another method is a breach", async () => {
    expect(await h6((set) => ({ ...set, retrieval: { ...set.retrieval, embeddingModel: { id: "x", grade: "production" } } }))).toEqual([expect.stringMatching(/embedding-model/)]);
    expect(await h6((set) => ({ ...set, retrieval: { ...set.retrieval, reranker: { id: "x", version: "1", grade: "production" } } }))).toEqual([expect.stringMatching(/reranker/)]);
    expect(await h6((set) => ({ ...set, retrieval: { ...set.retrieval, method: "hybrid" } }))).toEqual([expect.stringMatching(/Metoden \(hybrid\) er ikke den evaluerede/)]);
  });

  it("a query without exactly one product is a breach", async () => {
    expect(await h6((set) => ({ ...set, query: { ...set.query, filters: {} } }))).toEqual([expect.stringMatching(/netop ét produkt/)]);
  });

  it("a hybrid configuration is still judged as before: a run without reranker is a breach", async () => {
    const run2 = await run();
    expect(developmentEvidence("c", run2, fixtureMaterial()).map((violation) => violation.explanation)).toEqual(
      expect.arrayContaining([expect.stringMatching(/Metoden \(product_documents\) er ikke den evaluerede/), "Der kørte ingen reranker."]),
    );
  });
});

describe("evaluating product_documents on the fictional corpus (docs/beta.md §5.1)", () => {
  const inputs = loadExample();
  const productOf = (evalCase: EvalCase): string => {
    const document = evalCase.expected.passages[0]?.document ?? evalCase.filters?.documents?.[0];
    return inputs.set.manifest.documents.find((entry) => entry.key === document)?.product ?? "ansvar-fiktiv";
  };
  const retrieval = createFixtureRetrieval({ manifest: inputs.set.manifest, fixtures: inputs.fixtures, documents: { ...DEFAULT_DOCUMENT_RETRIEVAL_PARAMS }, now: () => new Date() });
  const declared = { label: "product-documents-fixture", configuration: retrieval.configuration() };

  it("without a product per question, every question fails closed (the method requires the product)", async () => {
    const report = await runEvaluation({ set: inputs.set, gates: inputs.gates, declared, retrieval });
    expect(report.cases.filter((observation) => observation.error === "Vælg ét produkt.").length).toBeGreaterThan(0);
    expect(report.valid).toBe(false);
  });

  it("with the product per question: H1–H6 hold; H7 fails in the fixture; Q4 and Q7 show the gate finding", async () => {
    const set = { ...inputs.set, cases: inputs.set.cases.map((evalCase) => ({ ...evalCase, filters: { ...evalCase.filters, products: [productOf(evalCase)] } })) };
    const report = await runEvaluation({ set, gates: inputs.gates, declared, retrieval });
    expect(report.configuration.matches).toBe(true);
    expect(report.cases.every((observation) => observation.error === null)).toBe(true);
    expect(Object.fromEntries(report.hardGates.map((gate) => [gate.id, gate.status]))).toEqual({ H1: "pass", H2: "pass", H3: "pass", H4: "pass", H5: "pass", H6: "pass", H7: "fail" });
    // The finding (docs/beta.md §5.1): retrieval returns the product's documents also for a
    // question they do not answer (only a missing grant gives an empty set), and there is no
    // reranker to compare with.
    expect(report.cases.filter((observation) => observation.type === "unanswerable").every((observation) => !observation.empty)).toBe(true);
    expect(report.qualityGates.find((gate) => gate.id === "Q4")?.status).toBe("fail");
    expect(report.qualityGates.find((gate) => gate.id === "Q7")).toMatchObject({ status: "fail", value: null });
    expect(report.verdict).toBe("fail");
  });
});

describe("a question with provenance passes untouched through the document method", () => {
  it("the query keeps its classification and is never sent anywhere during retrieval", async () => {
    const question = userText("Er tyveri af værktøj dækket?", { caseBound: false, redacted: true });
    const calls: string[] = [];
    const set = await runProductDocumentRetrieval({ query: question, productIds: [FIXTURE_PRODUCT_ID] }, docDeps({ calls }));
    expect(set.query.text).toBe("Er tyveri af værktøj dækket?");
    expect(calls).not.toContain("search_chunks");
  });
});
