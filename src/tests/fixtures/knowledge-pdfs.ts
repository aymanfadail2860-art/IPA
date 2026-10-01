import { createHash } from "node:crypto";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/**
 * ⚠ TEST FIXTURES — fictional PDFs built at test time (pdf-lib, devDependency). The content
 * is obviously fictional ("Testprodukt …") and never resembles real insurance terms.
 */

export interface PdfLine {
  text: string;
  /** Font size in points (default 10). Headings use larger sizes. */
  size?: number;
  bold?: boolean;
  /** Left indent in points (lists, table cells). */
  indent?: number;
  /** Extra space before the line, in points. */
  spaceBefore?: number;
  /** Several text runs on the same baseline at the given x offsets (simple tables). */
  cells?: { text: string; x: number }[];
}

export interface PdfPage {
  lines: PdfLine[];
  /** A page without a text layer (only a drawn rectangle) — like a scanned page. */
  imageOnly?: boolean;
  header?: string;
  footer?: string;
}

export async function buildPdf(pages: PdfPage[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Fiktivt testdokument");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  for (const spec of pages) {
    const page = pdf.addPage([595, 842]);
    if (spec.imageOnly) {
      page.drawRectangle({ x: 60, y: 300, width: 400, height: 300, color: rgb(0.85, 0.85, 0.85) });
      continue;
    }
    if (spec.header) page.drawText(spec.header, { x: 60, y: 810, size: 8, font: regular });
    if (spec.footer) page.drawText(spec.footer, { x: 60, y: 30, size: 8, font: regular });
    let y = 780;
    for (const line of spec.lines) {
      const size = line.size ?? 10;
      y -= (line.spaceBefore ?? 0) + size * 1.4;
      const font = line.bold ? bold : regular;
      if (line.cells) {
        for (const cell of line.cells) page.drawText(cell.text, { x: 60 + cell.x, y, size, font });
      } else {
        page.drawText(line.text, { x: 60 + (line.indent ?? 0), y, size, font });
      }
    }
  }
  return pdf.save({ useObjectStreams: false });
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** A short, valid one-page fictional PDF with a unique marker (for upload tests). */
export async function simplePdf(marker: string): Promise<Uint8Array> {
  return buildPdf([
    {
      lines: [
        { text: "Testprodukt Ansvar (fiktiv) — testbetingelser", size: 16, bold: true },
        { text: `Testmarkør ${marker}`, spaceBefore: 6 },
        { text: "Denne tekst er fiktiv og bruges kun i automatiske tests." },
      ],
    },
  ]);
}
