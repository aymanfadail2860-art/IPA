import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { EmbeddingProvider } from "@/lib/knowledge/core/embedding";
import { EvidenceGradeError, issueEvidenceSet, requireProductionEvidence, type EvidenceSet, type ProductionEvidenceSet } from "@/lib/knowledge/core/evidence";
import { assessProduction, PRODUCTION_CONDITIONS, withinApprovedScope, type ProductionCondition } from "@/lib/knowledge/core/production-conditions";
import { isProductionImplementation, markProductionImplementation } from "@/lib/knowledge/core/production-implementation";
import { retrievalFingerprint } from "@/lib/knowledge/core/provider";
import { createEmbedder, createReranker } from "@/lib/knowledge/core/registry";
import { parseRetrievalContext } from "@/lib/knowledge/core/retrieval-context";
import { TEST_EMBEDDER } from "@/lib/knowledge/core/test-embedder";
import { createCohereEmbedV4, EMBED_V4_EU_1024_DESCRIPTOR } from "@/lib/knowledge/providers/bedrock/cohere-embed-v4";
import { providersForContext } from "@/lib/knowledge/providers/configured";
import { DEFAULT_RETRIEVAL_CONFIG, RETRIEVAL_ALGORITHM_VERSION, runRetrieval, type RetrievalDeps, type RetrievalRequest } from "@/lib/knowledge/retrieval-core";

import { evidenceItem } from "./fixtures/ai-evidence";
import { fakeBedrock, embedResponse, noSleep } from "./fixtures/bedrock-fake";
import {
  FIXTURE_MODEL,
  fixtureContext,
  fixtureDb,
  fixtureMaterial,
  fixtureQuery,
  fixtureRow,
  productionProviders,
  type ContextOverrides,
} from "./fixtures/production-config";
import { withRuntimeEnv } from "./fixtures/runtime-env";

/**
 * 8B-I6 — P1–P9 (docs/08b §9). One positive end-to-end fixture where every condition holds,
 * and at least one negative per condition, each changing exactly one thing. Plus the
 * adversarial cases: a manual grade, forged or copied sets, a development provider dressed up
 * as production, a configuration evaluated as A but running as B, settings changed after the
 * evaluation, a suspended configuration and an unknown chunker version.
 */

const NOW = () => new Date("2026-10-05T10:00:00Z");

function deps(overrides: Partial<RetrievalDeps> & { context?: Record<string, unknown> | null; contextOverrides?: ContextOverrides; rows?: NonNullable<Parameters<typeof fixtureDb>[0]>["rows"] } = {}): RetrievalDeps {
  const providers = productionProviders();
  const { context, contextOverrides, rows, ...rest } = overrides;
  return {
    db: fixtureDb({ rows, context: context !== undefined ? context : fixtureContext(contextOverrides) }),
    embedding: { embedder: providers.embedder, modelId: FIXTURE_MODEL.id },
    reranker: providers.reranker,
    config: DEFAULT_RETRIEVAL_CONFIG,
    now: NOW,
    ...rest,
  };
}

const retrieve = (overrides: Parameters<typeof deps>[0] = {}, request: Partial<RetrievalRequest> = {}) => runRetrieval({ query: fixtureQuery(), ...request }, deps(overrides));

function expectOnly(set: EvidenceSet, condition: ProductionCondition) {
  expect(set.retrieval.grade).toBe("development");
  expect(set.retrieval.unmet).toContain(condition);
  expect(() => requireProductionEvidence(set)).toThrow(EvidenceGradeError);
}

describe("the positive end-to-end fixture: P1–P9 all hold", () => {
  it("issues production evidence that requireProductionEvidence accepts", async () => {
    const set = await retrieve();
    expect(set.schemaVersion).toBe(2);
    expect(set.retrieval.unmet).toEqual([]);
    expect(set.retrieval.grade).toBe("production");
    const material = fixtureMaterial();
    expect(set.retrieval.configuration).toEqual({ id: "f6000000-0000-4000-8000-000000000002", fingerprint: retrievalFingerprint(material), algorithmVersion: RETRIEVAL_ALGORITHM_VERSION });
    expect(set.items.length).toBeGreaterThan(0);
    expect(set.items.every((item) => item.chunkerVersion === "structure/1")).toBe(true);
    const production: ProductionEvidenceSet = requireProductionEvidence(set);
    expect(production).toBe(set);
  });

  it("an empty (insufficient) result can also be production evidence", async () => {
    const set = await retrieve({ rows: [] });
    expect(set.items).toEqual([]);
    expect(set.retrieval.grade).toBe("production");
  });

  it("is independent of the shell: IPA_RUNTIME_ENV=production gives the same grade", async () => {
    const set = await withRuntimeEnv("production", () => retrieve());
    expect(set.retrieval.grade).toBe("production");
  });
});

describe("P1 — a production embedder whose model is the active model", () => {
  it("fails with the test embedder", async () => {
    const testModel = { id: FIXTURE_MODEL.id, ...TEST_EMBEDDER };
    expectOnly(await retrieve({ embedding: { embedder: createEmbedder(testModel, "test"), modelId: FIXTURE_MODEL.id } }), "P1");
  });

  it("fails without an embedding model (lexical only)", async () => {
    expectOnly(await retrieve({ embedding: null }), "P1");
  });

  it("fails when the active model is not the configuration's model", async () => {
    const context = fixtureContext({ activeModel: { ...FIXTURE_MODEL, id: "f6000000-0000-4000-8000-0000000000ee" } });
    expectOnly(await retrieve({ context }), "P1");
  });

  it("fails when the query was embedded for another model id than the active one", async () => {
    const providers = productionProviders();
    expectOnly(await retrieve({ embedding: { embedder: providers.embedder, modelId: "f6000000-0000-4000-8000-0000000000ef" } }), "P1");
  });

  it("fails for a development implementation that declares production grade and a Bedrock descriptor (masquerade)", async () => {
    const test = createEmbedder({ id: FIXTURE_MODEL.id, ...TEST_EMBEDDER }, "test");
    const masquerade = Object.freeze({ ...test, id: "aws-bedrock:cohere.embed-v4:0@eu-1024-v1", grade: "production" as const, dimensions: 1024, descriptor: EMBED_V4_EU_1024_DESCRIPTOR }) as EmbeddingProvider;
    expect(isProductionImplementation(masquerade)).toBe(false);
    const set = await retrieve({ embedding: { embedder: masquerade, modelId: FIXTURE_MODEL.id } }).catch((error: unknown) => error);
    // Either the dimensions are refused by the pipeline, or the set is development — never production.
    if (set instanceof Error) expect(set.message).toMatch(/embeddes/);
    else expectOnly(set as EvidenceSet, "P1");
  });
});

describe("P1/P2 — a perfect copy of a production adapter is not a production implementation", () => {
  it("an embedder copied from the real adapter (same descriptor, working embed, production grade) is development", async () => {
    const real = productionProviders();
    const copy = Object.freeze({ ...real.embedder }) as EmbeddingProvider;
    expect(copy.descriptor).toBe(real.embedder.descriptor);
    const set = await retrieve({ embedding: { embedder: copy, modelId: FIXTURE_MODEL.id } });
    expect(set.retrieval.unmet).toEqual(["P1"]);
    expect(() => requireProductionEvidence(set)).toThrow(EvidenceGradeError);
  });

  it("a reranker copied from the real adapter is development", async () => {
    const real = productionProviders();
    const set = await retrieve({ reranker: Object.freeze({ ...real.reranker }) });
    expect(set.retrieval.unmet).toEqual(["P2"]);
  });
});

describe("a check that cannot be decided is not met (fail-closed)", () => {
  it("a throwing check makes its condition false, never true", () => {
    const context = parseRetrievalContext(fixtureContext())!;
    const hostile = new Proxy(context.configuration!.chunkerVersions, { get: () => { throw new Error("uafgørlig"); } });
    const providers = productionProviders();
    const assessment = assessProduction({
      context: { ...context, configuration: { ...context.configuration!, chunkerVersions: hostile } },
      embedding: { embedder: providers.embedder, modelId: FIXTURE_MODEL.id },
      reranker: providers.reranker,
      algorithmVersion: RETRIEVAL_ALGORITHM_VERSION,
      params: { ...DEFAULT_RETRIEVAL_CONFIG },
      query: { text: "x", mode: "current", asOf: "2026-10-05", language: "da", filters: {} },
      items: [evidenceItem(1)],
      devOverride: false,
      schemaVersion: 2,
    });
    expect(assessment.grade).toBe("development");
    expect(assessment.unmet).toContain("P7");
  });
});

describe("P2 — a production reranker, never none", () => {
  it('fails with the "none" reranker', async () => {
    expectOnly(await retrieve({ reranker: createReranker("none", "test") }), "P2");
  });

  it("fails with a reranker that only declares production grade", async () => {
    const fake = { id: "aws-bedrock:cohere.rerank-v3-5:0", version: "euc1-v1", grade: "production" as const, rerank: async () => ({ ranked: [], reranker: { id: "x", version: "1" } }) };
    expectOnly(await retrieve({ reranker: fake }), "P2");
  });

  it("fails when the configuration names another reranker", async () => {
    const material = fixtureMaterial();
    const context = fixtureContext();
    (context.configuration as Record<string, unknown>).rerankerVersion = "other";
    expect(material.reranker.version).not.toBe("other");
    expectOnly(await retrieve({ context }), "P2");
  });
});

describe("P3 — exactly one active configuration with a passed, registered evaluation, not suspended", () => {
  it("fails without a configuration in service", async () => {
    expectOnly(await retrieve({ contextOverrides: { configuration: null } }), "P3");
  });

  it("fails for a suspended configuration — and there is no fallback to another", async () => {
    const set = await retrieve({ contextOverrides: { status: "suspended" } });
    expectOnly(set, "P3");
    // The set still records which configuration served it (reproducibility).
    expect(set.retrieval.configuration?.id).toBe("f6000000-0000-4000-8000-000000000002");
  });

  it("fails when the evaluation has not passed", async () => {
    expectOnly(await retrieve({ contextOverrides: { passed: false } }), "P3");
  });

  it("fails when the database says it is not ready (more than one active, gate set, evaluated scope)", async () => {
    for (const reason of ["active_count", "gate_set", "scope", "evaluation", "development", "model"]) {
      expectOnly(await retrieve({ contextOverrides: { notReady: [reason], productionReady: false } }), "P3");
    }
  });

  it("fails when the context cannot be read (fail-closed)", async () => {
    const set = await runRetrieval({ query: fixtureQuery() }, { ...deps(), db: fixtureDb({ contextError: true }) });
    expect(set.retrieval.grade).toBe("development");
    expect(set.retrieval.unmet).toEqual(expect.arrayContaining(["P1", "P2", "P3", "P4", "P6", "P7", "P9"]));
  });
});

describe("P3 — pilot evaluation policy and approved scope (8B-I6.1, B-030)", () => {
  it("a pilot run passed only on the point estimate is production only after a human accepted the uncertainty", async () => {
    expectOnly(await retrieve({ contextOverrides: { outcome: "pass_with_uncertainty", uncertaintyAccepted: false } }), "P3");
    const accepted = await retrieve({ contextOverrides: { outcome: "pass_with_uncertainty", uncertaintyAccepted: true } });
    expect(accepted.retrieval.grade).toBe("production");
  });

  it("an uncertain standard-tier run is never production — the quality bar is unchanged", async () => {
    expectOnly(await retrieve({ contextOverrides: { tier: "standard", outcome: "insufficient_certainty" } }), "P3");
  });

  it("pilot: a product that was never evaluated does not inherit the approval, even with the same document type", async () => {
    const newProduct = fixtureRow(3, { product_name: "Ny, aldrig evalueret produktfamilie", product_id: "fa000000-0000-4000-8000-000000000009" });
    expectOnly(await retrieve({ rows: [newProduct] }), "P3");
    // One out-of-scope item makes the whole set development (no mixing).
    expectOnly(await retrieve({ rows: [fixtureRow(1), newProduct] }), "P3");
  });

  it("pilot: an evaluated product with a document type that was not evaluated is outside the scope", async () => {
    expectOnly(await retrieve({ rows: [fixtureRow(1, { document_type: "acceptance_rules" })] }), "P3");
  });

  it("pilot: content inside the evaluated scope stays production", async () => {
    const set = await retrieve({ rows: [fixtureRow(1), fixtureRow(2)] });
    expect(set.retrieval.grade).toBe("production");
  });

  it("standard: the approval covers the evaluated document types (§9), across products", async () => {
    const newProduct = fixtureRow(3, { product_name: "Ny produktfamilie", product_id: "fa000000-0000-4000-8000-000000000009" });
    const standard = await retrieve({ rows: [newProduct], contextOverrides: { tier: "standard" } });
    expect(standard.retrieval.grade).toBe("production");
    expectOnly(await retrieve({ rows: [fixtureRow(1, { document_type: "guidance" })], contextOverrides: { tier: "standard" } }), "P3");
  });

  it("an empty or unknown scope covers nothing (fail-closed)", async () => {
    expectOnly(await retrieve({ contextOverrides: { scope: [] } }), "P3");
    // Without a tier (no approved run) no scope covers anything, whatever its entries.
    const item = evidenceItem(1);
    const entries = [{ product: item.product.name, documentType: item.document.type }];
    expect(withinApprovedScope(item, { tier: "pilot", entries, documentTypes: [item.document.type] })).toBe(true);
    expect(withinApprovedScope(item, { tier: null, entries, documentTypes: [item.document.type] })).toBe(false);
  });
});

describe("P4 — the runtime fingerprint is identical to the active configuration's", () => {
  it("fails when the request changes topK (the parameters that ran are not the evaluated ones)", async () => {
    expectOnly(await retrieve({}, { topK: 3 }), "P4");
  });

  it("fails when the parameters differ from the configuration", async () => {
    expectOnly(await retrieve({ config: { ...DEFAULT_RETRIEVAL_CONFIG, minScore: 0.2 } }), "P4");
  });

  it("fails when provider settings changed after the evaluation", async () => {
    const { transport } = fakeBedrock((call) => embedResponse(call.body.texts as string[]));
    const changed = createCohereEmbedV4({ transport, retryDeps: noSleep, egressLog: () => {}, descriptor: { ...EMBED_V4_EU_1024_DESCRIPTOR, settings: { ...EMBED_V4_EU_1024_DESCRIPTOR.settings, truncate: "END" } } });
    expect(isProductionImplementation(changed)).toBe(true);
    expectOnly(await retrieve({ embedding: { embedder: changed, modelId: FIXTURE_MODEL.id } }), "P4");
  });

  it("evaluated as A, running as B: a configuration registered with other material does not match the runtime", async () => {
    const other = fixtureMaterial({ params: { ...DEFAULT_RETRIEVAL_CONFIG, rerankN: 20 } });
    expectOnly(await retrieve({ contextOverrides: { material: other } }), "P4");
  });

  it("refuses a context whose stored fingerprint is not the fingerprint of its material", () => {
    const context = fixtureContext();
    (context.configuration as Record<string, unknown>).fingerprint = "0".repeat(64);
    expect(parseRetrievalContext(context)).toBeNull();
  });
});

describe("P5 — only published, non-withdrawn versions valid for the mode", () => {
  it("fails when a current query returns a historical version", async () => {
    expectOnly(await retrieve({ rows: [fixtureRow(1, { temporal_status: "historical", valid_to: "2026-01-01" })] }), "P5");
  });

  it("fails when a version is not valid on the query's date", async () => {
    expectOnly(await retrieve({ rows: [fixtureRow(1, { valid_from: "2027-01-01", temporal_status: "future" })] }), "P5");
  });

  it("fails when two versions of one document appear in one set", async () => {
    const second = fixtureRow(2, { document_id: fixtureRow(1).document_id, chunk_id: "f7000000-0000-4000-8000-0000000000aa" });
    expectOnly(await retrieve({ rows: [fixtureRow(1), second] }), "P5");
  });

  it("holds for a historical version in as_of mode on a date it was valid", async () => {
    const set = await retrieve({ rows: [fixtureRow(1, { temporal_status: "historical", valid_from: "2024-01-01", valid_to: "2025-01-01" })] }, { mode: "as_of", asOf: "2024-06-01" });
    expect(set.retrieval.unmet).not.toContain("P5");
  });
});

describe("P6 — retrieval ran as the signed-in user", () => {
  it("fails when the database reports the service role", async () => {
    expectOnly(await retrieve({ contextOverrides: { role: "service_role" } }), "P6");
  });

  it("fails without a user", async () => {
    expectOnly(await retrieve({ contextOverrides: { userId: null } }), "P6");
  });
});

describe("P7 — every item's chunker version is evaluated", () => {
  it("fails for an unknown chunker version", async () => {
    expectOnly(await retrieve({ rows: [fixtureRow(1), fixtureRow(2, { chunker_version: "structure/2" })] }), "P7");
  });

  it("fails for a missing chunker version", async () => {
    expectOnly(await retrieve({ rows: [fixtureRow(1, { chunker_version: null })] }), "P7");
  });
});

describe("P8 — not forced by a development tool", () => {
  it("fails for the development tool's forced set", async () => {
    const set = await withRuntimeEnv("test", () => retrieve({ devForceInsufficient: true }));
    expectOnly(set, "P8");
    expect(() => requireProductionEvidence(set)).toThrow(/udviklingsværktøj/);
  });
});

describe("P9 — the set carries the configuration's id, fingerprint and algorithm version", () => {
  it("fails when the configuration's algorithm version is not the code's", async () => {
    const material = fixtureMaterial({ algorithmVersion: "hybrid-rrf-0" });
    const set = await retrieve({ contextOverrides: { material } });
    expectOnly(set, "P9");
  });

  it("fails without a configuration (retrieval.configuration is null)", async () => {
    const set = await retrieve({ contextOverrides: { configuration: null } });
    expect(set.retrieval.configuration).toBeNull();
    expectOnly(set, "P9");
  });
});

describe("adversarial: the grade cannot be claimed, forged or bypassed", () => {
  it("ignores a grade in the request", async () => {
    const request = { query: fixtureQuery(), grade: "production", retrieval: { grade: "production" } } as unknown as RetrievalRequest;
    const set = await runRetrieval(request, deps({ contextOverrides: { configuration: null } }));
    expect(set.retrieval.grade).toBe("development");
  });

  it("refuses a JSON copy, a spread copy and a hand-built set with production fields", async () => {
    const set = await retrieve();
    expect(() => requireProductionEvidence(JSON.parse(JSON.stringify(set)) as EvidenceSet)).toThrow(/ikke udstedt/);
    expect(() => requireProductionEvidence({ ...set })).toThrow(/ikke udstedt/);
    expect(() => requireProductionEvidence({ ...set, retrieval: { ...set.retrieval } })).toThrow(/ikke udstedt/);
  });

  it("refuses to let an issued development set be changed into production", async () => {
    const set = await retrieve({ contextOverrides: { status: "suspended" } });
    expect(() => {
      (set.retrieval as { grade: string }).grade = "production";
    }).toThrow(TypeError);
    expect(() => {
      (set.retrieval as { unmet: string[] }).unmet.length = 0;
    }).toThrow(TypeError);
    expect(() => requireProductionEvidence(set)).toThrow(EvidenceGradeError);
  });

  it("issueEvidenceSet with a forged context still needs real production implementations and matching runtime", () => {
    const fake = { id: "x", version: "1", grade: "production" as const, rerank: async () => ({ ranked: [], reranker: { id: "x", version: "1" } }) };
    const set = issueEvidenceSet({
      query: { text: "x", mode: "current", asOf: "2026-10-05", language: "da", filters: {} },
      embedding: { embedder: { id: "fake", grade: "production", dimensions: 1024, embed: async () => [] }, modelId: FIXTURE_MODEL.id },
      reranker: fake,
      context: parseRetrievalContext(fixtureContext()),
      algorithmVersion: RETRIEVAL_ALGORITHM_VERSION,
      params: { ...DEFAULT_RETRIEVAL_CONFIG },
      candidateCount: 0,
      generatedAt: "2026-10-05T10:00:00Z",
      items: [],
    });
    expect(set.retrieval.grade).toBe("development");
    expect(set.retrieval.unmet).toEqual(expect.arrayContaining(["P1", "P2", "P4"]));
  });

  it("is enforced by the type system (checked by tsc)", async () => {
    const set = await retrieve({ contextOverrides: { configuration: null } });
    // @ts-expect-error — an EvidenceSet is not a ProductionEvidenceSet
    const direct: ProductionEvidenceSet = set;
    // @ts-expect-error — neither is a copy of one
    const copied: ProductionEvidenceSet = { ...set, retrieval: { ...set.retrieval, grade: "production" } };
    expect([direct, copied]).toHaveLength(2);
  });

  it("every condition is listed, in order", () => {
    expect(PRODUCTION_CONDITIONS).toEqual(["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9"]);
  });
});

describe("providers come from the configuration in service only (8B-I6)", () => {
  const runtime = () => ({ bedrock: fakeBedrock(() => ({})).transport });

  it("a configuration in service selects the Bedrock providers; none in service keeps the registry", () => {
    const context = parseRetrievalContext(fixtureContext())!;
    const configured = providersForContext(context, runtime, "production");
    expect(configured.reranker.id).toBe("aws-bedrock:cohere.rerank-v3-5:0");
    expect(configured.embedding?.embedder.id).toBe("aws-bedrock:cohere.embed-v4:0@eu-1024-v1");
    expect(isProductionImplementation(configured.reranker)).toBe(true);
    const none = parseRetrievalContext(fixtureContext({ configuration: null, activeModel: null }))!;
    expect(providersForContext(none, runtime, "test").reranker.id).toBe("none");
    expect(() => providersForContext(none, runtime, "production")).toThrow(/udviklingsimplementering/);
  });

  it("IPA_RERANKER cannot select a production provider, with or without a configuration", () => {
    const saved = process.env.IPA_RERANKER;
    try {
      process.env.IPA_RERANKER = "aws-bedrock:cohere.rerank-v3-5:0";
      const none = parseRetrievalContext(fixtureContext({ configuration: null, activeModel: null }))!;
      expect(() => providersForContext(none, runtime, "test")).toThrow(/ingen implementering/);
    } finally {
      if (saved === undefined) delete process.env.IPA_RERANKER;
      else process.env.IPA_RERANKER = saved;
    }
  });

  it("a suspended configuration keeps its providers: no fallback, development evidence", async () => {
    const context = parseRetrievalContext(fixtureContext({ status: "suspended" }))!;
    expect(providersForContext(context, runtime, "production").reranker.id).toBe("aws-bedrock:cohere.rerank-v3-5:0");
  });
});

describe("static guardrails", () => {
  const SRC = path.resolve(__dirname, "..");
  const ROOT = path.resolve(SRC, "..");
  const files = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === "tests" || entry.name === "node_modules" ? [] : files(full);
      return /\.(ts|tsx|mjs)$/.test(entry.name) ? [full] : [];
    });
  const sources = [...files(SRC), ...files(path.join(ROOT, "workers")), ...files(path.join(ROOT, "evals"))].map((file) => ({
    file: path.relative(ROOT, file).split(path.sep).join("/"),
    text: fs.readFileSync(file, "utf8"),
  }));

  it("only the Bedrock adapters mark production implementations", () => {
    const callers = sources.filter(({ text }) => /markProductionImplementation\(/.test(text)).map(({ file }) => file).sort();
    expect(callers).toEqual([
      "src/lib/knowledge/providers/bedrock/cohere-embed-v4.ts",
      "src/lib/knowledge/providers/bedrock/cohere-rerank-3-5.ts",
    ]);
    // A test may not register a double either: this file only reads the set.
    expect(markProductionImplementation).toBeTypeOf("function");
  });

  it("the grade is never read from an environment variable, a column or a request", () => {
    for (const file of ["src/lib/knowledge/core/production-conditions.ts", "src/lib/knowledge/core/evidence.ts", "src/lib/knowledge/core/retrieval-context.ts"]) {
      const text = sources.find((source) => source.file === file)!.text;
      expect(text, file).not.toMatch(/process\.env/);
    }
    // The registry has no grade column or setting; retrieval_context returns none.
    const registry = fs.readFileSync(path.join(ROOT, "supabase/migrations/20261007000100_retrieval_configuration_registry.sql"), "utf8");
    expect(registry).not.toMatch(/^\s+\w*grade\w*\s+(text|boolean)/im);
    expect(registry.slice(registry.indexOf("function knowledge.retrieval_context()"))).not.toMatch(/'grade'/);
    // The AI gateway's log records the grade AFTER the fact (8A); retrieval never reads it.
    for (const source of sources.filter(({ file }) => file.startsWith("src/lib/knowledge/"))) {
      expect(source.text, source.file).not.toMatch(/evidence_grade|gateway_calls/);
    }
  });

  it("knowledge.retrieval_context is read only by the retrieval layer", () => {
    const readers = sources.filter(({ text }) => /["']retrieval_context["']/.test(text)).map(({ file }) => file);
    expect(readers).toEqual(["src/lib/knowledge/retrieval-core.ts"]);
  });
});
