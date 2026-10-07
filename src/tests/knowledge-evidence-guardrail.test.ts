import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { Embedder } from "@/lib/knowledge/core/embedding";
import {
  EvidenceGradeError,
  issueEvidenceSet,
  requireProductionEvidence,
  type EvidenceSet,
  type IssueEvidenceInput,
  type ProductionEvidenceSet,
} from "@/lib/knowledge/core/evidence";
import { GradeNotAllowedError, runtimeEnv } from "@/lib/knowledge/core/grade";
import { parseRetrievalContext } from "@/lib/knowledge/core/retrieval-context";
import { createEmbedder, createReranker, RerankerNotConfiguredError } from "@/lib/knowledge/core/registry";
import type { Reranker } from "@/lib/knowledge/core/reranker";
import { TEST_EMBEDDER } from "@/lib/knowledge/core/test-embedder";
import { DEFAULT_RETRIEVAL_CONFIG, RETRIEVAL_ALGORITHM_VERSION, runRetrieval, type RetrievalRequest } from "@/lib/knowledge/retrieval-core";
import { checkRetrievalConfiguration } from "@/lib/knowledge/retrieval-startup";

import { FIXTURE_MODEL, fixtureContext, productionProviders } from "./fixtures/production-config";
import { withRuntimeEnv } from "./fixtures/runtime-env";

/**
 * Fase 7 — evidensgrad-guardrailen (docs/07 §9.1, B-18). The most safety-critical rule of
 * phase 7: evidence produced with development implementations (the test embedder, the "none"
 * reranker) can never reach an AI module. Each mechanism has its own tests, so removing any
 * one of them fails this file (mutation-tested).
 */

const SRC = path.resolve(__dirname, "..");

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "tests" ? [] : files(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const sources = files(SRC).map((file) => ({ file: path.relative(SRC, file).split(path.sep).join("/"), text: fs.readFileSync(file, "utf8") }));

const testModel = { id: "e0000000-0000-4000-8000-00000000000e", ...TEST_EMBEDDER };

/** Test doubles standing in for real providers, which do not exist in phase 7. */
function fakeEmbedder(grade: "development" | "production"): Embedder {
  return { id: `fake-embedder-${grade}`, grade, dimensions: 3, embed: async (texts) => texts.map(() => [1, 0, 0]) };
}

function fakeReranker(id: string, grade: "development" | "production"): Reranker {
  return {
    id,
    version: "1",
    grade,
    rerank: async (input) => ({ ranked: input.candidates.map((c, i) => ({ chunkId: c.chunkId, score: 1, rank: i + 1, reasons: [] })), reranker: { id, version: "1" } }),
  };
}

/** Issued with the production-grade fixture context (an active, approved configuration). */
function issue(embedder: Embedder | null, reranker: Reranker): EvidenceSet {
  const input: IssueEvidenceInput = {
    query: { text: "x", mode: "current", asOf: "2026-10-01", language: "da", filters: {} },
    embedding: embedder ? { embedder, modelId: FIXTURE_MODEL.id } : null,
    reranker,
    context: parseRetrievalContext(fixtureContext()),
    algorithmVersion: RETRIEVAL_ALGORITHM_VERSION,
    params: { ...DEFAULT_RETRIEVAL_CONFIG },
    candidateCount: 0,
    generatedAt: "2026-10-01T08:00:00.000Z",
    items: [],
  };
  return issueEvidenceSet(input);
}

const emptyDb = { rpc: async () => ({ data: [], error: null }) };

describe("1. implementations declare their grade — the caller cannot set it", () => {
  it('the "none" reranker and the test embedder are development grade', () => {
    expect(createReranker("none", "test").grade).toBe("development");
    expect(createEmbedder(testModel, "test").grade).toBe("development");
  });

  it("the grade of a constructed implementation cannot be changed", () => {
    const reranker = createReranker("none", "test");
    const embedder = createEmbedder(testModel, "test");
    expect(() => {
      (reranker as { grade: string }).grade = "production";
    }).toThrow(TypeError);
    expect(() => {
      (embedder as { grade: string }).grade = "production";
    }).toThrow(TypeError);
    expect(reranker.grade).toBe("development");
    expect(embedder.grade).toBe("development");
  });
});

describe("2. the registry is fail-closed", () => {
  it("treats a missing or unknown IPA_RUNTIME_ENV as production", () => {
    expect(withRuntimeEnv(undefined, () => runtimeEnv())).toBe("production");
    expect(runtimeEnv("production")).toBe("production");
    expect(runtimeEnv("staging")).toBe("production");
  });

  it('refuses to construct "none" and the test embedder outside local/test', () => {
    for (const environment of ["production"] as const) {
      expect(() => createReranker("none", environment)).toThrow(GradeNotAllowedError);
      expect(() => createEmbedder(testModel, environment)).toThrow(GradeNotAllowedError);
    }
    expect(() => createReranker("none", withRuntimeEnv(undefined, () => runtimeEnv()))).toThrow(GradeNotAllowedError);
    expect(createReranker("none", "local").id).toBe("none");
    expect(createReranker("none", "test").id).toBe("none");
  });

  it("uses IPA_RUNTIME_ENV and IPA_RERANKER from the environment by default", () => {
    const saved = { env: process.env.IPA_RUNTIME_ENV, reranker: process.env.IPA_RERANKER };
    try {
      delete process.env.IPA_RUNTIME_ENV;
      delete process.env.IPA_RERANKER;
      expect(() => createReranker()).toThrow(GradeNotAllowedError);
      process.env.IPA_RUNTIME_ENV = "test";
      expect(createReranker().id).toBe("none");
      process.env.IPA_RERANKER = "provider-x:model-y";
      expect(() => createReranker()).toThrow(RerankerNotConfiguredError);
    } finally {
      if (saved.env === undefined) delete process.env.IPA_RUNTIME_ENV;
      else process.env.IPA_RUNTIME_ENV = saved.env;
      if (saved.reranker === undefined) delete process.env.IPA_RERANKER;
      else process.env.IPA_RERANKER = saved.reranker;
    }
  });

  it("reports the refusal when the server starts, with a database connected", () => {
    const saved = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, env: process.env.IPA_RUNTIME_ENV };
    const messages: string[] = [];
    try {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
      delete process.env.IPA_RUNTIME_ENV;
      expect(checkRetrievalConfiguration((message) => messages.push(message))).toMatchObject({ state: "unavailable" });
      expect(messages.join("\n")).toMatch(/Retrieval er utilgængelig/);
      process.env.IPA_RUNTIME_ENV = "local";
      expect(checkRetrievalConfiguration((message) => messages.push(message))).toMatchObject({ state: "available" });
    } finally {
      for (const [key, value] of [["NEXT_PUBLIC_SUPABASE_URL", saved.url], ["NEXT_PUBLIC_SUPABASE_ANON_KEY", saved.key], ["IPA_RUNTIME_ENV", saved.env]] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

describe("3. the EvidenceSet carries a grade computed from the implementations actually used", () => {
  it("is development with the test embedder and the none reranker", async () => {
    const set = await runRetrieval({ query: "forurening" }, { db: emptyDb, embedding: { embedder: createEmbedder(testModel, "test"), modelId: testModel.id }, reranker: createReranker("none", "test") });
    expect(set.retrieval.grade).toBe("development");
  });

  it("is production only when BOTH the embedder and the reranker are production implementations (P1, P2)", () => {
    const real = productionProviders();
    expect(issue(real.embedder, real.reranker).retrieval.grade).toBe("production");
    expect(issue(fakeEmbedder("development"), real.reranker).retrieval.grade).toBe("development");
    expect(issue(real.embedder, fakeReranker("provider-x", "development")).retrieval.grade).toBe("development");
    expect(issue(null, real.reranker).retrieval.grade).toBe("development");
  });

  it("a test double that only DECLARES production grade is development (8B-I6)", () => {
    const set = issue(fakeEmbedder("production"), fakeReranker("provider-x", "production"));
    expect(set.retrieval.grade).toBe("development");
    expect(set.retrieval.unmet).toEqual(expect.arrayContaining(["P1", "P2", "P4"]));
  });

  it("cannot be set through the request", async () => {
    const request = { query: "forurening", grade: "production", retrieval: { grade: "production" } } as unknown as RetrievalRequest;
    const set = await runRetrieval(request, { db: emptyDb, embedding: { embedder: createEmbedder(testModel, "test"), modelId: testModel.id }, reranker: createReranker("none", "test") });
    expect(set.retrieval.grade).toBe("development");
  });

  it("cannot be changed after the set is issued", () => {
    const set = issue(fakeEmbedder("production"), fakeReranker("provider-x", "development"));
    expect(() => {
      (set.retrieval as { grade: string }).grade = "production";
    }).toThrow(TypeError);
    expect(set.retrieval.grade).toBe("development");
    expect(() => requireProductionEvidence(set)).toThrow(EvidenceGradeError);
  });
});

describe("4. requireProductionEvidence is the only way to a ProductionEvidenceSet", () => {
  it("throws for development-grade evidence", () => {
    // A reranker that is not "none" but is development grade: only the grade check stops it.
    expect(() => requireProductionEvidence(issue(fakeEmbedder("production"), fakeReranker("provider-x", "development")))).toThrow(/evidensgraden er "development"/);
  });

  it('throws for the "none" reranker, even if it claims to be production', () => {
    const real = productionProviders();
    const set = issue(real.embedder, fakeReranker("none", "production"));
    expect(set.retrieval.unmet).toContain("P2");
    expect(() => requireProductionEvidence(set)).toThrow(EvidenceGradeError);
  });

  it("throws for the real phase 7 pipeline output", async () => {
    const set = await runRetrieval({ query: "forurening" }, { db: emptyDb, embedding: { embedder: createEmbedder(testModel, "test"), modelId: testModel.id }, reranker: createReranker("none", "test") });
    expect(() => requireProductionEvidence(set)).toThrow(EvidenceGradeError);
  });

  it("throws for evidence the retrieval layer did not issue — a hand-built object or a copy", () => {
    const real = productionProviders();
    const issued = issue(real.embedder, real.reranker);
    const forged = JSON.parse(JSON.stringify(issued)) as EvidenceSet;
    expect(forged.retrieval.grade).toBe("production");
    expect(() => requireProductionEvidence(forged)).toThrow(/ikke udstedt/);
    expect(() => requireProductionEvidence({ ...issued })).toThrow(/ikke udstedt/);
  });

  it("accepts evidence issued with production implementations under an active configuration (the path a later AI phase takes)", () => {
    const real = productionProviders();
    const set = issue(real.embedder, real.reranker);
    const production: ProductionEvidenceSet = requireProductionEvidence(set);
    expect(production).toBe(set);
  });

  it("is enforced by the type system (checked by tsc)", () => {
    const set = issue(fakeEmbedder("development"), createReranker("none", "test"));
    // @ts-expect-error — an EvidenceSet is not a ProductionEvidenceSet
    const direct: ProductionEvidenceSet = set;
    // @ts-expect-error — neither is a copy of one
    const copied: ProductionEvidenceSet = { ...set };
    // @ts-expect-error — the grade is not an input; it is derived from the implementations
    const claimed: IssueEvidenceInput = { query: set.query, embedding: null, reranker: createReranker("none", "test"), context: null, algorithmVersion: "", params: { ...DEFAULT_RETRIEVAL_CONFIG }, candidateCount: 0, generatedAt: "", items: [], grade: "production" };
    expect([direct, copied, claimed]).toHaveLength(3);
  });
});

describe("static guardrails — the mechanisms cannot be bypassed elsewhere in the code", () => {
  it("only evidence.ts asserts the ProductionEvidenceSet type", () => {
    const offenders = sources.filter(({ text }) => /as\s+ProductionEvidenceSet|productionEvidence\]/.test(text)).map(({ file }) => file);
    expect(offenders).toEqual(["lib/knowledge/core/evidence.ts"]);
  });

  it("only the retrieval pipeline issues evidence sets", () => {
    const offenders = sources.filter(({ text }) => /\bissueEvidenceSet\b/.test(text)).map(({ file }) => file).sort();
    expect(offenders).toEqual(["lib/knowledge/core/evidence.ts", "lib/knowledge/retrieval-core.ts"]);
  });

  it('only the registry constructs the "none" reranker and the test embedder', () => {
    const offenders = sources
      .filter(({ text }) => /\bcreate(NoneReranker|TestEmbedder)\(/.test(text))
      .map(({ file }) => file)
      .filter((file) => !["lib/knowledge/core/registry.ts", "lib/knowledge/core/reranker.ts", "lib/knowledge/core/test-embedder.ts"].includes(file));
    expect(offenders).toEqual([]);
  });

  it("application code runs the pipeline only through retrieveEvidence, which takes no implementations", () => {
    const callers = sources.filter(({ text }) => /\brunRetrieval\b/.test(text)).map(({ file }) => file).sort();
    expect(callers).toEqual(["lib/knowledge/retrieval-core.ts", "lib/knowledge/retrieval.ts"]);
    const retrieval = sources.find(({ file }) => file === "lib/knowledge/retrieval.ts")!.text;
    expect(retrieval).toMatch(/^import "server-only";/);
    // 8B-I2.5: the application entry takes a query WITH provenance (ClassifiedRetrievalRequest).
    expect(retrieval).toMatch(/export async function retrieveEvidence\(request: ClassifiedRetrievalRequest, dev: RetrievalDevOptions = \{\}\)/);
    expect(retrieval).not.toMatch(/retrieveEvidence\([^)]*(reranker|embedder|grade)/);
  });

  it("retrieval code is never imported by client components", () => {
    const offenders = sources
      .filter(({ text }) => /^["']use client["']/m.test(text))
      .filter(({ text }) => /from ["'][^"']*lib\/knowledge\/(retrieval|core\/(registry|evidence|reranker))/.test(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
