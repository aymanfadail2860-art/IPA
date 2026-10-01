import { getDocument, version as pdfjsVersion } from "pdfjs-dist/legacy/build/pdf.mjs";

import { LIMITS } from "./validate.ts";
import { FileRejected, type ExtractedLine, type ExtractedPage, type TextRun } from "./types.ts";

/**
 * Step 3 — text extraction (docs/07 §5.2): text, position and font traits per page. Pages
 * without a text layer are recorded, never OCR'd (B-14). PDF content is never executed:
 * no font loading, no XFA rendering, no scripts; embedded files are ignored.
 */

export const EXTRACTOR_VERSION = `pdfjs-${pdfjsVersion}/1`;

interface RawItem {
  text: string;
  x: number;
  y: number;
  width: number;
  size: number;
  bold: boolean;
}

const BOLD_FONT = /bold|black|heavy|semibold|demi/i;

function groupLines(items: RawItem[]): ExtractedLine[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: RawItem[][] = [];
  for (const item of sorted) {
    const current = lines[lines.length - 1];
    if (current && Math.abs(current[0]!.y - item.y) <= Math.max(1, 0.3 * item.size)) current.push(item);
    else lines.push([item]);
  }

  return lines.map((lineItems) => {
    const byX = lineItems.sort((a, b) => a.x - b.x);
    const runs: TextRun[] = [];
    let previous: RawItem | null = null;
    for (const item of byX) {
      const gap = previous ? item.x - (previous.x + previous.width) : 0;
      const run = runs[runs.length - 1];
      if (run && previous && gap < 2 * item.size) {
        const space = gap > 0.15 * item.size && !run.text.endsWith(" ") && !item.text.startsWith(" ") ? " " : "";
        run.text += space + item.text;
        run.width = item.x + item.width - run.x;
      } else {
        runs.push({ text: item.text, x: item.x, width: item.width });
      }
      previous = item;
    }
    const chars = byX.reduce((sum, item) => sum + item.text.length, 0) || 1;
    const boldChars = byX.filter((item) => item.bold).reduce((sum, item) => sum + item.text.length, 0);
    const sizes = byX.map((item) => item.size);
    const cleanRuns = runs.map((run) => ({ ...run, text: run.text.trim() })).filter((run) => run.text.length > 0);
    return {
      text: cleanRuns.map((run) => run.text).join(" "),
      x: byX[0]!.x,
      y: byX[0]!.y,
      fontSize: Math.max(...sizes),
      bold: boldChars / chars > 0.5,
      runs: cleanRuns,
    };
  }).filter((line) => line.text.length > 0);
}

export async function extractPdf(bytes: Uint8Array): Promise<ExtractedPage[]> {
  const task = getDocument({
    // pdf.js may detach the buffer it is given — pass a copy.
    data: new Uint8Array(bytes),
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  let document;
  try {
    document = await task.promise;
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === "PasswordException") {
      throw new FileRejected("encrypted", "PDF'en er krypteret eller beskyttet med adgangskode og kan ikke læses.");
    }
    throw new FileRejected("parse_failed", "PDF'en kunne ikke læses.");
  }

  try {
    if (document.numPages > LIMITS.maxPages) {
      throw new FileRejected("too_many_pages", `PDF'en har flere end ${LIMITS.maxPages} sider.`);
    }
    const pages: ExtractedPage[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      // Loads the page's fonts so their real names (and thereby weight) are known.
      await page.getOperatorList();
      const items: RawItem[] = [];
      for (const item of content.items) {
        if (!("str" in item) || item.str.trim().length === 0) continue;
        const [, , c, d, x, y] = item.transform as number[];
        const font = page.commonObjs.has(item.fontName) ? (page.commonObjs.get(item.fontName) as { name?: string; bold?: boolean }) : null;
        items.push({
          text: item.str,
          x: x ?? 0,
          y: y ?? 0,
          width: item.width,
          size: Math.round(Math.hypot(c ?? 0, d ?? 0) * 10) / 10 || 10,
          bold: Boolean(font?.bold) || BOLD_FONT.test(font?.name ?? ""),
        });
      }
      const lines = groupLines(items);
      pages.push({ pageNumber, hasTextLayer: lines.length > 0, lines });
      page.cleanup();
    }
    return pages;
  } finally {
    await task.destroy();
  }
}
