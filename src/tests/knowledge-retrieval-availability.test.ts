import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { TEST_EMBEDDER } from "@/lib/knowledge/core/test-embedder";
import { createEmbedder, createReranker } from "@/lib/knowledge/core/registry";
import { assessRetrieval } from "@/lib/knowledge/retrieval-availability";
import { runRetrieval, RetrievalError, type KnowledgeRpcClient } from "@/lib/knowledge/retrieval-core";
import { INSUFFICIENT_TITLE, presentRetrieval, UNAVAILABLE_TITLE, type RetrievalOutcome } from "@/lib/knowledge/result-presentation";

/**
 * "Retrieval er utilgængelig" (a system failure) and "Der findes ikke tilstrækkelig
 * dokumentation" (a competent answer) must never be confused (docs/04 §16, docs/07 §20.2).
 */

const SRC = path.resolve(__dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(SRC, file), "utf8");
const testModel = { id: "e0000000-0000-4000-8000-00000000000e", ...TEST_EMBEDDER };
const base = { demo: false, databaseConfigured: true } as const;

describe("retrieval availability is a readable state", () => {
  it("is unavailable in the demo, without a database and when the active model cannot be read", () => {
    expect(assessRetrieval({ ...base, demo: true, activeModel: null }).state).toBe("unavailable");
    expect(assessRetrieval({ ...base, databaseConfigured: false, activeModel: null }).state).toBe("unavailable");
    expect(assessRetrieval({ ...base, activeModel: undefined, environment: "test" }).state).toBe("unavailable");
  });

  it("is unavailable — with the reason — when the registry refuses the reranker or the embedder (fail-closed)", () => {
    const refused = assessRetrieval({ ...base, activeModel: testModel, environment: "production" });
    expect(refused).toMatchObject({ state: "unavailable" });
    expect(refused.state === "unavailable" && refused.reason).toMatch(/udviklingsimplementering/);
    expect(assessRetrieval({ ...base, activeModel: { ...testModel, provider: "someprovider" }, environment: "test" }).state).toBe("unavailable");
    expect(assessRetrieval({ ...base, activeModel: null, rerankerId: "provider-x:model-y", environment: "test" }).state).toBe("unavailable");
  });

  it("is available with the grade of the implementations it would use", () => {
    expect(assessRetrieval({ ...base, activeModel: testModel, environment: "test" })).toEqual({
      state: "available",
      reranker: { id: "none", grade: "development" },
      embeddingModel: { label: "test:test-hash-embedder@1", grade: "development" },
      grade: "development",
    });
    expect(assessRetrieval({ ...base, activeModel: null, environment: "test" })).toMatchObject({ state: "available", embeddingModel: null, grade: "development" });
  });
});

const emptySet = async () =>
  runRetrieval(
    { query: "forurening" },
    { db: { rpc: async () => ({ data: [], error: null }) }, embedding: { embedder: createEmbedder(testModel, "test"), modelId: testModel.id }, reranker: createReranker("none", "test") },
  );

describe("unavailable and insufficient can never be confused (docs/04 §16)", () => {
  it("shows an unavailable retrieval only as a system error", () => {
    expect(presentRetrieval({ kind: "unavailable", message: "x" })).toBe("error");
  });

  it("shows 'insufficient' only for a retrieval that ran and found nothing", async () => {
    const set = await emptySet();
    expect(presentRetrieval({ kind: "evidence", set })).toBe("insufficient");
    const outcomes: RetrievalOutcome[] = [
      { kind: "unavailable", message: "x" },
      { kind: "invalid_request", message: "x" },
      { kind: "denied", message: "x" },
    ];
    for (const outcome of outcomes) expect(presentRetrieval(outcome), outcome.kind).not.toBe("insufficient");
  });

  it("never turns a failing search into an empty result", async () => {
    const failing: KnowledgeRpcClient = { rpc: async () => ({ data: null, error: { code: "XX000", message: "down" } }) };
    await expect(
      runRetrieval({ query: "x" }, { db: failing, embedding: null, reranker: createReranker("none", "test") }),
    ).rejects.toMatchObject({ name: "RetrievalError", code: "unavailable" });
    await expect(runRetrieval({ query: "x" }, { db: failing, embedding: null, reranker: createReranker("none", "test") })).rejects.toBeInstanceOf(RetrievalError);
  });

  it("uses two different titles and two different components", () => {
    expect(UNAVAILABLE_TITLE).not.toBe(INSUFFICIENT_TITLE);
    const error = read("components/states/error-state.tsx");
    const insufficient = read("components/knowledge/insufficient-evidence.tsx");
    expect(error).toMatch(/role=\{variant === "access" \? "status" : "alert"\}/);
    expect(insufficient).not.toMatch(/role="alert"|border-error|text-error/);
  });

  it("wires every result view through presentRetrieval: error → ErrorState, insufficient → InsufficientEvidence", () => {
    const tool = read("app/(platform)/admin/knowledge-base/retrieval/retrieval-tool.tsx");
    expect(tool).toMatch(/presentRetrieval\(outcome\)/);
    expect(tool).toMatch(/case "error":\s*return \(\s*<ErrorState\s+title=\{UNAVAILABLE_TITLE\}/);
    expect(tool).toMatch(/<InsufficientEvidence title=\{INSUFFICIENT_TITLE\}>/);
    expect(read("components/knowledge-admin/retrieval-status.tsx")).toMatch(/<ErrorState title=\{UNAVAILABLE_TITLE\}>/);
  });

  it("checks availability before every retrieval, and turns it into a system error", () => {
    const retrieval = read("lib/knowledge/retrieval.ts");
    const check = retrieval.indexOf("assessRetrieval({ demo: false");
    const run = retrieval.indexOf("return runRetrieval(");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(run);
    expect(retrieval).toMatch(/if \(availability\.state === "unavailable"\) throw new RetrievalError\("unavailable"/);
  });
});
