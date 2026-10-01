import type { Chunk } from "./chunker.ts";
import type { NormalizationStats } from "./normalize.ts";
import type { StructuredDocument } from "./structure.ts";

/**
 * The worker's part of the quality report (docs/07 §5.3). It makes no decisions. The
 * database adds metadata, duplicates, validity overlaps/gaps and access facts when the job
 * completes (knowledge.compute_quality_facts). Approval is blocked only by the rules in
 * docs/07 §3.2 — here: pages that could not be read.
 */
export interface WorkerQualityReport {
  pages: { total: number; read: number; without_text: number[]; all_read: boolean };
  structure: { headings: number; recognized: boolean };
  chunks: { total: number; without_heading: number; by_kind: Record<string, number> };
  tables: { found: number; uncertain: number };
  normalization: { header_footer_lines_removed: number; encoding_warnings: string[] };
  versions: { extractor: string; chunker: string; embedding_model: string | null };
}

export function buildQualityReport(input: {
  document: StructuredDocument;
  chunks: Chunk[];
  normalization: NormalizationStats;
  extractorVersion: string;
  chunkerVersion: string;
  embeddingModel?: string | null;
}): WorkerQualityReport {
  const { document, chunks } = input;
  const withoutText = document.pages.filter((page) => !page.hasTextLayer).map((page) => page.pageNumber);
  const headings = document.blocks.filter((block) => block.kind === "heading").length;
  const tables = document.blocks.filter((block) => block.kind === "table");
  const byKind: Record<string, number> = { prose: 0, list: 0, table: 0 };
  for (const chunk of chunks) byKind[chunk.kind] = (byKind[chunk.kind] ?? 0) + 1;
  return {
    pages: {
      total: document.pages.length,
      read: document.pages.length - withoutText.length,
      without_text: withoutText,
      all_read: withoutText.length === 0,
    },
    structure: { headings, recognized: headings > 0 },
    chunks: { total: chunks.length, without_heading: chunks.filter((chunk) => chunk.headingPath.length === 0).length, by_kind: byKind },
    tables: { found: tables.length, uncertain: tables.filter((table) => table.kind === "table" && table.uncertain).length },
    normalization: {
      header_footer_lines_removed: input.normalization.headerFooterLinesRemoved,
      encoding_warnings: input.normalization.encodingWarnings,
    },
    versions: { extractor: input.extractorVersion, chunker: input.chunkerVersion, embedding_model: input.embeddingModel ?? null },
  };
}
