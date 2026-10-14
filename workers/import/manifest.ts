import { DOCUMENT_TYPES, type DocumentTypeKey } from "../../src/lib/knowledge/document-types.ts";
import { isUuid, sanitizeFilename } from "../../src/lib/knowledge/upload-validation.ts";

/**
 * The import list (beta L3, docs/beta.md §15): one row per PDF, in a CSV file the administrator
 * fills in (Excel "CSV UTF-8" with ";" or a plain CSV with ","). The list says, for each file,
 * exactly which product, document type, version and validity it belongs to — the importer never
 * guesses. Every value is validated again against the database (products, document types,
 * existing documents) and by the same metadata validation as the Admin upload
 * (src/lib/knowledge/upload-validation.ts) before anything is uploaded.
 *
 * Columns (Danish, lower case, the order does not matter):
 *
 *   fil          the PDF's file name in the import folder                         required
 *   produkt_id   the product's id (the importer's "produkter" list)              new document
 *   dokumenttype the type's key or Danish name (e.g. terms or Betingelser)       new document
 *   titel        the document's title (1–300 characters)                         new document
 *   dokument_id  an EXISTING document: the file becomes its new version          instead of the three above
 *   version      the version label (e.g. 2026-01)                                required
 *   gyldig_fra   first valid day, YYYY-MM-DD                                      required
 *   gyldig_til   first day it no longer applies, YYYY-MM-DD                       optional
 *   sprog        two letters, default da                                          optional
 *   sider        the number of pages the document must have                      optional
 *
 * "version" and "gyldig_fra" are required here because the professional approval requires them
 * (knowledge.review_state, docs/07 §3.2): a row without them could never be approved.
 * Selskab/udgiver has no field in the data model [AFKLARES]; a column for it is refused rather
 * than silently dropped.
 */

export const MANIFEST_FILE = "importliste.csv";
export const MAX_ROWS = 500;

const KNOWN = ["fil", "produkt_id", "dokumenttype", "titel", "dokument_id", "version", "gyldig_fra", "gyldig_til", "sprog", "sider"] as const;
type Column = (typeof KNOWN)[number];
const REQUIRED: readonly Column[] = ["fil", "version", "gyldig_fra"];
const UNSUPPORTED = /^(selskab|udgiver|forsikringsselskab|selskab_udgiver|leverandør|leverandor)$/;

export interface ManifestRow {
  /** Line number in the CSV file (the header is line 1). */
  line: number;
  file: string;
  /** An existing document (a new version of it), or null for a new document. */
  documentId: string | null;
  newDocument: { productId: string; documentType: DocumentTypeKey; title: string } | null;
  versionLabel: string;
  validFrom: string;
  validTo: string | null;
  language: string;
  expectedPages: number | null;
}

export interface RowProblem {
  line: number;
  file: string;
  errors: string[];
}

export type ParsedManifest =
  | { ok: true; rows: ManifestRow[]; problems: RowProblem[] }
  | { ok: false; errors: string[] };

/** RFC 4180 records: quoted fields with "" escapes, CRLF or LF, the given delimiter. */
export function parseCsv(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let index = 0;
  const endField = () => {
    record.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };
  while (index < text.length) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else quoted = false;
      } else field += char;
    } else if (char === '"' && field === "") quoted = true;
    else if (char === delimiter) endField();
    else if (char === "\n") endRecord();
    else if (char === "\r" && text[index + 1] === "\n") {
      endRecord();
      index += 1;
    } else field += char;
    index += 1;
  }
  if (quoted) throw new Error("Et felt med anførselstegn er ikke afsluttet.");
  if (field !== "" || record.length > 0) endRecord();
  // Empty lines (also ";;;" from a spreadsheet) are not rows.
  return records.filter((fields) => fields.some((value) => value.trim() !== ""));
}

/** ";" when the header line uses it (Danish Excel), otherwise ",". */
export function detectDelimiter(headerLine: string): ";" | "," {
  return headerLine.includes(";") ? ";" : ",";
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** The type's key, or its exact Danish name (case-insensitive). Nothing else is matched. */
export function documentTypeKey(value: string): DocumentTypeKey | null {
  const wanted = value.trim().toLowerCase();
  const match = DOCUMENT_TYPES.find((type) => type.key === wanted || type.label.toLowerCase() === wanted);
  return match ? match.key : null;
}

/**
 * A file name the import folder can hold: a plain PDF name, no folder, no hidden file, no
 * control characters. The name is only ever looked up in the import folder.
 */
export function isPlainFileName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 255 &&
    name === sanitizeFilename(name) &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !name.startsWith(".") &&
    name.toLowerCase().endsWith(".pdf")
  );
}

export function parseManifest(raw: string): ParsedManifest {
  const text = raw.startsWith("﻿") ? raw.slice(1) : raw;
  if (text.includes("�")) {
    return { ok: false, errors: ["Importlisten er ikke gemt som UTF-8. Gem den som \"CSV UTF-8\" og prøv igen."] };
  }
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  let records: string[][];
  try {
    records = parseCsv(text, detectDelimiter(firstLine));
  } catch (error) {
    return { ok: false, errors: [`Importlisten kan ikke læses: ${(error as Error).message}`] };
  }
  if (records.length === 0) return { ok: false, errors: ["Importlisten er tom."] };

  const header = records[0]!.map((name) => name.trim().toLowerCase());
  const errors: string[] = [];
  const unsupported = header.filter((name) => UNSUPPORTED.test(name));
  for (const name of unsupported) {
    errors.push(`Kolonnen "${name}" understøttes ikke: datamodellen har intet felt for selskab/udgiver. Fjern kolonnen.`);
  }
  const unknown = header.filter((name) => name !== "" && !UNSUPPORTED.test(name) && !(KNOWN as readonly string[]).includes(name));
  if (unknown.length > 0) errors.push(`Ukendte kolonner: ${unknown.join(", ")}. Tilladte kolonner: ${KNOWN.join(", ")}.`);
  const duplicates = header.filter((name, index) => name !== "" && header.indexOf(name) !== index);
  if (duplicates.length > 0) errors.push(`Kolonnen ${[...new Set(duplicates)].join(", ")} står flere gange.`);
  const missing = REQUIRED.filter((name) => !header.includes(name));
  if (missing.length > 0) errors.push(`Påkrævede kolonner mangler: ${missing.join(", ")}.`);
  if (records.length - 1 > MAX_ROWS) errors.push(`Importlisten har flere end ${MAX_ROWS} rækker. Del den op.`);
  if (errors.length > 0) return { ok: false, errors };

  const rows: ManifestRow[] = [];
  const problems: RowProblem[] = [];
  const seenFiles = new Map<string, number>();
  records.slice(1).forEach((fields, offset) => {
    const line = offset + 2;
    const value = (column: Column): string => {
      const index = header.indexOf(column);
      return index >= 0 ? (fields[index] ?? "").trim() : "";
    };
    const rowErrors: string[] = [];
    if (fields.length > header.length && fields.slice(header.length).some((extra) => extra.trim() !== "")) {
      rowErrors.push("Rækken har flere felter end overskriften.");
    }

    const file = value("fil");
    if (!file) rowErrors.push("Filnavn mangler (kolonnen fil).");
    else if (!isPlainFileName(file)) rowErrors.push("Filnavnet skal være navnet på en PDF i importmappen (uden mappe, slutter på .pdf).");
    else if (seenFiles.has(file.toLowerCase())) rowErrors.push(`Filen står også i række ${seenFiles.get(file.toLowerCase())}.`);
    if (file) seenFiles.set(file.toLowerCase(), seenFiles.get(file.toLowerCase()) ?? line);

    const documentIdText = value("dokument_id");
    const productId = value("produkt_id");
    const typeText = value("dokumenttype");
    const title = value("titel");
    let documentId: string | null = null;
    let newDocument: ManifestRow["newDocument"] = null;
    if (documentIdText) {
      if (!isUuid(documentIdText)) rowErrors.push("dokument_id er ikke et gyldigt id.");
      else documentId = documentIdText.toLowerCase();
      // A new version of an existing document takes product, type and title from the document.
      if (productId || typeText || title) {
        rowErrors.push("Angiv enten dokument_id (ny version af et eksisterende dokument) eller produkt_id, dokumenttype og titel (nyt dokument) — ikke begge.");
      }
    } else {
      const documentType = typeText ? documentTypeKey(typeText) : null;
      if (!productId) rowErrors.push("produkt_id mangler.");
      else if (!isUuid(productId)) rowErrors.push("produkt_id er ikke et gyldigt id. Brug id'et fra produktlisten.");
      if (!typeText) rowErrors.push("dokumenttype mangler.");
      else if (!documentType) rowErrors.push(`Dokumenttypen "${typeText}" findes ikke. Tilladt: ${DOCUMENT_TYPES.map((type) => `${type.key} (${type.label})`).join(", ")}.`);
      if (!title) rowErrors.push("titel mangler.");
      else if (title.length > 300) rowErrors.push("titel må højst være 300 tegn.");
      if (isUuid(productId) && documentType && title && title.length <= 300) {
        newDocument = { productId: productId.toLowerCase(), documentType, title };
      }
    }

    const versionLabel = value("version");
    if (!versionLabel) rowErrors.push("version mangler (kræves for at versionen kan godkendes).");
    else if (versionLabel.length > 100) rowErrors.push("version må højst være 100 tegn.");

    const validFrom = value("gyldig_fra");
    if (!validFrom) rowErrors.push("gyldig_fra mangler (kræves for at versionen kan godkendes).");
    else if (!isCalendarDate(validFrom)) rowErrors.push("gyldig_fra skal være en dato skrevet som ÅÅÅÅ-MM-DD.");
    const validToText = value("gyldig_til");
    const validTo = validToText || null;
    if (validTo && !isCalendarDate(validTo)) rowErrors.push("gyldig_til skal være en dato skrevet som ÅÅÅÅ-MM-DD.");
    if (validTo && isCalendarDate(validFrom) && isCalendarDate(validTo) && validTo <= validFrom) rowErrors.push("gyldig_til skal ligge efter gyldig_fra.");

    const language = (value("sprog") || "da").toLowerCase();
    if (!/^[a-z]{2}$/.test(language)) rowErrors.push("sprog skal være to bogstaver, fx da.");

    const pagesText = value("sider");
    let expectedPages: number | null = null;
    if (pagesText) {
      if (!/^\d{1,4}$/.test(pagesText) || Number(pagesText) < 1 || Number(pagesText) > 2000) rowErrors.push("sider skal være et helt tal mellem 1 og 2000.");
      else expectedPages = Number(pagesText);
    }

    if (rowErrors.length > 0) {
      problems.push({ line, file, errors: rowErrors });
      return;
    }
    rows.push({ line, file, documentId, newDocument, versionLabel, validFrom, validTo, language, expectedPages });
  });

  return { ok: true, rows, problems };
}
