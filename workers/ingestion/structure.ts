import type { ExtractedLine, ExtractedPage } from "./types.ts";

/**
 * Step 5 — structuring (docs/07 §5.2): headings (font size/weight and numbering such as
 * "§ 4", "4.2"), paragraphs, lists, tables and page boundaries → a block structure, plus the
 * version's normalized text that every chunk points into ([char_start, char_end)).
 *
 * The normalized text is the blocks in reading order, separated by a blank line. Repeated
 * page headers and footers are already removed (normalize.ts).
 */

export interface LineSpan {
  page: number;
  start: number;
  end: number;
}

export interface HeadingBlock {
  kind: "heading";
  text: string;
  level: number;
  sectionNumber: string | null;
  page: number;
  start: number;
  end: number;
}

export interface ParagraphBlock {
  kind: "paragraph";
  text: string;
  start: number;
  end: number;
}

export interface ListItem {
  text: string;
  start: number;
  end: number;
}

export interface ListBlock {
  kind: "list";
  items: ListItem[];
  start: number;
  end: number;
}

export interface TableRow {
  cells: string[];
  text: string;
  start: number;
  end: number;
}

export interface TableBlock {
  kind: "table";
  rows: TableRow[];
  /** Rows with differing column counts or misaligned columns. */
  uncertain: boolean;
  start: number;
  end: number;
}

export type Block = HeadingBlock | ParagraphBlock | ListBlock | TableBlock;

export interface PageSpan {
  pageNumber: number;
  hasTextLayer: boolean;
  start: number;
  end: number;
}

export interface StructuredDocument {
  text: string;
  blocks: Block[];
  pages: PageSpan[];
  bodyFontSize: number;
}

type Kind = "heading" | "list" | "table" | "body";

interface Line extends ExtractedLine {
  page: number;
  kind: Kind;
}

const NUMBERED_SECTION = /^(§\s*\d+[a-zA-Z]?|\d+(?:\.\d+)+\.?)\s+\S/;
const LIST_MARKER = /^(?:[•▪◦·∙‣\-–—*]|\(?[a-zæøå]\)|\(?\d{1,2}\)|[a-zæøå]\.|\d{1,2}\.)\s+\S/;
const SECTION_NUMBER = /^(?:§\s*)?(\d+(?:\.\d+)*)/;

function round(value: number): number {
  return Math.round(value * 2) / 2;
}

/** The most common font size, weighted by text length. */
function bodySizeOf(lines: ExtractedLine[]): number {
  const weight = new Map<number, number>();
  for (const line of lines) weight.set(round(line.fontSize), (weight.get(round(line.fontSize)) ?? 0) + line.text.length);
  return [...weight].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10;
}

function classify(line: ExtractedLine, body: number): Kind {
  if (line.runs.length >= 2) return "table";
  const text = line.text;
  const terminal = /[.,;:]$/.test(text);
  if (
    text.length <= 150 &&
    !text.endsWith(":") &&
    (line.fontSize >= body * 1.15 || (line.bold && !terminal) || (NUMBERED_SECTION.test(text) && text.length <= 80 && !terminal))
  ) {
    return "heading";
  }
  if (LIST_MARKER.test(text)) return "list";
  return "body";
}

function numberingDepth(text: string): number {
  const match = SECTION_NUMBER.exec(text);
  if (!match) return 0;
  return match[1]!.split(".").filter(Boolean).length;
}

export function sectionNumberOf(text: string): string | null {
  if (!NUMBERED_SECTION.test(text) && !/^§\s*\d/.test(text)) return null;
  return SECTION_NUMBER.exec(text)?.[1] ?? null;
}

/** Heading levels: by font size (larger = higher), then numbering depth (4 > 4.2 > 4.2.1). */
function headingLevels(headings: Line[]): Map<Line, number> {
  const sizes = [...new Set(headings.map((line) => round(line.fontSize)))].sort((a, b) => b - a);
  const keyOf = (line: Line) => sizes.indexOf(round(line.fontSize)) * 10 + numberingDepth(line.text);
  const keys = [...new Set(headings.map(keyOf))].sort((a, b) => a - b);
  return new Map(headings.map((line) => [line, keys.indexOf(keyOf(line)) + 1]));
}

/** Joins wrapped lines; a hyphen at a line break before a lowercase letter is a word break. */
function joinLines(parts: string[]): string {
  let text = "";
  for (const part of parts) {
    if (text.length === 0) text = part;
    else if (/[A-Za-zÆØÅæøå]-$/.test(text) && /^[a-zæøå]/.test(part)) text = text.slice(0, -1) + part;
    else text += ` ${part}`;
  }
  return text;
}

function startsNewParagraph(previous: Line, line: Line): boolean {
  if (line.page !== previous.page) {
    return /[.!?:]$/.test(previous.text) || !/^[a-zæøå]/.test(line.text);
  }
  if (Math.abs(line.fontSize - previous.fontSize) > 1) return true;
  return previous.y - line.y > previous.fontSize * 1.9;
}

function columnsAligned(rows: Line[]): boolean {
  const counts = new Set(rows.map((row) => row.runs.length));
  if (counts.size !== 1) return false;
  const first = rows[0]!;
  return rows.every((row) => row.runs.every((run, index) => Math.abs(run.x - first.runs[index]!.x) <= first.fontSize));
}

export function structurePages(pages: ExtractedPage[]): StructuredDocument {
  const allLines = pages.flatMap((page) => page.lines);
  const body = bodySizeOf(allLines);
  const lines: Line[] = pages.flatMap((page) => page.lines.map((line) => ({ ...line, page: page.pageNumber, kind: classify(line, body) })));

  // A single isolated multi-column line is not a table — treat it as running text.
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.kind !== "table") continue;
    const neighbour = (lines[i - 1]?.kind === "table" && lines[i - 1]!.page === line.page) || (lines[i + 1]?.kind === "table" && lines[i + 1]!.page === line.page);
    if (!neighbour) line.kind = "body";
  }

  const levels = headingLevels(lines.filter((line) => line.kind === "heading"));

  let text = "";
  const blocks: Block[] = [];
  const lineSpans: LineSpan[] = [];
  const append = (value: string) => {
    if (text.length > 0) text += "\n\n";
    const start = text.length;
    text += value;
    return { start, end: text.length };
  };
  const pageSpanOf = (group: Line[], start: number, end: number) => {
    // Distributes [start, end) over the pages of the lines in the group.
    const pagesInGroup = [...new Set(group.map((line) => line.page))];
    if (pagesInGroup.length === 1) {
      lineSpans.push({ page: pagesInGroup[0]!, start, end });
      return;
    }
    const total = group.reduce((sum, line) => sum + line.text.length + 1, 0);
    let cursor = start;
    for (const page of pagesInGroup) {
      const share = group.filter((line) => line.page === page).reduce((sum, line) => sum + line.text.length + 1, 0);
      const pageEnd = page === pagesInGroup[pagesInGroup.length - 1] ? end : Math.min(end, cursor + Math.round(((end - start) * share) / total));
      lineSpans.push({ page, start: cursor, end: pageEnd });
      cursor = pageEnd;
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    if (line.kind === "heading") {
      // A heading wrapped over two lines continues with the same size and weight, without numbering.
      const group = [line];
      while (
        lines[i + group.length]?.kind === "heading" &&
        lines[i + group.length]!.page === line.page &&
        round(lines[i + group.length]!.fontSize) === round(line.fontSize) &&
        lines[i + group.length]!.bold === line.bold &&
        !NUMBERED_SECTION.test(lines[i + group.length]!.text) &&
        sectionNumberOf(line.text) === null
      ) {
        group.push(lines[i + group.length]!);
      }
      const value = joinLines(group.map((entry) => entry.text));
      const span = append(value);
      pageSpanOf(group, span.start, span.end);
      blocks.push({ kind: "heading", text: value, level: levels.get(line)!, sectionNumber: sectionNumberOf(value), page: line.page, ...span });
      i += group.length;
      continue;
    }

    if (line.kind === "table") {
      const rows: Line[] = [];
      while (lines[i]?.kind === "table") rows.push(lines[i++]!);
      const tableRows: TableRow[] = [];
      const rowTexts = rows.map((row) => row.runs.map((run) => run.text).join(" | "));
      const span = append(rowTexts.join("\n"));
      let cursor = span.start;
      rows.forEach((row, index) => {
        const value = rowTexts[index]!;
        tableRows.push({ cells: row.runs.map((run) => run.text), text: value, start: cursor, end: cursor + value.length });
        lineSpans.push({ page: row.page, start: cursor, end: cursor + value.length });
        cursor += value.length + 1;
      });
      blocks.push({ kind: "table", rows: tableRows, uncertain: !columnsAligned(rows), ...span });
      continue;
    }

    if (line.kind === "list") {
      const itemGroups: Line[][] = [];
      let previous: Line | null = null;
      while (i < lines.length) {
        const current = lines[i]!;
        if (current.kind === "list" && (!previous || !startsNewListBlock(previous, current))) {
          itemGroups.push([current]);
        } else if (
          current.kind === "body" && previous && itemGroups.length > 0 &&
          current.page === previous.page && current.x > itemGroups[itemGroups.length - 1]![0]!.x + 3 &&
          previous.y - current.y <= previous.fontSize * 1.9
        ) {
          itemGroups[itemGroups.length - 1]!.push(current);
        } else {
          break;
        }
        previous = current;
        i += 1;
      }
      const itemTexts = itemGroups.map((group) => joinLines(group.map((entry) => entry.text)));
      const span = append(itemTexts.join("\n"));
      const items: ListItem[] = [];
      let cursor = span.start;
      itemGroups.forEach((group, index) => {
        const value = itemTexts[index]!;
        items.push({ text: value, start: cursor, end: cursor + value.length });
        pageSpanOf(group, cursor, cursor + value.length);
        cursor += value.length + 1;
      });
      blocks.push({ kind: "list", items, ...span });
      continue;
    }

    // Running text: a paragraph continues until a gap, a size change or another block kind.
    const group = [line];
    i += 1;
    while (i < lines.length && lines[i]!.kind === "body" && !startsNewParagraph(group[group.length - 1]!, lines[i]!)) {
      group.push(lines[i]!);
      i += 1;
    }
    const value = joinLines(group.map((entry) => entry.text));
    const span = append(value);
    pageSpanOf(group, span.start, span.end);
    blocks.push({ kind: "paragraph", text: value, ...span });
  }

  // Page spans: contiguous ranges of the normalized text; pages without text are empty.
  const pageSpans: PageSpan[] = [];
  let cursor = 0;
  for (const page of pages) {
    const spans = lineSpans.filter((span) => span.page === page.pageNumber);
    if (spans.length === 0) {
      pageSpans.push({ pageNumber: page.pageNumber, hasTextLayer: false, start: cursor, end: cursor });
      continue;
    }
    const start = Math.max(cursor, Math.min(...spans.map((span) => span.start)));
    const end = Math.max(start, Math.max(...spans.map((span) => span.end)));
    pageSpans.push({ pageNumber: page.pageNumber, hasTextLayer: page.hasTextLayer, start, end });
    cursor = end;
  }

  return { text, blocks, pages: pageSpans, bodyFontSize: body };
}

function startsNewListBlock(previous: Line, current: Line): boolean {
  if (current.page !== previous.page) return false;
  return previous.y - current.y > previous.fontSize * 2.5;
}

/** The page an offset in the normalized text belongs to. */
export function pageAt(pages: PageSpan[], offset: number): number {
  const withText = pages.filter((page) => page.end > page.start);
  const hit = withText.find((page) => offset >= page.start && offset < page.end);
  if (hit) return hit.pageNumber;
  const before = withText.filter((page) => page.start <= offset);
  return (before[before.length - 1] ?? withText[0] ?? pages[0])?.pageNumber ?? 1;
}

const ABBREVIATIONS = new Set([
  "bl.a.", "f.eks.", "jf.", "pkt.", "nr.", "stk.", "kr.", "ca.", "dvs.", "mv.", "m.v.", "inkl.", "ekskl.", "evt.",
  "osv.", "mht.", "iht.", "vedr.", "ift.", "pga.", "p.t.", "o.l.", "m.m.", "s.", "t.o.m.", "fr.o.m.",
]);

/** Sentence spans (relative offsets). Danish abbreviations such as "jf." and "stk." are not boundaries. */
export function splitSentences(value: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  let start = 0;
  const boundary = /[.!?]+["')\]]?\s+/g;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(value)) !== null) {
    const punctuationEnd = match.index + match[0].trimEnd().length;
    const next = value[match.index + match[0].length] ?? "";
    const word = value.slice(start, punctuationEnd).split(/\s+/).pop()?.toLowerCase() ?? "";
    if (ABBREVIATIONS.has(word) || !/[A-ZÆØÅ0-9§"'(]/.test(next)) continue;
    spans.push({ start, end: punctuationEnd });
    start = match.index + match[0].length;
  }
  if (start < value.length) spans.push({ start, end: value.trimEnd().length });
  return spans.filter((span) => span.end > span.start);
}
