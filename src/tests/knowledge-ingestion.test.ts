import { beforeAll, describe, expect, it } from "vitest";

import { chunkDocument, DEFAULT_CHUNKER_CONFIG, type Chunk } from "../../workers/ingestion/chunker.ts";
import { extractPdf } from "../../workers/ingestion/extract.ts";
import { normalizePages } from "../../workers/ingestion/normalize.ts";
import { processJob, type ClaimedJob, type WorkerDb } from "../../workers/ingestion/pipeline.ts";
import { buildQualityReport } from "../../workers/ingestion/quality.ts";
import { splitSentences, structurePages, type StructuredDocument } from "../../workers/ingestion/structure.ts";
import { FileRejected } from "../../workers/ingestion/types.ts";
import { declaresEncryption, validateOriginal } from "../../workers/ingestion/validate.ts";

import {
  buildPdf,
  longListFixturePages,
  longSectionFixturePages,
  partlyScannedFixturePages,
  sha256,
  termsFixturePages,
} from "./fixtures/knowledge-pdfs";

/** Fase 7, trin 3 — validering, udtræk, normalisering, strukturering og chunking (docs/07 §5–6). */

async function ingest(pages: Parameters<typeof buildPdf>[0]) {
  const bytes = await buildPdf(pages);
  const extracted = await extractPdf(bytes);
  const normalized = normalizePages(extracted);
  const document = structurePages(normalized.pages);
  return { bytes, extracted, normalized, document };
}

/** docs/07 §6: text is exactly the normalized text in [charStart, charEnd). */
function expectTraceable(document: StructuredDocument, chunks: Chunk[]) {
  for (const chunk of chunks) {
    expect(document.text.slice(chunk.charStart, chunk.charEnd), `chunk ${chunk.chunkIndex}`).toBe(chunk.text);
    expect(chunk.charCount).toBe(chunk.text.length);
    expect(chunk.pageEnd).toBeGreaterThanOrEqual(chunk.pageStart);
  }
}

/** A chunk never crosses a heading. */
function expectNoHeadingInside(document: StructuredDocument, chunks: Chunk[]) {
  const headings = document.blocks.filter((block) => block.kind === "heading");
  for (const chunk of chunks) {
    for (const heading of headings) {
      expect(heading.start >= chunk.charStart && heading.end <= chunk.charEnd, `chunk ${chunk.chunkIndex} vs "${heading.text}"`).toBe(false);
    }
  }
}

describe("validation of originals (docs/07 §5.2, B-14)", () => {
  it("accepts a PDF whose checksum matches", async () => {
    const bytes = await buildPdf(termsFixturePages());
    expect(validateOriginal(bytes, sha256(bytes)).checksum).toBe(sha256(bytes));
  });

  it("rejects files that are not PDFs, even with a .pdf name", () => {
    const docx = new TextEncoder().encode("PK\u0003\u0004word/document.xml");
    expect(() => validateOriginal(docx, sha256(docx))).toThrow(FileRejected);
    try {
      validateOriginal(docx, sha256(docx));
    } catch (error) {
      expect((error as FileRejected).code).toBe("not_pdf");
    }
  });

  it("rejects a file that differs from the declared checksum", async () => {
    const bytes = await buildPdf(termsFixturePages());
    expect(() => validateOriginal(bytes, "0".repeat(64))).toThrow(/kontrolsummen/);
  });

  it("detects encrypted / password-protected PDFs", () => {
    const encrypted = new TextEncoder().encode("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer\n<< /Root 1 0 R /Encrypt 5 0 R >>\n%%EOF");
    expect(declaresEncryption(encrypted)).toBe(true);
    expect(() => validateOriginal(encrypted, sha256(encrypted))).toThrow(/krypteret/);
  });

  it("rejects empty files", () => {
    expect(() => validateOriginal(new Uint8Array(), sha256(new Uint8Array()))).toThrow(/tom/);
  });
});

describe("extraction, normalization and structure", () => {
  let result: Awaited<ReturnType<typeof ingest>>;
  beforeAll(async () => {
    result = await ingest(termsFixturePages());
  });

  it("extracts every page with text, position, size and weight", () => {
    expect(result.extracted).toHaveLength(4);
    expect(result.extracted.every((page) => page.hasTextLayer)).toBe(true);
    const title = result.extracted[0]!.lines.find((line) => line.text.startsWith("Testbetingelser for"));
    expect(title).toMatchObject({ bold: true, fontSize: 16 });
  });

  it("removes repeated page headers and footers and counts them", () => {
    expect(result.normalized.stats.headerFooterLinesRemoved).toBe(8);
    expect(result.document.text).not.toContain("Side 2 af 4");
    expect(result.document.text).not.toContain("· Testbetingelser");
    expect(result.normalized.stats.encodingWarnings).toEqual([]);
  });

  it("recognizes headings with levels and section numbers", () => {
    const headings = result.document.blocks.filter((block) => block.kind === "heading");
    expect(headings.map((heading) => [heading.text, heading.level, heading.sectionNumber])).toEqual([
      ["Testbetingelser for Testprodukt Ansvar (fiktiv)", 1, null],
      ["§ 1 Hvem er dækket", 2, "1"],
      ["§ 2 Hvor dækker forsikringen", 2, "2"],
      ["§ 3 Dækningssummer", 2, "3"],
      ["§ 4 Undtagelser", 2, "4"],
      ["4.1 Forurening", 3, "4.1"],
      ["4.2 Andre undtagelser", 3, "4.2"],
      ["§ 5 Anmeldelse af skade", 2, "5"],
      ["§ 6 Ophør", 2, "6"],
    ]);
  });

  it("joins a hyphenated line break and keeps Danish characters (NFC)", () => {
    expect(result.document.text).toContain("Sverige. Forsikringen dækker ikke arbejde uden for Europa.");
    expect(result.document.text).toContain("æ");
    expect(result.document.text.normalize("NFC")).toBe(result.document.text);
  });

  it("finds the list with its items and the table with its rows", () => {
    const list = result.document.blocks.find((block) => block.kind === "list");
    expect(list?.kind === "list" && list.items.map((item) => item.text)).toEqual([
      "• skade på ting, som testvirksomheden har til opbevaring",
      "• skade forvoldt med forsæt",
      "• bøder og andre strafferetlige sanktioner",
    ]);
    const table = result.document.blocks.find((block) => block.kind === "table");
    expect(table?.kind === "table" && table.rows.map((row) => row.cells)).toEqual([
      ["Dækning", "Sum", "Selvrisiko"],
      ["Personskade", "10 mio. kr.", "5.000 kr."],
      ["Tingskade", "5 mio. kr.", "5.000 kr."],
      ["Forurening", "1 mio. kr.", "10.000 kr."],
    ]);
    expect(table?.kind === "table" && table.uncertain).toBe(false);
  });

  it("continues a paragraph over a page break and maps pages to the normalized text", () => {
    expect(result.document.text).toContain("testselskabets fiktive skadeafdeling.");
    const pages = result.document.pages;
    expect(pages.map((page) => page.pageNumber)).toEqual([1, 2, 3, 4]);
    for (let i = 1; i < pages.length; i += 1) expect(pages[i]!.start).toBeGreaterThanOrEqual(pages[i - 1]!.end);
    expect(result.document.text.slice(pages[1]!.start, pages[1]!.end)).toContain("§ 3 Dækningssummer");
  });

  it("does not split sentences after Danish abbreviations", () => {
    const sentences = splitSentences("Dækningen gælder, jf. § 4 stk. 2. Den gælder f.eks. ved montage. Slut.");
    expect(sentences).toHaveLength(3);
  });
});

describe("structure-aware chunking (docs/07 §6)", () => {
  it("keeps chunks traceable, inside one section and with the full heading chain", async () => {
    const { document } = await ingest(termsFixturePages());
    const chunks = chunkDocument(document);
    expectTraceable(document, chunks);
    expectNoHeadingInside(document, chunks);

    const pollution = chunks.find((chunk) => chunk.text.includes("gradvis forurening"))!;
    expect(pollution.headingPath).toEqual(["Testbetingelser for Testprodukt Ansvar (fiktiv)", "§ 4 Undtagelser", "4.1 Forurening"]);
    expect(pollution.heading).toBe("4.1 Forurening");
    expect(pollution.sectionNumber).toBe("4.1");
    expect(pollution.pageStart).toBe(2);

    const notification = chunks.find((chunk) => chunk.text.includes("hurtigst muligt"))!;
    expect([notification.pageStart, notification.pageEnd]).toEqual([3, 4]);
  });

  it("keeps a list's lead-in in the same chunk as its items", async () => {
    const { document } = await ingest(termsFixturePages());
    const chunk = chunkDocument(document).find((entry) => entry.text.includes("skade forvoldt med forsæt"))!;
    expect(chunk.kind).toBe("list");
    expect(chunk.text).toContain("Forsikringen dækker ikke:");
    expect(chunk.text.indexOf("Forsikringen dækker ikke:")).toBeLessThan(chunk.text.indexOf("• skade på ting"));
  });

  it("makes a table its own chunk, never mixed with prose", async () => {
    const { document } = await ingest(termsFixturePages());
    const table = chunkDocument(document).find((chunk) => chunk.kind === "table")!;
    expect(table.text).toBe(
      "Dækning | Sum | Selvrisiko\nPersonskade | 10 mio. kr. | 5.000 kr.\nTingskade | 5 mio. kr. | 5.000 kr.\nForurening | 1 mio. kr. | 10.000 kr.",
    );
  });

  it("repeats the lead-in in every chunk of a split list", async () => {
    const { document } = await ingest(longListFixturePages());
    const chunks = chunkDocument(document, { ...DEFAULT_CHUNKER_CONFIG, targetChars: 400, maxChars: 800 });
    expectTraceable(document, chunks);
    const listChunks = chunks.filter((chunk) => chunk.kind === "list");
    expect(listChunks.length).toBeGreaterThan(2);
    expect(listChunks[0]!.text.startsWith("Forsikringen dækker heller ikke:")).toBe(true);
    expect(listChunks[0]!.leadIn).toBeNull();
    for (const chunk of listChunks.slice(1)) {
      expect(chunk.leadIn).toBe("Forsikringen dækker heller ikke:");
      expect(chunk.text.startsWith("• fiktiv undtagelse")).toBe(true);
    }
    const allItems = listChunks.flatMap((chunk) => chunk.text.split("\n").filter((line) => line.startsWith("•")));
    expect(allItems).toHaveLength(24);
  });

  it("repeats the header row when a table is split", async () => {
    const { document } = await ingest(termsFixturePages());
    const tables = chunkDocument(document, { ...DEFAULT_CHUNKER_CONFIG, targetChars: 80, maxChars: 160 }).filter(
      (chunk) => chunk.kind === "table",
    );
    expect(tables.length).toBeGreaterThan(1);
    expect(tables[0]!.text.startsWith("Dækning | Sum | Selvrisiko")).toBe(true);
    for (const chunk of tables.slice(1)) expect(chunk.leadIn).toBe("Dækning | Sum | Selvrisiko");
  });

  it("overlaps at most two sentences within a section and never across a heading", async () => {
    const { document } = await ingest(longSectionFixturePages());
    const config = { ...DEFAULT_CHUNKER_CONFIG, targetChars: 400, maxChars: 800 };
    const chunks = chunkDocument(document, config);
    expectTraceable(document, chunks);
    expectNoHeadingInside(document, chunks);
    const section8 = chunks.filter((chunk) => chunk.sectionNumber === "8");
    expect(section8.length).toBeGreaterThan(1);
    expect(section8[0]!.overlapChars).toBe(0);
    for (const chunk of section8.slice(1)) {
      expect(chunk.overlapChars).toBeGreaterThan(0);
      expect(chunk.overlapChars).toBeLessThanOrEqual(config.targetChars * config.overlapMaxRatio);
      expect(splitSentences(chunk.text.slice(0, chunk.overlapChars)).length).toBeLessThanOrEqual(2);
    }
    const section9 = chunks.find((chunk) => chunk.sectionNumber === "9")!;
    expect(section9.overlapChars).toBe(0);
  });

  it("splits a paragraph longer than the maximum only at sentence boundaries", async () => {
    const { document } = await ingest(longSectionFixturePages());
    const chunks = chunkDocument(document, { ...DEFAULT_CHUNKER_CONFIG, targetChars: 120, maxChars: 150 });
    expectTraceable(document, chunks);
    for (const chunk of chunks.filter((entry) => entry.kind === "prose")) expect(chunk.text).toMatch(/[.!?]$/);
  });

  it("is deterministic", async () => {
    const { document } = await ingest(termsFixturePages());
    expect(chunkDocument(document)).toEqual(chunkDocument(document));
  });
});

describe("quality report (docs/07 §5.3)", () => {
  it("reports a page without a text layer — approval will be blocked (B-11)", async () => {
    const { document, normalized } = await ingest(partlyScannedFixturePages());
    const report = buildQualityReport({
      document,
      chunks: chunkDocument(document),
      normalization: normalized.stats,
      extractorVersion: "x",
      chunkerVersion: "y",
    });
    expect(report.pages).toEqual({ total: 2, read: 1, without_text: [2], all_read: false });
    expect(report.structure.recognized).toBe(true);
  });
});

describe("pipeline (docs/07 §5.2)", () => {
  function fakeDb(overrides: Partial<WorkerDb> = {}) {
    const calls: string[] = [];
    const db: WorkerDb = {
      claim: async () => null,
      embeddingModels: async () => [],
      chunksToEmbed: async () => [],
      storeEmbeddings: async (_job, _model, rows) => rows.length,
      verifyIndex: async () => [],
      heartbeat: async () => void calls.push("heartbeat"),
      checkpoint: async (_job, step) => void calls.push(`checkpoint:${step}`),
      storePages: async () => void calls.push("storePages"),
      storeChunks: async (_job, chunks) => {
        calls.push(`storeChunks:${chunks.length}`);
        return chunks.length;
      },
      complete: async () => void calls.push("complete"),
      fail: async (_job, code, _message, retryable) => {
        calls.push(`fail:${code}:${retryable}`);
        return retryable ? "retry" : "failed";
      },
      ...overrides,
    };
    return { db, calls };
  }

  const job = (bytes: Uint8Array, stepState: ClaimedJob["step_state"] = {}): ClaimedJob => ({
    job_id: "job",
    version_id: "version",
    kind: "process",
    attempts: 1,
    max_attempts: 3,
    step_state: stepState,
    storage_path: "a/b/original.pdf",
    checksum_sha256: sha256(bytes),
  });

  it("runs validation → extraction → chunking → complete", async () => {
    const bytes = await buildPdf(termsFixturePages());
    const { db, calls } = fakeDb();
    const outcome = await processJob(job(bytes), { db, originals: { download: async () => bytes }, log: () => {} });
    expect(outcome).toBe("succeeded");
    expect(calls[0]).toBe("checkpoint:validation");
    expect(calls).toContain("storePages");
    expect(calls.some((call) => call.startsWith("storeChunks:"))).toBe(true);
    expect(calls[calls.length - 1]).toBe("complete");
  });

  it("fails without retry when the PDF has no text layer (no OCR)", async () => {
    const bytes = await buildPdf([{ lines: [], imageOnly: true }]);
    const { db, calls } = fakeDb();
    const outcome = await processJob(job(bytes), { db, originals: { download: async () => bytes }, log: () => {} });
    expect(outcome).toBe("failed");
    expect(calls).toContain("fail:no_text:false");
  });

  it("retries temporary errors and never puts document content in the error", async () => {
    const bytes = await buildPdf(termsFixturePages());
    let message = "";
    const { db } = fakeDb({
      storeChunks: async () => {
        throw new Error("connection reset — Forsikringen dækker ikke");
      },
      fail: async (_job, _code, text, retryable) => {
        message = text;
        return retryable ? "retry" : "failed";
      },
    });
    const outcome = await processJob(job(bytes), { db, originals: { download: async () => bytes }, log: () => {} });
    expect(outcome).toBe("retry");
    expect(message).not.toContain("Forsikringen");
  });

  it("resumes after the chunking checkpoint without downloading the file again", async () => {
    const bytes = await buildPdf(termsFixturePages());
    const { db: first } = fakeDb();
    let state: ClaimedJob["step_state"] = {};
    first.checkpoint = async (_job, step, value) => void (state = { ...state, [step]: value });
    await processJob(job(bytes), { db: first, originals: { download: async () => bytes }, log: () => {} });

    const { db, calls } = fakeDb();
    let downloaded = false;
    const outcome = await processJob(job(bytes, state), {
      db,
      originals: {
        download: async () => {
          downloaded = true;
          return bytes;
        },
      },
      log: () => {},
    });
    expect(outcome).toBe("succeeded");
    expect(downloaded).toBe(false);
    expect(calls).not.toContain("storePages");
    expect(calls.some((call) => call.startsWith("storeChunks"))).toBe(false);
    expect(calls[calls.length - 1]).toBe("complete");
  });
});
