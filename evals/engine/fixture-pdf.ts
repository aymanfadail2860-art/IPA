import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib";

/**
 * ⚠ EVALUATION MATERIAL — fictional fixture documents (evals/retrieval/fixtures) rendered as
 * PDFs, so the evaluation environment ingests them through exactly the same path as every other
 * document: upload to quarantine, scanning, extraction, structuring, chunking, embedding,
 * review and publication (docs/08b §4.5). pdf-lib is a devDependency: this runs only in the
 * evaluation tooling, never in the application or the worker.
 *
 * Headings are larger and bold (the structure step recognises them), body text wraps within the
 * page width, and a long document continues on new pages.
 */

export interface PdfSection {
  heading: string;
  text: string;
}

const PAGE = { width: 595, height: 842, margin: 60 };
const BODY = 10;
const HEADING = 13;
const TITLE = 16;

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width || !line) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function sectionsToPdf(title: string, sections: readonly PdfSection[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const width = PAGE.width - 2 * PAGE.margin;
  let page = pdf.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - PAGE.margin;

  const draw = (text: string, size: number, font: PDFFont, spaceBefore = 0) => {
    const step = spaceBefore + size * 1.4;
    if (y - step < PAGE.margin) {
      page = pdf.addPage([PAGE.width, PAGE.height]);
      y = PAGE.height - PAGE.margin;
    }
    y -= step;
    page.drawText(text, { x: PAGE.margin, y, size, font });
  };

  for (const line of wrap(title, bold, TITLE, width)) draw(line, TITLE, bold);
  for (const section of sections) {
    wrap(section.heading, bold, HEADING, width).forEach((line, i) => draw(line, HEADING, bold, i === 0 ? 10 : 0));
    wrap(section.text, regular, BODY, width).forEach((line, i) => draw(line, BODY, regular, i === 0 ? 4 : 0));
  }
  return pdf.save({ useObjectStreams: false });
}
