import { isDocumentTypeKey, type DocumentTypeKey } from "./document-types";

/**
 * Validation of upload metadata before a signed upload URL is issued and before a version
 * is registered (docs/07 §5.1, §14). Client checks are only for the user experience; this
 * runs server-side, the bucket enforces type and size, and the worker validates the file
 * content again (magic bytes, checksum).
 */

/** Bucket limit for originals (supabase/migrations/20261001000200_knowledge_storage.sql). */
export const MAX_ORIGINAL_BYTES = 50 * 1024 * 1024;
export const ORIGINAL_MIME_TYPE = "application/pdf";
export const ORIGINALS_BUCKET = "knowledge-originals";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface UploadMetadataInput {
  /** An existing document (new version) — or omitted together with `newDocument`. */
  documentId?: string | null;
  newDocument?: { productId: string; documentType: string; title: string } | null;
  versionLabel?: string | null;
  language?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  checksumSha256: string;
  originalFilename: string;
  byteSize: number;
  mimeType: string;
}

export interface UploadMetadata {
  documentId: string | null;
  newDocument: { productId: string; documentType: DocumentTypeKey; title: string } | null;
  versionLabel: string | null;
  language: string;
  validFrom: string | null;
  validTo: string | null;
  checksumSha256: string;
  originalFilename: string;
  byteSize: number;
}

export type UploadValidation = { ok: true; value: UploadMetadata } | { ok: false; errors: string[] };

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Only the base name is kept; it is metadata, never part of the storage path. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  // Control characters are removed; the name is only ever shown, never used as a path.
  return [...base].filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join("").trim();
}

function optionalText(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function validateUploadMetadata(input: UploadMetadataInput): UploadValidation {
  const errors: string[] = [];

  const documentId = optionalText(input.documentId);
  const hasNewDocument = Boolean(input.newDocument);
  if (Boolean(documentId) === hasNewDocument) {
    errors.push("Vælg enten et eksisterende dokument eller angiv et nyt dokument.");
  }
  if (documentId && !isUuid(documentId)) errors.push("Dokumentet er ugyldigt.");

  let newDocument: UploadMetadata["newDocument"] = null;
  if (input.newDocument) {
    const title = input.newDocument.title.trim();
    if (!isUuid(input.newDocument.productId)) errors.push("Vælg et produkt.");
    if (!isDocumentTypeKey(input.newDocument.documentType)) errors.push("Vælg en dokumenttype.");
    if (title.length < 1 || title.length > 300) errors.push("Titlen skal være mellem 1 og 300 tegn.");
    if (isDocumentTypeKey(input.newDocument.documentType)) {
      newDocument = { productId: input.newDocument.productId, documentType: input.newDocument.documentType, title };
    }
  }

  const versionLabel = optionalText(input.versionLabel);
  if (versionLabel && versionLabel.length > 100) errors.push("Versionsbetegnelsen må højst være 100 tegn.");

  const language = optionalText(input.language) ?? "da";
  if (!/^[a-z]{2}$/.test(language)) errors.push("Sproget er ugyldigt.");

  const validFrom = optionalText(input.validFrom);
  const validTo = optionalText(input.validTo);
  if (validFrom && !isCalendarDate(validFrom)) errors.push("Gyldig fra skal være en dato.");
  if (validTo && !isCalendarDate(validTo)) errors.push("Gyldig til skal være en dato.");
  if (validFrom && validTo && isCalendarDate(validFrom) && isCalendarDate(validTo) && validTo <= validFrom) {
    errors.push("Gyldig til skal ligge efter gyldig fra.");
  }

  const checksumSha256 = input.checksumSha256.trim().toLowerCase();
  if (!SHA256.test(checksumSha256)) errors.push("Filens kontrolsum mangler eller er ugyldig.");

  const originalFilename = sanitizeFilename(input.originalFilename);
  if (!originalFilename.toLowerCase().endsWith(".pdf") || originalFilename.length > 255) {
    errors.push("Kun PDF-filer kan uploades.");
  }
  if (input.mimeType !== ORIGINAL_MIME_TYPE) errors.push("Kun PDF-filer kan uploades.");
  if (!Number.isInteger(input.byteSize) || input.byteSize <= 0) errors.push("Filen er tom.");
  if (input.byteSize > MAX_ORIGINAL_BYTES) errors.push("Filen er større end 50 MB.");

  if (errors.length > 0) return { ok: false, errors: [...new Set(errors)] };
  return {
    ok: true,
    value: {
      documentId,
      newDocument,
      versionLabel,
      language,
      validFrom,
      validTo,
      checksumSha256,
      originalFilename,
      byteSize: input.byteSize,
    },
  };
}

/** {document_id}/{version_id}/original.pdf — never the user's file name (docs/07 §14). */
export function originalPath(documentId: string, versionId: string): string {
  return `${documentId}/${versionId}/original.pdf`;
}
