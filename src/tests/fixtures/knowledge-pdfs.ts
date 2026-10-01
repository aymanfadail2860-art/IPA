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

const HEADER = "Testprodukt Ansvar (fiktiv) · Testbetingelser";

function page(lines: PdfLine[], number: number, total: number): PdfPage {
  return { lines, header: HEADER, footer: `Side ${number} af ${total}` };
}

/**
 * Fictional terms with the structures docs/07 §6 cares about: a title, numbered sections
 * (§ 1, § 4, 4.1, 4.2), a list with a lead-in, a hyphenated line break, Danish
 * abbreviations, a table and a paragraph that continues over a page break. Repeated page
 * headers and footers ("Side N af 4") must be removed.
 */
export function termsFixturePages(): PdfPage[] {
  const total = 4;
  return [
    page(
      [
        { text: "Testbetingelser for Testprodukt Ansvar (fiktiv)", size: 16, bold: true },
        { text: "§ 1 Hvem er dækket", size: 13, bold: true, spaceBefore: 10 },
        { text: "Forsikringen dækker testvirksomheden og dens ansatte under udførelse af arbejdet.", spaceBefore: 4 },
        { text: "Dækningen gælder også for midlertidigt ansatte, jf. § 4 stk. 2. Den gælder ikke for" },
        { text: "underleverandører, medmindre det er aftalt skriftligt med testselskabet." },
        { text: "§ 2 Hvor dækker forsikringen", size: 13, bold: true, spaceBefore: 10 },
        { text: "Forsikringen dækker i Danmark. Ved arbejde i udlandet skal det aftales særskilt, f.eks.", spaceBefore: 4 },
        { text: "ved montage i Sverige. Forsik-" },
        { text: "ringen dækker ikke arbejde uden for Europa." },
      ],
      1,
      total,
    ),
    page(
      [
        { text: "§ 3 Dækningssummer", size: 13, bold: true },
        { text: "Dækningssummerne fremgår af tabellen nedenfor.", spaceBefore: 4 },
        { text: "", cells: [{ text: "Dækning", x: 0 }, { text: "Sum", x: 200 }, { text: "Selvrisiko", x: 320 }], spaceBefore: 8, bold: true },
        { text: "", cells: [{ text: "Personskade", x: 0 }, { text: "10 mio. kr.", x: 200 }, { text: "5.000 kr.", x: 320 }] },
        { text: "", cells: [{ text: "Tingskade", x: 0 }, { text: "5 mio. kr.", x: 200 }, { text: "5.000 kr.", x: 320 }] },
        { text: "", cells: [{ text: "Forurening", x: 0 }, { text: "1 mio. kr.", x: 200 }, { text: "10.000 kr.", x: 320 }] },
        { text: "§ 4 Undtagelser", size: 13, bold: true, spaceBefore: 10 },
        { text: "4.1 Forurening", size: 11, bold: true, spaceBefore: 6 },
        { text: "Forsikringen dækker ikke skade som følge af gradvis forurening af jord, luft eller", spaceBefore: 4 },
        { text: "vand. Pludselig og uforudset forurening er dækket med den sum, der fremgår af § 3." },
        { text: "4.2 Andre undtagelser", size: 11, bold: true, spaceBefore: 6 },
        { text: "Forsikringen dækker ikke:", spaceBefore: 4 },
        { text: "• skade på ting, som testvirksomheden har til opbevaring", indent: 10 },
        { text: "• skade forvoldt med forsæt", indent: 10 },
        { text: "• bøder og andre strafferetlige sanktioner", indent: 10 },
        { text: "Undtagelserne gælder uanset den skadelidtes forhold.", spaceBefore: 8 },
      ],
      2,
      total,
    ),
    page(
      [
        { text: "§ 5 Anmeldelse af skade", size: 13, bold: true },
        { text: "En skade skal anmeldes til testselskabet hurtigst muligt og senest 30 dage efter, at", spaceBefore: 4 },
        { text: "testvirksomheden blev bekendt med skaden. Anmeldelsen skal indeholde en beskrivelse af" },
        { text: "skaden og af hændelsesforløbet, og den skal ske skriftligt til testselskabets fiktive" },
      ],
      3,
      total,
    ),
    page(
      [
        { text: "skadeafdeling. Testselskabet kan bede om yderligere oplysninger." },
        { text: "§ 6 Ophør", size: 13, bold: true, spaceBefore: 10 },
        { text: "Forsikringen kan opsiges af begge parter med en måneds varsel til udgangen af en måned.", spaceBefore: 4 },
      ],
      4,
      total,
    ),
  ];
}

/** A section with a long list (forces the list to be split with a repeated lead-in). */
export function longListFixturePages(items = 24): PdfPage[] {
  const lines: PdfLine[] = [
    { text: "§ 7 Særlige undtagelser", size: 13, bold: true },
    { text: "Forsikringen dækker heller ikke:", spaceBefore: 4 },
  ];
  for (let i = 1; i <= items; i += 1) {
    lines.push({ text: `• fiktiv undtagelse nummer ${i}, som kun findes i dette testdokument`, indent: 10 });
  }
  return [{ lines }];
}

/** A section with many short sentences (forces overlap between chunks in the same section). */
export function longSectionFixturePages(): PdfPage[] {
  const lines: PdfLine[] = [{ text: "§ 8 Fiktive forpligtelser", size: 13, bold: true }];
  for (let i = 1; i <= 12; i += 1) {
    lines.push({ text: `Testvirksomheden skal overholde fiktiv forpligtelse ${i}. Den gælder i hele forsikringstiden.`, spaceBefore: 8 });
  }
  lines.push({ text: "§ 9 Fiktive rettigheder", size: 13, bold: true, spaceBefore: 10 });
  lines.push({ text: "Testvirksomheden har ret til en fiktiv vejledning.", spaceBefore: 4 });
  return [{ lines }];
}

/** Two pages, the second without a text layer (like a scanned page). */
export function partlyScannedFixturePages(): PdfPage[] {
  return [
    { lines: [{ text: "§ 1 Fiktiv dækning", size: 13, bold: true }, { text: "Teksten på første side kan læses.", spaceBefore: 4 }] },
    { lines: [], imageOnly: true },
  ];
}
