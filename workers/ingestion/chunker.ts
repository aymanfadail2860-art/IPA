import { createHash } from "node:crypto";

import { pageAt, splitSentences, type Block, type ListBlock, type ParagraphBlock, type StructuredDocument, type TableBlock } from "./structure.ts";

/**
 * Step 6 — structure-aware chunking (docs/07 §6). Pure and deterministic.
 *
 *   * A chunk never crosses a heading; every chunk carries the full heading chain.
 *   * Sections are packed paragraph by paragraph up to a target size. A paragraph is only
 *     split when it alone exceeds the maximum, and then at sentence boundaries.
 *   * A list's lead-in ("Forsikringen dækker ikke:") always stays with its items. When a long
 *     list is split, the lead-in is repeated as `leadIn` in every following chunk.
 *   * A table is its own chunk and never mixed with prose; large tables are split by rows and
 *     the header row is repeated as `leadIn`.
 *   * Overlap: at most two sentences from the previous chunk (≈15 %), only within a section.
 *   * `text` is always exactly normalizedText.slice(charStart, charEnd). The repeated lead-in
 *     is context outside that range.
 */

export const CHUNKER_VERSION = "structure/1";

export interface ChunkerConfig {
  targetChars: number;
  maxChars: number;
  overlapMaxSentences: number;
  overlapMaxRatio: number;
}

/** ≈400 / 800 tokens at ~4 characters per token (docs/07 §6: configuration, not locked). */
export const DEFAULT_CHUNKER_CONFIG: ChunkerConfig = {
  targetChars: 1600,
  maxChars: 3200,
  overlapMaxSentences: 2,
  overlapMaxRatio: 0.15,
};

export type ChunkKind = "prose" | "list" | "table";

export interface Chunk {
  chunkIndex: number;
  kind: ChunkKind;
  text: string;
  leadIn: string | null;
  heading: string | null;
  headingPath: string[];
  sectionNumber: string | null;
  pageStart: number;
  pageEnd: number;
  charStart: number;
  charEnd: number;
  overlapChars: number;
  contentHash: string;
  charCount: number;
  tokenEstimate: number;
}

interface Span {
  start: number;
  end: number;
}

interface Draft {
  start: number;
  end: number;
  overlapChars: number;
  kind: ChunkKind;
  leadIn: string | null;
  /** The last unit was a paragraph — its trailing sentences may overlap into the next chunk. */
  endsWithProse: boolean;
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function chunkDocument(document: StructuredDocument, config: ChunkerConfig = DEFAULT_CHUNKER_CONFIG): Chunk[] {
  const { text, blocks } = document;
  const chunks: Chunk[] = [];
  const stack: { text: string; level: number; sectionNumber: string | null }[] = [];
  let current: Draft | null = null;
  let previous: Draft | null = null;

  const emit = (draft: Draft) => {
    const value = text.slice(draft.start, draft.end);
    if (value.trim().length === 0) return;
    const sectionNumber = [...stack].reverse().find((entry) => entry.sectionNumber)?.sectionNumber ?? null;
    chunks.push({
      chunkIndex: chunks.length,
      kind: draft.kind,
      text: value,
      leadIn: draft.leadIn,
      heading: stack[stack.length - 1]?.text ?? null,
      headingPath: stack.map((entry) => entry.text),
      sectionNumber,
      pageStart: pageAt(document.pages, draft.start),
      pageEnd: pageAt(document.pages, draft.end - 1),
      charStart: draft.start,
      charEnd: draft.end,
      overlapChars: draft.overlapChars,
      contentHash: createHash("sha256").update(value).digest("hex"),
      charCount: value.length,
      tokenEstimate: estimateTokens(value),
    });
  };

  const flush = () => {
    if (current) {
      emit(current);
      previous = current;
    }
    current = null;
  };

  /** Up to two trailing sentences of the previous chunk, if within the overlap budget. */
  const overlapStart = (from: Draft | null, nextStart: number): number => {
    if (!from || !from.endsWithProse) return nextStart;
    const tail = text.slice(from.start, from.end);
    const sentences = splitSentences(tail);
    const budget = config.targetChars * config.overlapMaxRatio;
    let start = from.end;
    for (const sentence of sentences.slice(-config.overlapMaxSentences).reverse()) {
      const candidate = from.start + sentence.start;
      if (from.end - candidate > budget || candidate < from.start + from.overlapChars) break;
      start = candidate;
    }
    return start < from.end ? start : nextStart;
  };

  const startDraft = (unit: Span, kind: ChunkKind, withOverlap: boolean, leadIn: string | null = null): Draft => {
    const start = withOverlap ? overlapStart(previous, unit.start) : unit.start;
    return { start, end: unit.end, overlapChars: unit.start - start, kind, leadIn, endsWithProse: kind === "prose" };
  };

  const size = (draft: Draft) => draft.end - draft.start;

  const addParagraph = (paragraph: ParagraphBlock) => {
    const length = paragraph.end - paragraph.start;
    if (length > config.maxChars) {
      flush();
      for (const group of groupSentences(paragraph)) {
        current = startDraft(group, "prose", previous !== null);
        flush();
      }
      return;
    }
    if (current && size(current) + 2 + length > config.targetChars) {
      flush();
      current = startDraft(paragraph, "prose", true);
      return;
    }
    if (current) {
      current = { ...current, end: paragraph.end, endsWithProse: true };
    } else {
      current = startDraft(paragraph, "prose", previous !== null);
    }
  };

  const groupSentences = (paragraph: ParagraphBlock): Span[] => {
    const groups: Span[] = [];
    for (const sentence of splitSentences(paragraph.text)) {
      const span = { start: paragraph.start + sentence.start, end: paragraph.start + sentence.end };
      const last = groups[groups.length - 1];
      if (last && span.end - last.start <= config.targetChars) last.end = span.end;
      else groups.push(span);
    }
    return groups;
  };

  const addList = (list: ListBlock, intro: ParagraphBlock | null) => {
    const unit = { start: intro?.start ?? list.start, end: list.end };
    const length = unit.end - unit.start;
    if (current && size(current) + 2 + length <= config.targetChars) {
      current = { ...current, end: unit.end, kind: "list", endsWithProse: false };
      return;
    }
    flush();
    if (length <= config.maxChars) {
      current = { ...startDraft(unit, "list", false), endsWithProse: false };
      flush();
      return;
    }
    // Long list: pack items; the lead-in stays with the first items and is repeated after.
    let group: Span | null = null;
    let first = true;
    for (const item of list.items) {
      const itemSpan = { start: first && intro ? intro.start : item.start, end: item.end };
      if (group && itemSpan.end - group.start <= config.targetChars) {
        group.end = itemSpan.end;
        continue;
      }
      if (group) {
        current = { start: group.start, end: group.end, overlapChars: 0, kind: "list", leadIn: first ? null : intro?.text ?? null, endsWithProse: false };
        flush();
        first = false;
      }
      group = first ? itemSpan : { start: item.start, end: item.end };
    }
    if (group) {
      current = { start: group.start, end: group.end, overlapChars: 0, kind: "list", leadIn: first ? null : intro?.text ?? null, endsWithProse: false };
      flush();
    }
  };

  const addTable = (table: TableBlock) => {
    flush();
    const header = table.rows[0]!;
    let group: Span | null = null;
    let first = true;
    for (const row of table.rows) {
      if (group && row.end - group.start <= config.targetChars) {
        group.end = row.end;
        continue;
      }
      if (group) {
        current = { start: group.start, end: group.end, overlapChars: 0, kind: "table", leadIn: first ? null : header.text, endsWithProse: false };
        flush();
        first = false;
      }
      group = { start: row.start, end: row.end };
    }
    if (group) {
      current = { start: group.start, end: group.end, overlapChars: 0, kind: "table", leadIn: first ? null : header.text, endsWithProse: false };
      flush();
    }
  };

  for (let index = 0; index < blocks.length; index += 1) {
    const block: Block = blocks[index]!;
    if (block.kind === "heading") {
      flush();
      previous = null; // never overlap across a heading
      while (stack.length > 0 && stack[stack.length - 1]!.level >= block.level) stack.pop();
      stack.push({ text: block.text, level: block.level, sectionNumber: block.sectionNumber });
      continue;
    }
    if (block.kind === "paragraph") {
      const next = blocks[index + 1];
      if (block.text.trimEnd().endsWith(":") && next?.kind === "list") {
        addList(next, block);
        index += 1;
      } else {
        addParagraph(block);
      }
      continue;
    }
    if (block.kind === "list") addList(block, null);
    else addTable(block);
  }
  flush();
  return chunks;
}
