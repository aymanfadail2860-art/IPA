import { describe, expect, it } from "vitest";

import { knowledgeText, unknownText } from "@/lib/egress/classification";

import { DEFAULT_RRF_K, fuse, fusedScore } from "@/lib/knowledge/core/fusion";
import { createEmbedder, createReranker } from "@/lib/knowledge/core/registry";
import { mergeExcerpt, selectChunks, type SelectableChunk } from "@/lib/knowledge/core/selection";
import { RESTRICTED_CONFLICT_MESSAGE, sourceReferenceLabel } from "@/lib/knowledge/core/evidence";
import { TEST_EMBEDDER } from "@/lib/knowledge/core/test-embedder";
import {
  DEFAULT_RETRIEVAL_CONFIG,
  MAX_QUERY_CHARS,
  normalizeRequest,
  runRetrieval,
  type ConflictRow,
  type KnowledgeRpcClient,
  type RetrievalRequest,
  type SearchRow,
} from "@/lib/knowledge/retrieval-core";

import { chunkDocument, DEFAULT_CHUNKER_CONFIG } from "../../workers/ingestion/chunker.ts";
import { extractPdf } from "../../workers/ingestion/extract.ts";
import { normalizePages } from "../../workers/ingestion/normalize.ts";
import { structurePages } from "../../workers/ingestion/structure.ts";
import { buildPdf, longListFixturePages, longSectionFixturePages } from "./fixtures/knowledge-pdfs";

/** Fase 7, trin 6 — RRF, reranker "none", evidensudvælgelse og evidensformat (docs/07 §8–10). */

const VERSION_A = "a0000000-0000-4000-8000-00000000000a";
const VERSION_B = "b0000000-0000-4000-8000-00000000000b";
const PRODUCT = "c0000000-0000-4000-8000-00000000000c";

function row(overrides: Partial<SearchRow> & Pick<SearchRow, "chunk_id">): SearchRow {
  return {
    chunk_index: 0,
    kind: "prose",
    text: "Forsikringen dækker ikke skade som følge af gradvis forurening.",
    lead_in: null,
    heading: "4.1 Forurening",
    heading_path: ["§ 4 Undtagelser", "4.1 Forurening"],
    section_number: "4.1",
    page_start: 3,
    page_end: 3,
    char_start: 0,
    char_end: 64,
    overlap_chars: 0,
    version_id: VERSION_A,
    version_label: "2",
    language: "da",
    valid_from: "2025-01-01",
    valid_to: null,
    approved_at: "2026-09-01T10:00:00Z",
    superseded_by: null,
    document_id: "d0000000-0000-4000-8000-00000000000d",
    document_title: "Testbetingelser Ansvar (fiktiv)",
    document_type: "terms",
    product_id: PRODUCT,
    product_name: "Testprodukt Ansvar (fiktiv)",
    source_type: "manual_upload",
    temporal_status: "current",
    vector_rank: null,
    vector_score: null,
    lexical_rank: null,
    lexical_score: null,
    lexical_terms: [],
    chunker_version: "structure/1",
    ...overrides,
  };
}

interface FakeDbOptions {
  error?: { code?: string; message: string } | null;
  /** Rows of knowledge.evidence_conflicts per queried chunk id. */
  conflicts?: ConflictRow[];
  /** Rows knowledge.evidence_chunks can return (filtered by the requested ids). */
  chunkRows?: SearchRow[];
  /** Rows of a search restricted to one document (version-level counterparts). */
  documentRows?: Record<string, SearchRow[]>;
}

function fakeDb(rows: SearchRow[], options: FakeDbOptions | { code?: string; message: string } | null = null) {
  const opts: FakeDbOptions = options && "message" in options ? { error: options } : (options ?? {});
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const db: KnowledgeRpcClient = {
    async rpc(fn, args) {
      calls.push({ fn, args });
      if (opts.error) return { data: null, error: opts.error };
      if (fn === "search_chunks") {
        const documents = args.p_document_ids as string[] | null;
        const scoped = documents?.length === 1 && opts.documentRows?.[documents[0]!];
        return { data: scoped || rows, error: null };
      }
      if (fn === "evidence_conflicts") {
        const ids = args.p_chunk_ids as string[];
        return { data: (opts.conflicts ?? []).filter((row) => ids.includes(row.chunk_id)), error: null };
      }
      if (fn === "evidence_chunks") {
        const chunkIds = args.p_chunk_ids as string[];
        const versionIds = args.p_version_ids as string[];
        const data = (opts.chunkRows ?? []).filter((row) => chunkIds.includes(row.chunk_id) || (versionIds.includes(row.version_id) && row.chunk_index === 0));
        return { data, error: null };
      }
      return { data: null, error: { code: "42883", message: `unknown function ${fn}` } };
    },
  };
  return { db, calls };
}

const testModel = { id: "e0000000-0000-4000-8000-00000000000e", ...TEST_EMBEDDER };

function deps(db: KnowledgeRpcClient) {
  return {
    db,
    embedding: { embedder: createEmbedder(testModel, "test"), modelId: testModel.id },
    reranker: createReranker("none", "test"),
    now: () => new Date("2026-10-01T08:00:00Z"),
  };
}

describe("Reciprocal Rank Fusion (docs/07 §8.1)", () => {
  it("sums 1/(k + rank) over the retrievers that found the chunk", () => {
    expect(fusedScore({ vectorRank: 1, lexicalRank: null })).toBeCloseTo(1 / (DEFAULT_RRF_K + 1));
    expect(fusedScore({ vectorRank: 1, lexicalRank: 3 })).toBeCloseTo(1 / 61 + 1 / 63);
    expect(fusedScore({ vectorRank: null, lexicalRank: null })).toBe(0);
  });

  it("ranks a chunk found by both retrievers above one found by either alone, deterministically", () => {
    const fused = fuse([
      { chunkId: "c", vectorRank: 1, lexicalRank: null },
      { chunkId: "b", vectorRank: 2, lexicalRank: 2 },
      { chunkId: "a", vectorRank: null, lexicalRank: 1 },
    ]);
    expect(fused.map((candidate) => candidate.chunkId)).toEqual(["b", "a", "c"]);
    expect(fused.map((candidate) => candidate.fusedRank)).toEqual([1, 2, 3]);
  });
});

describe('reranker "none" (docs/07 §9)', () => {
  it("keeps the fusion order, normalizes scores to [0,1] and returns at most topN", async () => {
    const reranker = createReranker("none", "test");
    const output = await reranker.rerank({
      query: unknownText("x"),
      topN: 2,
      candidates: [
        { chunkId: "low", document: knowledgeText(""), retrieval: { fusedScore: 0.01 } },
        { chunkId: "top", document: knowledgeText(""), retrieval: { fusedScore: 0.03 } },
        { chunkId: "mid", document: knowledgeText(""), retrieval: { fusedScore: 0.02 } },
      ],
    });
    expect(output.reranker).toEqual({ id: "none", version: "1" });
    expect(output.ranked.map((entry) => [entry.chunkId, entry.rank])).toEqual([["top", 1], ["mid", 2]]);
    expect(output.ranked[0]!.score).toBe(1);
    expect(output.ranked[1]!.score).toBeCloseTo(2 / 3);
    expect(output.ranked[0]!.reasons).toEqual([{ kind: "fused_rank", rank: 1 }]);
  });
});

function selectable(chunkId: string, overrides: Partial<SelectableChunk>): SelectableChunk {
  return { chunkId, versionId: VERSION_A, chunkIndex: 0, headingPath: ["§ 4"], score: 0.5, rank: 1, text: "x", charStart: 0, charEnd: 1, ...overrides };
}

describe("evidence selection (docs/07 §8.3)", () => {
  it("drops chunks below the minimum score and caps the number per version", () => {
    const ranked = [
      selectable("a1", { chunkIndex: 0, score: 1, rank: 1, charStart: 0, charEnd: 10 }),
      selectable("a2", { chunkIndex: 5, score: 0.9, rank: 2, charStart: 50, charEnd: 60 }),
      selectable("a3", { chunkIndex: 9, score: 0.8, rank: 3, charStart: 90, charEnd: 100 }),
      selectable("b1", { versionId: VERSION_B, score: 0.7, rank: 4 }),
      selectable("b2", { versionId: VERSION_B, chunkIndex: 3, score: 0.05, rank: 5 }),
    ];
    const groups = selectChunks(ranked, { topK: 8, maxPerVersion: 2, minScore: 0.1 });
    expect(groups.map((group) => group.map((chunk) => chunk.chunkId))).toEqual([["a1"], ["a2"], ["b1"]]);
  });

  it("returns at most topK chunks", () => {
    const ranked = Array.from({ length: 10 }, (_, i) => selectable(`c${i}`, { versionId: `v${i}`, score: 1 - i / 20, rank: i + 1 }));
    expect(selectChunks(ranked, { topK: 3, maxPerVersion: 3, minScore: 0 }).flat()).toHaveLength(3);
  });

  it("merges selected neighbours of the same section into one item — not across sections or gaps", () => {
    const ranked = [
      selectable("n1", { chunkIndex: 4, score: 0.9, rank: 2, text: "Første del.", charStart: 0, charEnd: 11 }),
      selectable("n2", { chunkIndex: 5, score: 1, rank: 1, text: "Anden del.", charStart: 13, charEnd: 23 }),
      selectable("other", { chunkIndex: 6, score: 0.8, rank: 3, headingPath: ["§ 5"], text: "Ny sektion.", charStart: 25, charEnd: 36 }),
      selectable("far", { chunkIndex: 8, score: 0.7, rank: 4, charStart: 60, charEnd: 70 }),
    ];
    const groups = selectChunks(ranked, { topK: 8, maxPerVersion: 8, minScore: 0 });
    expect(groups.map((group) => group.map((chunk) => chunk.chunkId))).toEqual([["n1", "n2"], ["other"], ["far"]]);
  });

  it("rebuilds the exact source text when merging overlapping or adjacent chunks of the real chunker", async () => {
    for (const fixture of [longSectionFixturePages(), longListFixturePages()]) {
      const document = structurePages(normalizePages(await extractPdf(await buildPdf(fixture))).pages);
      const chunks = chunkDocument(document, { ...DEFAULT_CHUNKER_CONFIG, targetChars: 400, maxChars: 800 });
      let checked = 0;
      for (let i = 1; i < chunks.length; i += 1) {
        const [a, b] = [chunks[i - 1]!, chunks[i]!];
        if (a.headingPath.join("/") !== b.headingPath.join("/")) continue;
        expect(mergeExcerpt([a, b])).toBe(document.text.slice(a.charStart, b.charEnd));
        checked += 1;
      }
      expect(checked).toBeGreaterThan(0);
    }
  });

  it("refuses to merge when the text between two chunks is unknown", () => {
    expect(mergeExcerpt([{ text: "a", charStart: 0, charEnd: 1 }, { text: "b", charStart: 10, charEnd: 11 }])).toBeNull();
  });
});

describe("request validation (docs/07 §8.2)", () => {
  it("requires a query of limited length", () => {
    expect(() => normalizeRequest({ query: "  " })).toThrow(/Skriv en forespørgsel/);
    expect(() => normalizeRequest({ query: "x".repeat(MAX_QUERY_CHARS + 1) })).toThrow(/højst/);
  });

  it("requires a valid date for as_of and valid filters", () => {
    expect(() => normalizeRequest({ query: "x", mode: "as_of" })).toThrow(/dato/);
    expect(() => normalizeRequest({ query: "x", mode: "as_of", asOf: "2026-02-30" })).toThrow(/dato/);
    expect(() => normalizeRequest({ query: "x", productIds: ["not-a-uuid"] })).toThrow(/produkt/);
    expect(() => normalizeRequest({ query: "x", documentTypes: ["invented_type"] })).toThrow(/dokumenttype/);
    expect(() => normalizeRequest({ query: "x", mode: "historical" as never })).toThrow(/tilstand/);
  });

  it("clamps topK", () => {
    expect(normalizeRequest({ query: "x", topK: 500 }).topK).toBe(20);
    expect(normalizeRequest({ query: "x", topK: 0 }).topK).toBe(1);
    expect(normalizeRequest({ query: "x" }).topK).toBe(DEFAULT_RETRIEVAL_CONFIG.topK);
  });
});

describe("retrieval pipeline and the evidence model (docs/07 §8, §10)", () => {
  it("sends the query, its embedding with the active model and the filters to the database function", async () => {
    const { db, calls } = fakeDb([]);
    await runRetrieval(
      { query: " gradvis forurening ", mode: "as_of", asOf: "2024-06-01", productIds: [PRODUCT], documentTypes: ["terms"] },
      deps(db),
    );
    // The search, then the retrieval context read with the same client (8B-I6, P1–P9).
    expect(calls.map((call) => call.fn)).toEqual(["search_chunks", "retrieval_context"]);
    const { fn, args } = calls[0]!;
    expect(fn).toBe("search_chunks");
    expect(args).toMatchObject({
      p_query: "gradvis forurening",
      p_model_id: testModel.id,
      p_mode: "as_of",
      p_as_of: "2024-06-01",
      p_language: "da",
      p_product_ids: [PRODUCT],
      p_document_ids: null,
      p_document_types: ["terms"],
      p_candidate_k: DEFAULT_RETRIEVAL_CONFIG.candidateK,
    });
    expect(String(args.p_query_embedding).split(",")).toHaveLength(TEST_EMBEDDER.dimensions);
  });

  it("runs lexical only when no embedding model is active", async () => {
    const { db, calls } = fakeDb([]);
    const set = await runRetrieval({ query: "forurening" }, { ...deps(db), embedding: null });
    expect(calls[0]!.args).toMatchObject({ p_query_embedding: null, p_model_id: null });
    expect(set.retrieval.embeddingModel).toBeNull();
    expect(set.retrieval.grade).toBe("development");
  });

  it("builds evidence in the specified format — with the lead-in as separate context (B-005)", async () => {
    const { db } = fakeDb([
      row({ chunk_id: "11111111-0000-4000-8000-000000000001", vector_rank: 2, vector_score: 0.41, lexical_rank: 1, lexical_score: 0.8, lexical_terms: ["forurening", "gradvis"] }),
      row({
        chunk_id: "11111111-0000-4000-8000-000000000002",
        chunk_index: 7,
        kind: "list",
        text: "• fiktiv undtagelse 7",
        lead_in: "Forsikringen dækker heller ikke:",
        heading: "§ 6 Øvrige undtagelser",
        heading_path: ["§ 6 Øvrige undtagelser"],
        section_number: "6",
        page_start: 5,
        page_end: 6,
        char_start: 900,
        char_end: 921,
        vector_rank: 1,
        vector_score: 0.5,
      }),
    ]);
    const set = await runRetrieval({ query: "gradvis forurening" }, deps(db));

    expect(set.schemaVersion).toBe(2);
    expect(set.query).toEqual({ text: "gradvis forurening", mode: "current", asOf: "2026-10-01", language: "da", filters: {} });
    expect(set.retrieval).toEqual({
      grade: "development",
      embeddingModel: { id: "test:test-hash-embedder@1", grade: "development" },
      reranker: { id: "none", version: "1", grade: "development" },
      // No configuration in service (the fake database has none): P1–P9 cannot be established.
      configuration: null,
      unmet: ["P1", "P2", "P3", "P4", "P6", "P7", "P9"],
      candidateCount: 2,
      generatedAt: "2026-10-01T08:00:00.000Z",
    });
    expect(set.items.map((item) => item.evidenceId)).toEqual(["e1", "e2"]);

    const [first, second] = set.items;
    expect(first).toMatchObject({
      chunkId: "11111111-0000-4000-8000-000000000001",
      chunkIds: ["11111111-0000-4000-8000-000000000001"],
      chunkerVersion: "structure/1",
      documentVersionId: VERSION_A,
      product: { id: PRODUCT, name: "Testprodukt Ansvar (fiktiv)" },
      document: { title: "Testbetingelser Ansvar (fiktiv)", type: "terms", versionLabel: "2", language: "da" },
      location: { pageStart: 3, pageEnd: 3, sectionNumber: "4.1", heading: "4.1 Forurening", headingPath: ["§ 4 Undtagelser", "4.1 Forurening"] },
      excerpt: { text: "Forsikringen dækker ikke skade som følge af gradvis forurening.", leadIn: null },
      validity: { validFrom: "2025-01-01", validTo: null, temporalStatus: "current" },
      authority: { status: "published", authoritative: true, approvedAt: "2026-09-01T10:00:00Z", supersededBy: null, withdrawn: false },
      relevance: {
        score: 1,
        rank: 1,
        vectorScore: 0.41,
        lexicalScore: 0.8,
        reasons: [
          { kind: "lexical_match", terms: ["forurening", "gradvis"] },
          { kind: "vector_similarity", score: 0.41 },
          { kind: "fused_rank", rank: 1 },
        ],
      },
      conflicts: [],
      sourceReference: { label: "Testbetingelser Ansvar (fiktiv), version 2, §4.1, side 3", sourceType: "manual_upload" },
    });
    expect(second!.excerpt).toEqual({ text: "• fiktiv undtagelse 7", leadIn: "Forsikringen dækker heller ikke:" });
    expect(second!.sourceReference.label).toBe("Testbetingelser Ansvar (fiktiv), version 2, §6, side 5–6");
    expect(set.signals).toEqual({ itemCount: 2, topScore: 1, hasConflicts: false, hasHistorical: false });
  });

  it("marks historical evidence and never exposes storage paths or file names", async () => {
    const { db } = fakeDb([row({ chunk_id: "22222222-0000-4000-8000-000000000001", lexical_rank: 1, lexical_score: 0.2, temporal_status: "historical", valid_to: "2025-07-01" })]);
    const set = await runRetrieval({ query: "forurening", mode: "as_of", asOf: "2025-03-01" }, deps(db));
    expect(set.items[0]!.validity).toEqual({ validFrom: "2025-01-01", validTo: "2025-07-01", temporalStatus: "historical" });
    expect(set.signals.hasHistorical).toBe(true);
    expect(JSON.stringify(set)).not.toMatch(/storage|original\.pdf|\.pdf|knowledge-originals|filename/i);
  });

  it("maps database errors to user-facing errors without internals", async () => {
    await expect(runRetrieval({ query: "x" }, deps(fakeDb([], { code: "42501", message: "permission denied for function search_chunks" }).db))).rejects.toThrow(
      "Du har ikke adgang til vidensgrundlaget.",
    );
    await expect(runRetrieval({ query: "x" }, deps(fakeDb([], { code: "XX000", message: "internal detail" }).db))).rejects.toThrow(
      "Søgningen kunne ikke gennemføres. Prøv igen.",
    );
  });

  it("ignores fields the request type does not have", async () => {
    const { db, calls } = fakeDb([]);
    const request = { query: "x", grade: "production", reranker: "provider:model", candidateK: 10_000 } as RetrievalRequest;
    const set = await runRetrieval(request, deps(db));
    expect(set.retrieval.grade).toBe("development");
    expect(set.retrieval.reranker.id).toBe("none");
    expect(calls[0]!.args.p_candidate_k).toBe(DEFAULT_RETRIEVAL_CONFIG.candidateK);
  });
});

const A1 = "aaaaaaaa-0000-4000-8000-000000000001";
const B1 = "bbbbbbbb-0000-4000-8000-000000000001";
const B2 = "bbbbbbbb-0000-4000-8000-000000000002";
const C1 = "cccccccc-0000-4000-8000-000000000001";
const DOC_B = "d0000000-0000-4000-8000-0000000000bb";
const DOC_C = "d0000000-0000-4000-8000-0000000000cc";
const CONFLICT_1 = "f0000000-0000-4000-8000-000000000001";
const CONFLICT_2 = "f0000000-0000-4000-8000-000000000002";

const chunkA = row({ chunk_id: A1, lexical_rank: 1, lexical_score: 0.5, lexical_terms: ["forurening"] });
const chunkB = row({ chunk_id: B1, version_id: VERSION_B, document_id: DOC_B, document_title: "Acceptregler (fiktiv)", document_type: "acceptance_rules", text: "Gradvis forurening accepteres." });
const chunkC = row({ chunk_id: C1, version_id: "c1000000-0000-4000-8000-00000000000c", document_id: DOC_C, document_title: "Vejledning (fiktiv)", text: "Tredje kilde." });

function visible(chunkId: string, conflictId: string, target: SearchRow, chunkLevel = true): ConflictRow {
  return {
    chunk_id: chunkId,
    restricted: false,
    conflict_id: conflictId,
    counterpart_document_id: target.document_id,
    counterpart_version_id: target.version_id,
    counterpart_chunk_id: chunkLevel ? target.chunk_id : null,
  };
}

function restricted(chunkId: string): ConflictRow {
  return { chunk_id: chunkId, restricted: true, conflict_id: null, counterpart_document_id: null, counterpart_version_id: null, counterpart_chunk_id: null };
}

describe("conflicts in retrieval (docs/07 §11.4)", () => {
  it("fetches an accessible counterpart that did not score, and links both ways", async () => {
    const { db, calls } = fakeDb([chunkA], { conflicts: [visible(A1, CONFLICT_1, chunkB), visible(B1, CONFLICT_1, chunkA)], chunkRows: [chunkB] });
    const set = await runRetrieval({ query: "forurening" }, deps(db));
    expect(set.items.map((item) => [item.evidenceId, item.chunkId])).toEqual([["e1", A1], ["e2", B1]]);
    expect(set.items[0]!.conflicts).toEqual([{ visibility: "visible", conflictId: CONFLICT_1, status: "open", counterpartEvidenceId: "e2" }]);
    expect(set.items[1]!.conflicts).toEqual([{ visibility: "visible", conflictId: CONFLICT_1, status: "open", counterpartEvidenceId: "e1" }]);
    expect(set.items[1]!.relevance).toMatchObject({ score: 0, rank: 2, fusedScore: 0 });
    expect(set.signals.hasConflicts).toBe(true);
    expect(calls.find((call) => call.fn === "evidence_chunks")!.args).toMatchObject({ p_chunk_ids: [B1], p_version_ids: [], p_date: "2026-10-01" });
  });

  it("links to a counterpart that is already evidence instead of fetching it again", async () => {
    const scoredB = { ...chunkB, lexical_rank: 2, lexical_score: 0.4 };
    const { db, calls } = fakeDb([chunkA, scoredB], { conflicts: [visible(A1, CONFLICT_1, scoredB), visible(B1, CONFLICT_1, chunkA)] });
    const set = await runRetrieval({ query: "forurening" }, deps(db));
    expect(set.items).toHaveLength(2);
    expect(set.items[0]!.conflicts).toEqual([{ visibility: "visible", conflictId: CONFLICT_1, status: "open", counterpartEvidenceId: "e2" }]);
    expect(calls.some((call) => call.fn === "evidence_chunks")).toBe(false);
  });

  it("shows an inaccessible counterpart as exactly one neutral indicator — however many there are", async () => {
    const { db } = fakeDb([chunkA], { conflicts: [restricted(A1), restricted(A1)] });
    const set = await runRetrieval({ query: "forurening" }, deps(db));
    expect(set.items).toHaveLength(1);
    expect(set.items[0]!.conflicts).toEqual([{ visibility: "restricted", message: RESTRICTED_CONFLICT_MESSAGE }]);
    expect(set.signals.hasConflicts).toBe(true);
  });

  it("returns accessible counterparts as full evidence and the rest as one indicator", async () => {
    const { db } = fakeDb([chunkA], { conflicts: [visible(A1, CONFLICT_1, chunkB), restricted(A1)], chunkRows: [chunkB] });
    const set = await runRetrieval({ query: "forurening" }, deps(db));
    expect(set.items[0]!.conflicts).toEqual([
      { visibility: "visible", conflictId: CONFLICT_1, status: "open", counterpartEvidenceId: "e2" },
      { visibility: "restricted", message: RESTRICTED_CONFLICT_MESSAGE },
    ]);
  });

  it("on version level, takes the counterpart document's best passage for the same query", async () => {
    const bestOfB = { ...chunkB, chunk_id: B2, chunk_index: 3, lexical_rank: 1, lexical_score: 0.3, lexical_terms: ["forurening"] };
    const { db, calls } = fakeDb([chunkA], { conflicts: [visible(A1, CONFLICT_1, chunkB, false)], documentRows: { [DOC_B]: [bestOfB] } });
    const set = await runRetrieval({ query: "forurening", documentIds: [chunkA.document_id] }, deps(db));
    expect(set.items.map((item) => item.chunkId)).toEqual([A1, B2]);
    const scoped = calls.filter((call) => call.fn === "search_chunks")[1]!;
    expect(scoped.args).toMatchObject({ p_document_ids: [DOC_B], p_product_ids: null, p_document_types: null });
    expect(set.items[1]!.relevance.reasons).toEqual([{ kind: "lexical_match", terms: ["forurening"] }]);
  });

  it("on version level, falls back to the counterpart's first chunk when the query finds nothing there", async () => {
    const { db, calls } = fakeDb([chunkA], { conflicts: [visible(A1, CONFLICT_1, chunkB, false)], documentRows: { [DOC_B]: [] }, chunkRows: [chunkB] });
    const set = await runRetrieval({ query: "forurening" }, deps(db));
    expect(set.items.map((item) => item.chunkId)).toEqual([A1, B1]);
    expect(calls.find((call) => call.fn === "evidence_chunks")!.args).toMatchObject({ p_chunk_ids: [], p_version_ids: [VERSION_B] });
  });

  it("follows the counterparts' own conflicts until nothing new is found", async () => {
    const { db } = fakeDb([chunkA], {
      conflicts: [visible(A1, CONFLICT_1, chunkB), visible(B1, CONFLICT_1, chunkA), visible(B1, CONFLICT_2, chunkC), visible(C1, CONFLICT_2, chunkB), restricted(C1)],
      chunkRows: [chunkB, chunkC],
    });
    const set = await runRetrieval({ query: "forurening" }, deps(db));
    expect(set.items.map((item) => item.chunkId)).toEqual([A1, B1, C1]);
    expect(set.items[1]!.conflicts.map((conflict) => (conflict.visibility === "visible" ? conflict.counterpartEvidenceId : "restricted"))).toEqual(["e1", "e3"]);
    expect(set.items[2]!.conflicts.map((conflict) => (conflict.visibility === "visible" ? conflict.counterpartEvidenceId : "restricted"))).toEqual(["e2", "restricted"]);
  });

  it("never puts a restricted counterpart's data in the evidence", async () => {
    const { db } = fakeDb([chunkA], { conflicts: [restricted(A1)] });
    const serialized = JSON.stringify(await runRetrieval({ query: "forurening" }, deps(db)));
    for (const value of [B1, VERSION_B, DOC_B, "Acceptregler", CONFLICT_1, "overlapping_scope", "duplicate_content"]) expect(serialized).not.toContain(value);
  });
});

describe("source reference label (docs/04 §17.1)", () => {
  it("uses the heading when there is no section number, and omits a missing version label", () => {
    expect(sourceReferenceLabel({ title: "T", versionLabel: null, sectionNumber: null, heading: "Indledning", pageStart: 1, pageEnd: 1 })).toBe("T, Indledning, side 1");
  });
});
