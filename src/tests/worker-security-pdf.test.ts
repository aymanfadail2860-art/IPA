import { deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";

import { checkFile, detectMime } from "../../workers/ingestion/security/file-checks.ts";
import { childProcessInspector } from "../../workers/ingestion/security/inspector.ts";
import { effectiveLimits, HARD_LIMITS } from "../../workers/ingestion/security/limits.ts";
import { inspectPdf } from "../../workers/ingestion/security/pdf-inspect.ts";

import { buildPdf, sha256, simplePdf } from "./fixtures/knowledge-pdfs";
import { objectStream, rawPdf, streamObject } from "./fixtures/security-pdfs";

/**
 * 8B-I5 — structural validation and the PDF security inspection (docs/08b §21.6), on synthetic
 * fixtures. Every rejection is fail closed; nothing here parses with pdfjs.
 */

const LIMITS = HARD_LIMITS;
const declared = (bytes: Uint8Array, overrides: Partial<Parameters<typeof checkFile>[1]> = {}) => ({
  checksum: sha256(bytes),
  byteSize: bytes.byteLength,
  mime: "application/pdf",
  filename: "betingelser.pdf",
  ...overrides,
});

describe("structural validation: type, extension, MIME, checksum — before any parser", async () => {
  const pdf = await simplePdf("struktur");

  it("passes a real PDF", () => {
    expect(checkFile(pdf, declared(pdf), LIMITS)).toMatchObject({ result: "pass", detectedMime: "application/pdf", checksum: sha256(pdf) });
  });

  it.each([
    ["wrong magic bytes (a PNG named .pdf)", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]), "invalid_file_type", "image/png"],
    ["an executable named .pdf", new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]), "invalid_file_type", "application/x-msdownload"],
    ["a ZIP named .pdf", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]), "invalid_file_type", "application/zip"],
    ["HTML named .pdf", new TextEncoder().encode("<!DOCTYPE html><script>x</script>"), "invalid_file_type", "text/html"],
    ["a PDF header that is not at byte 0", new TextEncoder().encode("junk%PDF-1.7\n%%EOF\n"), "invalid_file_type", "application/octet-stream"],
  ])("rejects %s", (_name, bytes, code, mime) => {
    expect(checkFile(bytes, declared(bytes), LIMITS)).toMatchObject({ result: "fail", code, detectedMime: mime });
  });

  it("rejects an extension mismatch and a wrong MIME type even when the content is a PDF", () => {
    expect(checkFile(pdf, declared(pdf, { filename: "betingelser.exe" }), LIMITS)).toMatchObject({ result: "fail", code: "extension_mismatch" });
    expect(checkFile(pdf, declared(pdf, { filename: null }), LIMITS)).toMatchObject({ result: "fail", code: "extension_mismatch" });
    expect(checkFile(pdf, declared(pdf, { mime: "text/plain" }), LIMITS)).toMatchObject({ result: "fail", code: "mime_mismatch" });
    expect(checkFile(pdf, declared(pdf, { mime: null }), LIMITS)).toMatchObject({ result: "fail", code: "mime_mismatch" });
  });

  it("rejects bytes that are not the uploaded ones", () => {
    expect(checkFile(pdf, declared(pdf, { checksum: "0".repeat(64) }), LIMITS)).toMatchObject({ result: "fail", code: "checksum_mismatch" });
    expect(checkFile(pdf, declared(pdf, { byteSize: pdf.byteLength + 1 }), LIMITS)).toMatchObject({ result: "fail", code: "checksum_mismatch" });
  });

  it("rejects a polyglot: a PDF with another file glued on after %%EOF", () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
    const polyglot = rawPdf({ after: zip });
    expect(checkFile(polyglot, declared(polyglot), LIMITS)).toMatchObject({ result: "fail", code: "polyglot" });
    const html = rawPdf({ after: new TextEncoder().encode("<html><script>alert(1)</script></html>") });
    expect(checkFile(html, declared(html), LIMITS)).toMatchObject({ result: "fail", code: "polyglot" });
    const whitespace = rawPdf({ after: new TextEncoder().encode("\r\n  \n") });
    expect(checkFile(whitespace, declared(whitespace), LIMITS)).toMatchObject({ result: "pass" });
  });

  it("rejects a file without %%EOF and a file over the size limit", () => {
    const truncated = pdf.subarray(0, pdf.byteLength - 8);
    expect(checkFile(truncated, declared(truncated), LIMITS)).toMatchObject({ result: "fail", code: "invalid_pdf" });
    const small = effectiveLimits({ max_bytes: 100 });
    expect(checkFile(pdf, declared(pdf), small)).toMatchObject({ result: "fail", code: "too_large" });
  });

  it("detects the type from the content only", () => {
    expect(detectMime(new TextEncoder().encode("%PDF-2.0\n"))).toBe("application/pdf");
    expect(detectMime(new TextEncoder().encode("%PDF-9.9\n"))).toBe("application/octet-stream");
  });
});

describe("limits: server-side policy values, capped by hard limits nobody can raise", () => {
  it("takes lower policy values and never exceeds the hard caps", () => {
    expect(effectiveLimits({ max_bytes: 1_000, max_pages: 10 })).toMatchObject({ maxBytes: 1_000, maxPages: 10 });
    expect(effectiveLimits({ max_bytes: 10 * HARD_LIMITS.maxBytes, max_pages: 1e9, inspect_timeout_ms: 1e9 })).toEqual(HARD_LIMITS);
    expect(effectiveLimits({ max_bytes: -1, max_pages: "100", max_objects: Number.NaN })).toEqual(HARD_LIMITS);
    expect(effectiveLimits(null)).toEqual(HARD_LIMITS);
    expect(Object.isFrozen(HARD_LIMITS)).toBe(true);
  });
});

describe("PDF security inspection (structure, never a byte search)", () => {
  const inspect = (bytes: Uint8Array, limits = LIMITS) => inspectPdf(bytes, limits);
  const findings = (bytes: Uint8Array) => inspect(bytes).activeContent;

  it("passes a safe PDF — also one with ordinary links and a destination as open action", async () => {
    expect(inspect(await buildPdf([{ lines: [{ text: "Fiktiv" }] }]))).toMatchObject({ pdfSecurity: { result: "pass" }, activeContent: { result: "pass", findings: [] }, pages: 1 });
    const linked = rawPdf({
      catalog: "/OpenAction [3 0 R /Fit]",
      page: "/Annots [5 0 R 6 0 R]",
      objects: [
        "<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] /A << /S /URI /URI (https://example.test/vilkaar) >> >>",
        "<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] /A << /S /GoTo /D [3 0 R /Fit] >> >>",
      ],
    });
    expect(inspect(linked)).toMatchObject({ pdfSecurity: { result: "pass" }, activeContent: { result: "pass" } });
  });

  it.each([
    ["JavaScript as open action", { catalog: "/OpenAction 5 0 R", objects: ["<< /S /JavaScript /JS (app.alert\\(1\\)) >>"] }, ["javascript", "open_action"]],
    ["a JavaScript name tree", { catalog: "/Names << /JavaScript << /Names [(x) 5 0 R] >> >>", objects: ["<< /S /JavaScript /JS 6 0 R >>", "(inert)"] }, ["javascript"]],
    ["an OpenAction that launches a program", { catalog: "/OpenAction << /S /Launch /F (calc.exe) >>" }, ["launch", "open_action"]],
    ["additional actions (/AA) on a page", { page: "/AA << /O << /S /Named /N /Print >> >>" }, ["additional_actions"]],
    ["a Launch action on a link", { page: "/Annots [5 0 R]", objects: ["<< /Type /Annot /Subtype /Link /Rect [0 0 1 1] /A << /S /Launch /F (cmd) >> >>"] }, ["launch"]],
    ["an embedded file", { catalog: "/Names << /EmbeddedFiles << /Names [(a.exe) 5 0 R] >> >>", objects: ["<< /Type /Filespec /F (a.exe) /EF << /F 6 0 R >> >>", "<< /Type /EmbeddedFile /Length 0 >>\nstream\n\nendstream"] }, ["embedded_file"]],
    ["a file attachment annotation", { page: "/Annots [5 0 R]", objects: ["<< /Type /Annot /Subtype /FileAttachment /Rect [0 0 1 1] /FS (x.exe) >>"] }, ["file_attachment"]],
    ["RichMedia", { page: "/Annots [5 0 R]", objects: ["<< /Type /Annot /Subtype /RichMedia /Rect [0 0 1 1] /RichMediaContent << >> >>"] }, ["rich_media"]],
    ["multimedia (Screen + Rendition)", { page: "/Annots [5 0 R]", objects: ["<< /Type /Annot /Subtype /Screen /Rect [0 0 1 1] /A << /S /Rendition >> >>"] }, ["multimedia"]],
    ["an XFA form", { catalog: "/AcroForm << /Fields [] /XFA 5 0 R >>", objects: ["(xfa)"] }, ["xfa"]],
    ["a form that submits data", { page: "/Annots [5 0 R]", objects: ["<< /Type /Annot /Subtype /Widget /Rect [0 0 1 1] /A << /S /SubmitForm /F (https://x.test) >> >>"] }, ["submit_form"]],
    ["a remote GoTo (opens another file)", { page: "/Annots [5 0 R]", objects: ["<< /Type /Annot /Subtype /Link /Rect [0 0 1 1] /A << /S /GoToR /F (other.pdf) /D [0 /Fit] >> >>"] }, ["remote_goto"]],
    ["a bare /JS entry (no action type)", { page: "/Annots [5 0 R]", objects: ["<< /Type /Annot /Subtype /Widget /Rect [0 0 1 1] /A << /JS (x) >> >>"] }, ["javascript"]],
    ["a /JavaScript name tree with untyped entries", { catalog: "/Names << /JavaScript 5 0 R >>", objects: ["<< /Names [(x) 6 0 R] >>", "<< /JS (inert) >>"] }, ["javascript"]],
    ["an obfuscated name (/J#61vaScript)", { catalog: "/OpenAction 5 0 R", objects: ["<< /S /J#61vaScript /J#53 (x) >>"] }, ["javascript", "open_action"]],
    ["a GoTo open action chained to JavaScript (/Next)", { catalog: "/OpenAction << /S /GoTo /D [3 0 R /Fit] /Next 5 0 R >>", objects: ["<< /S /JavaScript /JS (x) >>"] }, ["javascript", "open_action"]],
  ])("rejects %s", (_name, options, expected) => {
    const result = findings(rawPdf(options));
    expect(result.result).toBe("fail");
    expect(result.findings).toEqual(expect.arrayContaining(expected));
  });

  it("finds JavaScript hidden in a compressed object stream (real pdf-lib output)", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdf.addJavaScript("hej", "console.println('inert');");
    const bytes = await pdf.save({ useObjectStreams: true });
    expect(findings(new Uint8Array(bytes)).findings).toContain("javascript");
  });

  it("finds a real attachment (pdf-lib) without unpacking it", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    await pdf.attach(new TextEncoder().encode("MZ fiktiv"), "program.exe", { mimeType: "application/octet-stream" });
    expect(findings(new Uint8Array(await pdf.save())).findings).toContain("embedded_file");
  });

  it("finds actions in a hand-made object stream", () => {
    const bytes = rawPdf({ catalog: "/OpenAction 6 0 R", objects: [objectStream([[6, "<< /S /Launch /F (x) >>"]])] });
    expect(findings(bytes).findings).toEqual(expect.arrayContaining(["launch", "open_action"]));
  });

  it("rejects an encrypted PDF without trying any password", () => {
    const result = inspect(rawPdf({ trailer: "/Encrypt 5 0 R /ID [<00> <00>]", objects: ["<< /Filter /Standard /V 2 /R 3 /O <00> /U <00> /P -4 >>"] }));
    expect(result).toEqual({ pdfSecurity: { result: "fail", code: "encrypted_pdf" }, activeContent: { result: "not_run", findings: [] }, pages: null });
  });

  it.each([
    ["truncated", () => rawPdf().subarray(0, 300)],
    ["garbage between objects", () => new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\nGARBAGE\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n")],
    ["no catalog or pages", () => new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<< /A 1 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n")],
    ["an unterminated string", () => new TextEncoder().encode("%PDF-1.7\n1 0 obj\n(never closed\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n")],
    ["an invalid name escape", () => rawPdf({ catalog: "/Bad#ZZ 1" })],
    ["an object stream with a filter that cannot be inspected safely", () => rawPdf({ objects: [streamObject("/Type /ObjStm /N 1 /First 4 /Filter /LZWDecode", new Uint8Array([1, 2, 3]))] })],
    ["an xref entry pointing into a stream (parser differential)", () => rawPdf({ xrefOverride: [4, 300] })],
    ["valid magic bytes with nothing behind them", () => new TextEncoder().encode("%PDF-1.7\n%%EOF\n")],
  ])("fails closed on a malformed PDF: %s", (_name, build) => {
    const result = inspect(build());
    expect(result.pdfSecurity.result).toBe("fail");
    expect(result.activeContent.result).toBe("not_run");
  });

  it("stops resource abuse: decompression bombs, deep nesting, too many objects, too many pages", () => {
    const bomb = streamObject("/Type /ObjStm /N 1 /First 4 /Filter /FlateDecode", new Uint8Array(deflateSync(Buffer.alloc(30 * 1024 * 1024))));
    expect(inspect(rawPdf({ objects: [bomb] })).pdfSecurity).toEqual({ result: "fail", code: "resource_limit" });
    const ratio = streamObject("/Type /ObjStm /N 1 /First 4 /Filter /FlateDecode", new Uint8Array(deflateSync(Buffer.alloc(2 * 1024 * 1024))));
    expect(inspect(rawPdf({ objects: [ratio] })).pdfSecurity).toEqual({ result: "fail", code: "resource_limit" });
    const deep = rawPdf({ objects: ["[".repeat(100) + "]".repeat(100)] });
    expect(inspect(deep).pdfSecurity).toEqual({ result: "fail", code: "resource_limit" });
    expect(inspect(rawPdf({ objects: Array(20).fill("<< >>") }), effectiveLimits({ max_objects: 10 })).pdfSecurity).toEqual({ result: "fail", code: "too_many_objects" });
    expect(inspect(rawPdf(), effectiveLimits({ max_pages: 0.5 })).pdfSecurity).toMatchObject({ result: "fail" });
    const declaredPages = rawPdf({ objects: ["<< /Type /Pages /Count 999999 /Kids [] >>"] });
    expect(inspect(declaredPages).pdfSecurity).toEqual({ result: "fail", code: "too_many_pages" });
  });

  it("tolerates an xref offset on the line break before an object header — and nothing else", () => {
    const exact = rawPdf();
    const text = Buffer.from(exact).toString("latin1");
    const header = text.indexOf("4 0 obj");
    expect(inspect(rawPdf({ xrefOverride: [4, header - 1] })).pdfSecurity).toEqual({ result: "pass" });
    expect(inspect(rawPdf({ xrefOverride: [4, header + 1] })).pdfSecurity).toMatchObject({ result: "fail", code: "invalid_pdf" });
    expect(inspect(rawPdf({ xrefOverride: [3, header] })).pdfSecurity).toMatchObject({ result: "fail", code: "invalid_pdf" });
  });

  it("does not use a byte search: a harmless string mentioning /JavaScript is not a finding", () => {
    const bytes = rawPdf({ objects: ["<< /Title (Om /JavaScript og /Launch i PDF) >>"] });
    expect(findings(bytes)).toEqual({ result: "pass", findings: [] });
  });

  it("reports page count from the structure", async () => {
    expect(inspect(await buildPdf([{ lines: [{ text: "a" }] }, { lines: [{ text: "b" }] }])).pages).toBe(2);
  });
});

describe("the inspection child process (isolation)", () => {
  const inspector = childProcessInspector();

  it("inspects in a separate process and returns the same verdict", async () => {
    const safe = await simplePdf("barn");
    expect(await inspector.inspect(safe, LIMITS)).toMatchObject({ pdfSecurity: { result: "pass" }, activeContent: { result: "pass" }, pages: 1 });
    const active = rawPdf({ catalog: "/OpenAction << /S /Launch /F (x) >>" });
    expect((await inspector.inspect(active, LIMITS)).activeContent.findings).toEqual(expect.arrayContaining(["launch"]));
  });

  it("a timeout kills the child and is never a pass", async () => {
    const result = await inspector.inspect(await simplePdf("tid"), effectiveLimits({ inspect_timeout_ms: 1 }));
    expect(result).toEqual({ pdfSecurity: { result: "error", code: "inspection_timeout" }, activeContent: { result: "not_run", findings: [] }, pages: null });
  });

  it("a crash or unreadable output is never a pass", async () => {
    const crashing = childProcessInspector({ childPath: "/nonexistent/inspect-child.ts" });
    expect((await crashing.inspect(await simplePdf("x"), LIMITS)).pdfSecurity).toEqual({ result: "error", code: "inspection_failed" });
  });

  it("the child gets an empty environment — no database, storage or AWS credentials", async () => {
    const probe = new URL("./fixtures/env-probe-child.mjs", import.meta.url).pathname;
    process.env.IPA_TEST_SECRET_PROBE = "must-not-leak";
    try {
      const result = await childProcessInspector({ childPath: probe }).inspect(new Uint8Array([1]), LIMITS);
      expect(result.pages).toBe(0);
    } finally {
      delete process.env.IPA_TEST_SECRET_PROBE;
    }
  });
});
