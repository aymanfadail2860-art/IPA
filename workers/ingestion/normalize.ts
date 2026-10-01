import type { ExtractedLine, ExtractedPage } from "./types.ts";

/**
 * Step 4 — normalization (docs/07 §5.2): Unicode NFC, whitespace, removal of repeated
 * page headers and footers (counted), and a character-set check for æøå. Hyphenation at
 * line breaks is joined when lines are assembled into paragraphs (structure.ts).
 */

export interface NormalizationStats {
  headerFooterLinesRemoved: number;
  encodingWarnings: string[];
}

export function normalizeText(text: string): string {
  return text.normalize("NFC").replace(/[  -​  　]/g, " ").replace(/\s+/g, " ").trim();
}

/** Repeated header/footer lines are compared with digits masked ("Side 3 af 10"). */
function lineKey(text: string): string {
  return text.toLowerCase().replace(/\d+/g, "#");
}

const MOJIBAKE = /Ã[¦¸¥†˜…]|�/;

export function normalizePages(pages: ExtractedPage[]): { pages: ExtractedPage[]; stats: NormalizationStats } {
  const cleaned = pages.map((page) => ({
    ...page,
    lines: page.lines
      .map((line): ExtractedLine => ({
        ...line,
        text: normalizeText(line.text),
        runs: line.runs.map((run) => ({ ...run, text: normalizeText(run.text) })).filter((run) => run.text.length > 0),
      }))
      .filter((line) => line.text.length > 0),
  }));

  // Header/footer candidates: the two top and two bottom lines of every page with text.
  const withText = cleaned.filter((page) => page.lines.length > 0);
  const counts = new Map<string, number>();
  const candidatesOf = (page: ExtractedPage) => {
    const byY = [...page.lines].sort((a, b) => b.y - a.y);
    return new Set([...byY.slice(0, 2), ...byY.slice(-2)].map((line) => lineKey(line.text)));
  };
  for (const page of withText) for (const key of candidatesOf(page)) counts.set(key, (counts.get(key) ?? 0) + 1);
  const threshold = Math.max(3, Math.ceil(withText.length * 0.5));
  const repeated = new Set([...counts].filter(([, count]) => withText.length >= 3 && count >= threshold).map(([key]) => key));

  let removed = 0;
  const encodingWarnings: string[] = [];
  const result = cleaned.map((page) => {
    const candidates = candidatesOf(page);
    const lines = page.lines.filter((line) => {
      const key = lineKey(line.text);
      if (repeated.has(key) && candidates.has(key)) {
        removed += 1;
        return false;
      }
      return true;
    });
    if (lines.some((line) => MOJIBAKE.test(line.text))) {
      encodingWarnings.push(`Mulige tegnsætsfejl (æ, ø, å) på side ${page.pageNumber}.`);
    }
    return { ...page, lines, hasTextLayer: page.hasTextLayer };
  });

  return { pages: result, stats: { headerFooterLinesRemoved: removed, encodingWarnings } };
}
