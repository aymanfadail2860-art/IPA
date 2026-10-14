import type { Embedder } from "@/lib/knowledge/core/embedding";
import { issueEvidenceSet, type EvidenceItem, type EvidenceSet } from "@/lib/knowledge/core/evidence";
import type { Grade } from "@/lib/knowledge/core/grade";
import { parseRetrievalContext } from "@/lib/knowledge/core/retrieval-context";
import type { Reranker } from "@/lib/knowledge/core/reranker";
import {
  DEFAULT_DOCUMENT_RETRIEVAL_PARAMS,
  DEFAULT_RETRIEVAL_CONFIG,
  PRODUCT_DOCUMENTS_ALGORITHM_VERSION,
  RETRIEVAL_ALGORITHM_VERSION,
} from "@/lib/knowledge/retrieval-core";

import { FIXTURE_CHUNKER_VERSION, FIXTURE_MODEL, FIXTURE_TEST_PRODUCT_ID, fixtureContext, fixtureDocumentMaterial } from "./production-config";

/**
 * Fictional evidence for the AI Gateway tests (phase 8). Since 8B-I6 production grade is
 * DERIVED from P1–P9, so production-grade evidence is issued with an active, approved fixture
 * configuration in the retrieval context. A test double that merely declares production grade
 * gives development evidence.
 *
 * Beta L2 (docs/beta.md §14): with no production embedder or reranker left, the hybrid method can
 * never issue production evidence. `{ embedder: "production", reranker: "production" }` therefore
 * issues production evidence the way the beta does: with product_documents (B-035) — the method
 * that needs neither. Every other combination stays hybrid with test doubles.
 */

export function fakeEmbedder(grade: Grade): Embedder {
  return { id: `fake-embedder-${grade}`, grade, dimensions: 3, embed: async (texts) => texts.map(() => [1, 0, 0]) };
}

export function fakeReranker(id: string, grade: Grade): Reranker {
  return { id, version: "1", grade, rerank: async () => ({ ranked: [], reranker: { id, version: "1" } }) };
}

export function evidenceItem(n: number, overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    evidenceId: `e${n}`,
    documentId: `d${n}`,
    documentVersionId: `00000000-0000-4000-8000-00000000010${n}`,
    chunkId: `00000000-0000-4000-8000-00000000020${n}`,
    chunkIds: [`00000000-0000-4000-8000-00000000020${n}`],
    chunkIndex: 0,
    chunkerVersion: FIXTURE_CHUNKER_VERSION,
    product: { id: FIXTURE_TEST_PRODUCT_ID, name: "Testprodukt (fiktiv)" },
    document: { title: `Testbetingelser ${n} (fiktiv)`, type: "terms", versionLabel: "1", language: "da" },
    location: { pageStart: 1, pageEnd: 1, sectionNumber: `${n}.1`, heading: null, headingPath: [] },
    excerpt: { text: `Forsikringen dækker skade forårsaget af droner i pkt. ${n}.`, leadIn: null },
    validity: { validFrom: "2025-01-01", validTo: null, temporalStatus: "current" },
    authority: { status: "published", authoritative: true, approvedAt: null, supersededBy: null, withdrawn: false },
    relevance: { score: 0.9 - n / 100, rank: n, fusedScore: 0.03, vectorScore: null, lexicalScore: 0.4, reasons: [] },
    conflicts: [],
    sourceReference: { label: `Testbetingelser ${n} (fiktiv), version 1, §${n}.1, side 1`, sourceType: "manual_upload" },
    ...overrides,
  };
}

export function issueEvidence(
  items: EvidenceItem[],
  grades: { embedder?: Grade | null; reranker?: Grade; rerankerId?: string; devOverride?: "force_insufficient" } = {},
): EvidenceSet {
  const query = { text: "droner", mode: "current" as const, asOf: "2026-10-02", language: "da", filters: {} };
  if (grades.embedder === "production" && grades.reranker === "production" && grades.rerankerId === undefined) {
    return issueEvidenceSet({
      query,
      embedding: null,
      reranker: null,
      method: "product_documents",
      context: parseRetrievalContext(fixtureContext({ material: fixtureDocumentMaterial() })),
      algorithmVersion: PRODUCT_DOCUMENTS_ALGORITHM_VERSION,
      params: { ...DEFAULT_DOCUMENT_RETRIEVAL_PARAMS },
      candidateCount: items.length,
      generatedAt: "2026-10-02T10:00:00Z",
      items,
      devOverride: grades.devOverride,
    });
  }
  const embedderGrade = grades.embedder === undefined ? "development" : grades.embedder;
  const embedder: Embedder | null = embedderGrade ? fakeEmbedder(embedderGrade) : null;
  const reranker: Reranker = fakeReranker(grades.rerankerId ?? "none", grades.reranker ?? "development");
  return issueEvidenceSet({
    query,
    embedding: embedder ? { embedder, modelId: FIXTURE_MODEL.id } : null,
    reranker,
    method: "hybrid",
    context: parseRetrievalContext(fixtureContext()),
    algorithmVersion: RETRIEVAL_ALGORITHM_VERSION,
    params: { ...DEFAULT_RETRIEVAL_CONFIG },
    candidateCount: items.length,
    generatedAt: "2026-10-02T10:00:00Z",
    items,
    devOverride: grades.devOverride,
  });
}
