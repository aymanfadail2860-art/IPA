import type { SecurityLimits } from "./limits.ts";
import { PdfStructureError, pdfName, readPdfStructure, type PdfValue } from "./pdf-structure.ts";

/**
 * PDF security inspection, V1 policy "pdf-v1" (docs/08b §21.6). It works on the PDF STRUCTURE
 * read by pdf-structure.ts (every dictionary, including those inside object streams) — never a
 * raw byte search, and never pdfjs: an unscanned file does not reach the pipeline's document
 * parser before its verdict is safe. (After release, extraction cross-checks the same rules
 * with pdfjs's own view: parser-crosscheck.ts.)
 *
 * REJECTED in V1 (any occurrence):
 *   * JavaScript: /JS, /JavaScript (keys, name trees, /S /JavaScript actions)
 *   * /Launch, /SubmitForm, /ImportData, /GoToR, /GoToE actions
 *   * /AA (additional actions) anywhere
 *   * /OpenAction that is anything but a page destination or a /GoTo action
 *   * embedded files and attachments: /EmbeddedFiles, /EF, /Type /EmbeddedFile, /FileAttachment
 *   * RichMedia and multimedia: /RichMedia*, /Screen, /Movie, /Sound, /3D, /Rendition
 *   * XFA forms (/XFA)
 *   * encryption (/Encrypt) — no password is ever tried
 * ALLOWED: ordinary link annotations, including /URI links (they open nothing by themselves)
 * and /GoTo, /Named, /Thread and similar navigation actions.
 *
 * Anything that cannot be read reliably is a failure, never a pass (fail closed).
 */

export type Finding =
  | "javascript"
  | "launch"
  | "open_action"
  | "additional_actions"
  | "embedded_file"
  | "file_attachment"
  | "rich_media"
  | "multimedia"
  | "xfa"
  | "submit_form"
  | "import_data"
  | "remote_goto"
  | "embedded_goto";

export type PdfSecurityCode = "invalid_pdf" | "encrypted_pdf" | "too_many_pages" | "too_many_objects" | "resource_limit" | "inspection_timeout" | "inspection_failed";

export interface InspectionResult {
  pdfSecurity: { result: "pass" } | { result: "fail" | "error"; code: PdfSecurityCode };
  activeContent: { result: "pass" | "fail" | "not_run"; findings: Finding[] };
  pages: number | null;
}

const ACTIONS: Record<string, Finding> = {
  JavaScript: "javascript",
  Launch: "launch",
  SubmitForm: "submit_form",
  ImportData: "import_data",
  GoToR: "remote_goto",
  GoToE: "embedded_goto",
  Rendition: "multimedia",
  Movie: "multimedia",
  Sound: "multimedia",
  RichMediaExecute: "rich_media",
};
export const ANNOTATIONS: Readonly<Record<string, Finding>> = {
  FileAttachment: "file_attachment",
  RichMedia: "rich_media",
  Screen: "multimedia",
  Movie: "multimedia",
  Sound: "multimedia",
  "3D": "multimedia",
};

export function structuralFindings(bytes: Uint8Array, limits: SecurityLimits): { findings: Set<Finding>; pages: number } {
  const structure = readPdfStructure(bytes, limits);
  const findings = new Set<Finding>();
  const resolve = (value: PdfValue | undefined): PdfValue | undefined => {
    for (let hops = 0; value?.t === "ref" && hops < 8; hops += 1) value = structure.objects.get(value.n);
    return value;
  };

  let pages = 0;
  let declaredPages = 0;
  for (const dict of structure.dictionaries) {
    if (dict.has("JS") || dict.has("JavaScript")) findings.add("javascript");
    if (dict.has("AA")) findings.add("additional_actions");
    if (dict.has("EmbeddedFiles") || dict.has("EF") || pdfName(dict.get("Type")) === "EmbeddedFile") findings.add("embedded_file");
    if (dict.has("RichMediaContent") || dict.has("RichMediaSettings")) findings.add("rich_media");
    if (dict.has("XFA")) findings.add("xfa");
    const action = pdfName(dict.get("S"));
    if (action && ACTIONS[action]) findings.add(ACTIONS[action]);
    const subtype = pdfName(dict.get("Subtype"));
    if (subtype && ANNOTATIONS[subtype]) findings.add(ANNOTATIONS[subtype]);
    if (dict.has("OpenAction")) {
      const open = resolve(dict.get("OpenAction"));
      const isDestination = open?.t === "array";
      const isGoTo = open?.t === "dict" && pdfName(open.v.get("S")) === "GoTo" && !open.v.has("Next");
      if (!isDestination && !isGoTo) findings.add("open_action");
    }
    const type = pdfName(dict.get("Type"));
    if (type === "Page") pages += 1;
    const count = dict.get("Count");
    if (type === "Pages" && count?.t === "num") declaredPages = Math.max(declaredPages, count.v);
  }

  // A document: a catalog reached from a trailer, and at least one page.
  const hasCatalog = structure.trailers.some((trailer) => {
    const root = resolve(trailer.get("Root"));
    return root?.t === "dict" && pdfName(root.v.get("Type")) === "Catalog";
  });
  if (!hasCatalog || pages === 0) throw new PdfStructureError("invalid_pdf", "Intet katalog eller ingen sider");
  if (pages > limits.maxPages || declaredPages > limits.maxPages) throw new InspectionFailure("too_many_pages");
  return { findings, pages };
}

class InspectionFailure extends Error {
  readonly code: PdfSecurityCode;
  constructor(code: PdfSecurityCode) {
    super(code);
    this.code = code;
  }
}

/** Never throws: every failure becomes a fail/error result. */
export function inspectPdf(bytes: Uint8Array, limits: SecurityLimits): InspectionResult {
  try {
    const { findings, pages } = structuralFindings(bytes, limits);
    const sorted = [...findings].sort() as Finding[];
    return {
      pdfSecurity: { result: "pass" },
      activeContent: sorted.length > 0 ? { result: "fail", findings: sorted } : { result: "pass", findings: [] },
      pages,
    };
  } catch (error) {
    if (error instanceof PdfStructureError || error instanceof InspectionFailure) {
      return { pdfSecurity: { result: "fail", code: error.code }, activeContent: { result: "not_run", findings: [] }, pages: null };
    }
    return { pdfSecurity: { result: "error", code: "inspection_failed" }, activeContent: { result: "not_run", findings: [] }, pages: null };
  }
}
