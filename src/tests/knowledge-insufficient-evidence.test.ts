import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { forceInsufficientAllowed } from "@/dev/knowledge/force-insufficient";
import { requireProductionEvidence } from "@/lib/knowledge/core/evidence";
import { runtimeEnv } from "@/lib/knowledge/core/grade";

import { createReranker } from "@/lib/knowledge/core/registry";
import type { Reranker } from "@/lib/knowledge/core/reranker";
import { DEFAULT_RETRIEVAL_CONFIG, runRetrieval, type KnowledgeRpcClient, type SearchRow } from "@/lib/knowledge/retrieval-core";
import { INSUFFICIENT_TITLE, presentRetrieval } from "@/lib/knowledge/result-presentation";

/**
 * The most important path of the Knowledge Engine: when there is no adequate documentation,
 * the result is "Der findes ikke tilstrækkelig dokumentation" — and nothing with weak grounding
 * gets through (docs/04 §16, KRAV-AI-004, docs/07 §20.4).
 *
 * With the test embedder the vector search always returns nearest neighbours, so this path
 * would rarely be reached through it. These tests force it deterministically WITHOUT any
 * embedder: the database is stubbed, and the reranker is a stub with known scores.
 */

const MIN = DEFAULT_RETRIEVAL_CONFIG.minScore;

function candidate(id: string, text: string): SearchRow {
  return {
    chunk_id: id,
    chunk_index: 0,
    kind: "prose",
    text,
    lead_in: null,
    heading: "§ 1",
    heading_path: ["§ 1"],
    section_number: "1",
    page_start: 1,
    page_end: 1,
    char_start: 0,
    char_end: text.length,
    overlap_chars: 0,
    version_id: `v-${id}`,
    version_label: "1",
    language: "da",
    valid_from: "2025-01-01",
    valid_to: null,
    approved_at: "2026-09-01T10:00:00Z",
    superseded_by: null,
    document_id: `d-${id}`,
    document_title: `Svagt dokument ${id}`,
    document_type: "terms",
    product_id: "p",
    product_name: "Testprodukt (fiktiv)",
    source_type: "manual_upload",
    temporal_status: "current",
    vector_rank: null,
    vector_score: null,
    lexical_rank: 1,
    lexical_score: 0.01,
    lexical_terms: [],
  };
}

function db(rows: SearchRow[]): KnowledgeRpcClient {
  return {
    async rpc(fn) {
      if (fn === "search_chunks") return { data: rows, error: null };
      if (fn === "evidence_conflicts") return { data: [], error: null };
      return { data: [], error: null };
    },
  };
}

/** A reranker with fixed scores per chunk — standing in for a real reranker's judgement. */
function scoringReranker(scores: Record<string, number>): Reranker {
  return {
    id: "stub-scores",
    version: "1",
    grade: "development",
    async rerank(input) {
      const ranked = input.candidates
        .map((entry) => ({ chunkId: entry.chunkId, score: scores[entry.chunkId] ?? 0, reasons: [] }))
        .sort((a, b) => b.score - a.score)
        .map((entry, i) => ({ ...entry, rank: i + 1 }));
      return { ranked, reranker: { id: "stub-scores", version: "1" } };
    },
  };
}

const run = (rows: SearchRow[], reranker: Reranker) => runRetrieval({ query: "dækning af droner" }, { db: db(rows), embedding: null, reranker });

describe('"Der findes ikke tilstrækkelig dokumentation" — forced deterministically, without an embedder', () => {
  it("is the result when retrieval finds no candidates", async () => {
    const set = await run([], createReranker("none", "test"));
    expect(set.items).toEqual([]);
    expect(set.signals).toEqual({ itemCount: 0, topScore: null, hasConflicts: false, hasHistorical: false });
    expect(presentRetrieval({ kind: "evidence", set })).toBe("insufficient");
    expect(INSUFFICIENT_TITLE).toBe("Der findes ikke tilstrækkelig dokumentation");
  });

  it("is the result when every candidate scores below the threshold — and nothing weak gets through", async () => {
    const rows = [candidate("a", "Svag passage om noget andet."), candidate("b", "Endnu en svag passage.")];
    const set = await run(rows, scoringReranker({ a: MIN - 0.01, b: MIN / 2 }));
    expect(set.retrieval.candidateCount).toBe(2);
    expect(set.items).toEqual([]);
    expect(presentRetrieval({ kind: "evidence", set })).toBe("insufficient");
    const serialized = JSON.stringify(set);
    for (const leaked of ["Svag passage", "Endnu en svag", "Svagt dokument", "v-a", "d-b"]) expect(serialized).not.toContain(leaked);
  });

  it("lets only candidates at or above the threshold become evidence", async () => {
    const rows = [candidate("strong", "Stærk passage."), candidate("edge", "Passage på grænsen."), candidate("weak", "Svag passage.")];
    const set = await run(rows, scoringReranker({ strong: 0.9, edge: MIN, weak: MIN - 0.001 }));
    expect(set.items.map((item) => item.chunkId)).toEqual(["strong", "edge"]);
    expect(presentRetrieval({ kind: "evidence", set })).toBe("evidence");
    expect(JSON.stringify(set)).not.toContain("Svag passage");
  });

  it('makes the limitation of the "none" reranker explicit: any candidate scores 1, so the threshold never empties the result', async () => {
    // docs/07 §20.4: with "none" (and the test embedder) "insufficient" only occurs when there are
    // no candidates at all. The threshold only works with a real reranker; the numbers are not validated.
    const set = await run([candidate("only", "Irrelevant passage.")], createReranker("none", "test"));
    expect(set.items.map((item) => item.relevance.score)).toEqual([1]);
    expect(presentRetrieval({ kind: "evidence", set })).toBe("evidence");
  });
});

describe("development tool: force 'insufficient' (B-009) — never a production setting", () => {
  const withEnv = async <T>(value: string | undefined, fn: () => Promise<T>) => {
    const saved = process.env.IPA_RUNTIME_ENV;
    if (value === undefined) delete process.env.IPA_RUNTIME_ENV;
    else process.env.IPA_RUNTIME_ENV = value;
    try {
      return await fn();
    } finally {
      if (saved === undefined) delete process.env.IPA_RUNTIME_ENV;
      else process.env.IPA_RUNTIME_ENV = saved;
    }
  };

  it("forces the state in local/test without running retrieval and without touching scoring", async () => {
    const calls: string[] = [];
    const spy: KnowledgeRpcClient = { rpc: async (fn) => (calls.push(fn), { data: [candidate("a", "Stærk passage.")], error: null }) };
    const set = await withEnv("test", () =>
      runRetrieval({ query: "dækning af droner" }, { db: spy, embedding: null, reranker: createReranker("none", "test"), devForceInsufficient: true }),
    );
    expect(calls).toEqual([]);
    expect(set.items).toEqual([]);
    expect(set.retrieval).toMatchObject({ devOverride: "force_insufficient", grade: "development", candidateCount: 0 });
    expect(presentRetrieval({ kind: "evidence", set })).toBe("insufficient");
    expect(() => requireProductionEvidence(set)).toThrow(/udviklingsværktøj/);
  });

  it("is refused when IPA_RUNTIME_ENV is missing, unknown or production (fail-closed)", async () => {
    for (const value of [undefined, "production", "staging"]) {
      expect(forceInsufficientAllowed(runtimeEnv(value)), String(value)).toBe(false);
      await expect(
        withEnv(value, () => runRetrieval({ query: "x" }, { db: db([]), embedding: null, reranker: createReranker("none", "test"), devForceInsufficient: true })),
      ).rejects.toMatchObject({ code: "invalid_request" });
    }
    expect(forceInsufficientAllowed("local")).toBe(true);
    expect(forceInsufficientAllowed("test")).toBe(true);
  });

  it("is marked as a development tool and used only by the Admin tool's path — not configuration", () => {
    const SRC = path.resolve(__dirname, "..");
    const tool = fs.readFileSync(path.join(SRC, "dev/knowledge/force-insufficient.ts"), "utf8");
    expect(tool).toMatch(/DEVELOPMENT TOOL — NOT A SETTING/);
    const files = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? (entry.name === "tests" ? [] : files(path.join(dir, entry.name))) : /\.tsx?$/.test(entry.name) ? [path.join(dir, entry.name)] : [],
      );
    const users = files(SRC)
      .filter((file) => /devForceInsufficient/.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(SRC, file).split(path.sep).join("/"))
      .sort();
    expect(users).toEqual([
      "app/(platform)/admin/knowledge-base/retrieval/retrieval-tool.tsx",
      // Phase 8: the same per-call development tool in Copilot's development tools (docs/08 §13).
      "lib/ai/core/gateway-core.ts",
      "lib/knowledge/admin-actions.ts",
      "lib/knowledge/retrieval-core.ts",
      "lib/knowledge/retrieval.ts",
    ]);
    // Not read from the environment: no IPA_* variable can switch it on.
    for (const file of users) expect(fs.readFileSync(path.join(SRC, file), "utf8")).not.toMatch(/process\.env\.[A-Z_]*FORCE/);
  });
});
