import type { Embedder } from "@/lib/knowledge/core/embedding";
import { issueEvidenceSet, type EvidenceItem, type EvidenceSet } from "@/lib/knowledge/core/evidence";
import type { Grade } from "@/lib/knowledge/core/grade";
import type { Reranker } from "@/lib/knowledge/core/reranker";

/**
 * Fictional evidence for the AI Gateway tests (phase 8). Real providers do not exist yet, so
 * production-grade evidence is issued with test doubles that DECLARE production grade — the
 * same technique as the phase 7 guardrail tests.
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
    product: { id: "p", name: "Testprodukt (fiktiv)" },
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
  const embedderGrade = grades.embedder === undefined ? "development" : grades.embedder;
  return issueEvidenceSet({
    query: { text: "droner", mode: "current", asOf: "2026-10-02", language: "da", filters: {} },
    embedder: embedderGrade ? fakeEmbedder(embedderGrade) : null,
    reranker: fakeReranker(grades.rerankerId ?? (grades.reranker === "production" ? "provider-x" : "none"), grades.reranker ?? "development"),
    candidateCount: items.length,
    generatedAt: "2026-10-02T10:00:00Z",
    items,
    devOverride: grades.devOverride,
  });
}
