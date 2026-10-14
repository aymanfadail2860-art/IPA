import { createHash, randomUUID } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { SECURITY_STATUS, securityStatus, VERSION_STATUS, type VersionStatus } from "../../src/lib/knowledge/admin-types.ts";
import { DOCUMENT_TYPES } from "../../src/lib/knowledge/document-types.ts";
import {
  INTAKE_BUCKET,
  MAX_ORIGINAL_BYTES,
  ORIGINAL_MIME_TYPE,
  ORIGINALS_BUCKET,
  originalPath,
  validateUploadMetadata,
} from "../../src/lib/knowledge/upload-validation.ts";

import type { SupabaseApi } from "./api.ts";
import { assessCompleteness, type ChunkFact, type Completeness, type PageFact } from "./completeness.ts";
import type { JournalEntry, JournalStore } from "./journal.ts";
import { MANIFEST_FILE, parseManifest, type ManifestRow } from "./manifest.ts";

/**
 * The administrator's document import (beta L3, docs/beta.md §15). It does what the Admin upload
 * does — no more — for many files at once, and reports on each:
 *
 *   kontroller  the import list and the files against the data model; nothing is changed
 *   upload      every valid file to quarantine (knowledge-intake) and register_upload, which
 *               queues its security examination; resumable, never a second copy
 *   status      where each file is in the chain, and for a released version the proof that it
 *               is whole (completeness.ts)
 *
 * The security chain itself is unchanged and runs in the worker (deploy/import/compose.yaml):
 * quarantine → validation → ClamAV → verdict in the database → release → text extraction →
 * registration → professional approval in Admin → publication. The importer never approves or
 * publishes anything, never reads a document's text and never parses a PDF (that happens only
 * after the security release, in the worker). It reads files only to compute their SHA-256 and
 * to upload them.
 */

export interface ImportFolder {
  readManifest(): Promise<string>;
  listPdfs(): Promise<string[]>;
  readPdf(name: string): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: string }>;
}

export interface ImportDeps {
  api: SupabaseApi;
  folder: ImportFolder;
  journal: JournalStore;
  now?: () => Date;
  newId?: () => string;
  progress?: (message: string) => void;
}

export type RowOutcome = "invalid" | "ready" | "exists" | "imported" | "failed";

export interface RowResult {
  line: number;
  file: string;
  outcome: RowOutcome;
  messages: string[];
  sha256?: string;
  documentId?: string;
  versionId?: string;
  productName?: string;
  existingStatus?: string;
}

export interface CheckResult {
  manifestErrors: string[];
  rows: RowResult[];
  /** PDFs in the folder that the import list does not name: never imported. */
  unlisted: string[];
}

interface Prepared {
  row: ManifestRow;
  sha256: string;
  byteSize: number;
  productName: string;
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** The import folder on disk: only plain files, never a link, never a sub-folder. */
export function directoryFolder(directory: string): ImportFolder {
  return {
    async readManifest() {
      const target = path.join(directory, MANIFEST_FILE);
      const info = await lstat(target).catch(() => null);
      if (!info || !info.isFile()) throw new Error(`Importlisten ${MANIFEST_FILE} findes ikke i importmappen.`);
      if (info.size > 1024 * 1024) throw new Error(`Importlisten ${MANIFEST_FILE} er større end 1 MB.`);
      return readFile(target, "utf8");
    },
    async listPdfs() {
      const entries = await readdir(directory, { withFileTypes: true });
      return entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")).map((entry) => entry.name).sort();
    },
    async readPdf(name) {
      const target = path.resolve(directory, name);
      if (path.dirname(target) !== path.resolve(directory)) return { ok: false, error: "Filen ligger ikke i importmappen." };
      const info = await lstat(target).catch(() => null);
      if (!info) return { ok: false, error: "Filen findes ikke i importmappen." };
      if (!info.isFile()) return { ok: false, error: "Filen er ikke en almindelig fil (fx en genvej eller en mappe)." };
      if (info.size === 0) return { ok: false, error: "Filen er tom." };
      if (info.size > MAX_ORIGINAL_BYTES) return { ok: false, error: "Filen er større end 50 MB." };
      return { ok: true, bytes: new Uint8Array(await readFile(target)) };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// kontroller
// ---------------------------------------------------------------------------------------------

async function prepare(deps: ImportDeps): Promise<{ result: CheckResult; prepared: Prepared[] }> {
  const { api, folder } = deps;
  const parsed = parseManifest(await folder.readManifest());
  if (!parsed.ok) return { result: { manifestErrors: parsed.errors, rows: [], unlisted: [] }, prepared: [] };

  const rows: RowResult[] = parsed.problems.map((problem) => ({ line: problem.line, file: problem.file, outcome: "invalid", messages: problem.errors }));
  const listed = new Set([...parsed.rows.map((row) => row.file.toLowerCase()), ...parsed.problems.map((problem) => problem.file.toLowerCase())]);
  const unlisted = (await folder.listPdfs()).filter((name) => !listed.has(name.toLowerCase()));

  const products = new Map(
    (await api.select<{ id: string; name: string; status: string }>("knowledge", "products", "select=id,name,status")).map((product) => [product.id, product]),
  );
  const documentIds = [...new Set(parsed.rows.map((row) => row.documentId).filter((id): id is string => id !== null))];
  const documents = new Map(
    documentIds.length === 0
      ? []
      : (await api.select<{ id: string; product_id: string }>("knowledge", "documents", `select=id,product_id&id=in.(${documentIds.join(",")})`)).map((document) => [document.id, document]),
  );

  const prepared: Prepared[] = [];
  const seen = new Map<string, number>();
  for (const row of parsed.rows) {
    const messages: string[] = [];
    const file = await folder.readPdf(row.file);
    if (!file.ok) {
      rows.push({ line: row.line, file: row.file, outcome: "invalid", messages: [file.error] });
      continue;
    }
    const checksum = sha256(file.bytes);
    // The Admin upload's own validation (src/lib/knowledge/upload-validation.ts).
    const validation = validateUploadMetadata({
      documentId: row.documentId,
      newDocument: row.newDocument,
      versionLabel: row.versionLabel,
      language: row.language,
      validFrom: row.validFrom,
      validTo: row.validTo,
      checksumSha256: checksum,
      originalFilename: row.file,
      byteSize: file.bytes.byteLength,
      mimeType: ORIGINAL_MIME_TYPE,
    });
    if (!validation.ok) messages.push(...validation.errors);
    if (seen.has(checksum)) messages.push(`Filen er den samme som i række ${seen.get(checksum)} (samme SHA-256).`);
    else seen.set(checksum, row.line);

    let productName = "";
    if (row.newDocument) {
      const product = products.get(row.newDocument.productId);
      if (!product) messages.push("Produktet findes ikke. Brug et id fra produktlisten (kommandoen produkter).");
      else if (product.status !== "active") messages.push(`Produktet "${product.name}" er udgået og kan ikke få nye dokumenter.`);
      else productName = product.name;
    } else if (row.documentId) {
      const document = documents.get(row.documentId);
      if (!document) messages.push("Dokumentet (dokument_id) findes ikke.");
      else productName = products.get(document.product_id)?.name ?? "";
    }

    if (messages.length > 0) {
      rows.push({ line: row.line, file: row.file, outcome: "invalid", messages, sha256: checksum });
      continue;
    }
    const existing = await api.rpc<{ version_id: string; document_id: string; status: string }[]>("knowledge", "find_versions_by_checksum", { p_checksum_sha256: checksum });
    if (existing.length > 0) {
      const latest = existing[0]!;
      rows.push({
        line: row.line,
        file: row.file,
        outcome: "exists",
        messages: [`Filen findes allerede som version (${VERSION_STATUS[latest.status as VersionStatus]?.label ?? latest.status}). Den uploades ikke igen.`],
        sha256: checksum,
        documentId: latest.document_id,
        versionId: latest.version_id,
        productName,
        existingStatus: latest.status,
      });
      continue;
    }
    rows.push({ line: row.line, file: row.file, outcome: "ready", messages: [], sha256: checksum, productName });
    prepared.push({ row, sha256: checksum, byteSize: file.bytes.byteLength, productName });
  }
  rows.sort((a, b) => a.line - b.line);
  return { result: { manifestErrors: [], rows, unlisted }, prepared };
}

export async function checkImport(deps: ImportDeps): Promise<CheckResult> {
  return (await prepare(deps)).result;
}

// ---------------------------------------------------------------------------------------------
// upload
// ---------------------------------------------------------------------------------------------

/**
 * Uploads and registers every row that `kontroller` finds ready. Per file, in this order:
 *
 *   1. the database already holds a version with this SHA-256 → nothing is sent ("findes
 *      allerede"); a repeated import never creates a second version;
 *   2. ids: those of an unfinished journal entry (an interrupted run), otherwise new ones —
 *      written to the journal BEFORE anything is sent;
 *   3. the file goes to quarantine; an object already there from the interrupted run is the
 *      upload of that run (the security examination compares its bytes with the checksum);
 *   4. knowledge.register_upload — the same function as the Admin upload — registers the version
 *      and queues the security examination in one transaction.
 *
 * A failure stops only that file; the next run resumes it. Nothing is ever approved or published.
 */
export async function runImport(deps: ImportDeps): Promise<CheckResult> {
  const { api, folder, journal } = deps;
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? randomUUID;
  const { result, prepared } = await prepare(deps);
  if (result.manifestErrors.length > 0) return result;

  const byLine = new Map(result.rows.map((row) => [row.line, row]));
  let index = 0;
  for (const item of prepared) {
    index += 1;
    const { row } = item;
    const report = byLine.get(row.line)!;
    deps.progress?.(`Uploader ${index}/${prepared.length}: ${row.file}`);
    const state = await journal.read();
    const save = async (entry: JournalEntry) => {
      const current = await journal.read();
      current.entries[item.sha256] = entry;
      await journal.write(current);
    };
    try {
      // The file must still be the one that was checked.
      const file = await folder.readPdf(row.file);
      if (!file.ok || sha256(file.bytes) !== item.sha256) {
        Object.assign(report, { outcome: "failed", messages: ["Filen er ændret eller fjernet under importen. Kør importen igen."] });
        continue;
      }

      const previous = state.entries[item.sha256];
      const resumable =
        previous && previous.stage !== "registered" && previous.newDocument === (row.newDocument !== null) && (row.documentId === null || previous.documentId === row.documentId);
      const entry: JournalEntry = resumable
        ? { ...previous, file: row.file, updatedAt: now().toISOString() }
        : { file: row.file, documentId: row.documentId ?? newId(), versionId: newId(), newDocument: row.newDocument !== null, stage: "reserved", updatedAt: now().toISOString() };
      if (!resumable) await save(entry);
      const storagePath = originalPath(entry.documentId, entry.versionId);

      const upload = await api.upload(INTAKE_BUCKET, storagePath, file.bytes, ORIGINAL_MIME_TYPE);
      if (!upload.ok && !(upload.exists && resumable)) {
        Object.assign(report, { outcome: "failed", messages: [`Upload til karantæne mislykkedes (${upload.status}${upload.message ? `: ${upload.message}` : ""}).`] });
        continue;
      }
      await save({ ...entry, stage: "uploaded", updatedAt: now().toISOString() });

      await api.rpc<string>("knowledge", "register_upload", {
        p_version_id: entry.versionId,
        p_document_id: entry.documentId,
        p_new_document: row.newDocument ? { product_id: row.newDocument.productId, document_type: row.newDocument.documentType, title: row.newDocument.title } : null,
        p_version_label: row.versionLabel,
        p_language: row.language,
        p_valid_from: row.validFrom,
        p_valid_to: row.validTo,
        p_checksum_sha256: item.sha256,
        p_original_filename: row.file,
      });
      await save({ ...entry, stage: "registered", updatedAt: now().toISOString() });
      Object.assign(report, {
        outcome: "imported",
        messages: ["Uploadet til karantæne og registreret. Sikkerhedskontrollen kører, når workeren startes."],
        documentId: entry.documentId,
        versionId: entry.versionId,
      });
    } catch (error) {
      Object.assign(report, { outcome: "failed", messages: [`Teknisk fejl: ${(error as Error).message} Kør importen igen for at genoptage.`] });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------------------------

export type StatusCategory =
  | "not_imported"
  | "invalid"
  | "waiting_scan"
  | "security_rejected"
  | "scan_failed"
  | "waiting_processing"
  | "processing_failed"
  | "incomplete"
  | "ready_for_review"
  | "published"
  | "review_rejected"
  | "other";

export const CATEGORY_LABEL: Record<StatusCategory, string> = {
  not_imported: "Ikke importeret",
  invalid: "Afvist før upload",
  waiting_scan: "Venter på sikkerhedskontrol",
  security_rejected: "Afvist af sikkerhedskontrollen",
  scan_failed: "Sikkerhedskontrollen kunne ikke gennemføres",
  waiting_processing: "Venter på tekstudtræk",
  processing_failed: "Kunne ikke behandles",
  incomplete: "Ufuldstændig – kan ikke godkendes",
  ready_for_review: "Klar til faglig godkendelse i Admin",
  published: "Publiceret – hele versionen er tilgængelig",
  review_rejected: "Afvist i den faglige godkendelse",
  other: "Andet",
};

/** Plain-language reasons for the codes an operator can act on. Never a scanner finding. */
const REASON: Record<string, string> = {
  stale_signatures: "Scannerens signaturer er ældre end 24 timer. Byg scanneren igen (trin 1 i runbooken).",
  signature_unknown: "Scannerens signaturer kan ikke dateres. Byg scanneren igen.",
  scanner_unavailable: "Scanneren svarer ikke. Kontrollér, at Docker kører, og kør importen igen.",
  scanner_timeout: "Scanneren svarede ikke i tide.",
  scanner_error: "Scanneren meldte en fejl.",
  engine_not_approved: "Scannermotoren er ikke en godkendt version.",
  scan_error: "Teknisk fejl under scanningen.",
  checksum_changed: "Filen blev ændret efter scanningen og scannes igen.",
};

export interface StatusRow {
  line: number;
  file: string;
  category: StatusCategory;
  label: string;
  messages: string[];
  versionId?: string;
  documentId?: string;
  productName?: string;
  versionStatus?: string;
  security?: string;
  completeness?: Completeness;
  accessGrants?: number;
  reviewBlockers?: string[];
}

export interface StatusResult {
  manifestErrors: string[];
  rows: StatusRow[];
}

interface VersionRow {
  id: string;
  document_id: string;
  status: VersionStatus;
  security_state: string;
  storage_bucket: string;
  checksum_sha256: string;
  page_count: number | null;
  version_label: string | null;
  language: string;
  valid_from: string | null;
  valid_to: string | null;
  original_filename: string | null;
}

export async function importStatus(deps: ImportDeps): Promise<StatusResult> {
  const { api, folder, journal } = deps;
  const parsed = parseManifest(await folder.readManifest());
  if (!parsed.ok) return { manifestErrors: parsed.errors, rows: [] };
  const state = await journal.read();
  const products = new Map((await api.select<{ id: string; name: string }>("knowledge", "products", "select=id,name")).map((product) => [product.id, product.name]));

  const rows: StatusRow[] = parsed.problems.map((problem) => ({
    line: problem.line,
    file: problem.file,
    category: "invalid",
    label: CATEGORY_LABEL.invalid,
    messages: problem.errors,
  }));

  for (const row of parsed.rows) {
    deps.progress?.(`Kontrollerer ${row.file}`);
    const file = await folder.readPdf(row.file);
    if (!file.ok) {
      rows.push({ line: row.line, file: row.file, category: "invalid", label: CATEGORY_LABEL.invalid, messages: [file.error] });
      continue;
    }
    const checksum = sha256(file.bytes);
    const found = await api.rpc<{ version_id: string }[]>("knowledge", "find_versions_by_checksum", { p_checksum_sha256: checksum });
    const journalled = state.entries[checksum]?.versionId;
    const versionId = found.find((version) => version.version_id === journalled)?.version_id ?? found[0]?.version_id;
    if (!versionId) {
      const stage = state.entries[checksum]?.stage;
      rows.push({
        line: row.line,
        file: row.file,
        category: "not_imported",
        label: CATEGORY_LABEL.not_imported,
        messages: [stage ? "Importen blev afbrudt, før filen blev registreret. Kør upload igen for at genoptage." : "Filen er ikke uploadet endnu."],
      });
      continue;
    }
    rows.push(await versionStatus(api, row, checksum, versionId, products));
  }
  rows.sort((a, b) => a.line - b.line);
  return { manifestErrors: [], rows };
}

async function versionStatus(api: SupabaseApi, row: ManifestRow, checksum: string, versionId: string, products: Map<string, string>): Promise<StatusRow> {
  const [version] = await api.select<VersionRow>(
    "knowledge",
    "document_versions",
    `select=id,document_id,status,security_state,storage_bucket,checksum_sha256,page_count,version_label,language,valid_from,valid_to,original_filename&id=eq.${versionId}`,
  );
  if (!version) return { line: row.line, file: row.file, category: "not_imported", label: CATEGORY_LABEL.not_imported, messages: ["Versionen kan ikke læses."] };
  const [document] = await api.select<{ id: string; title: string; product_id: string; document_type: string }>(
    "knowledge",
    "documents",
    `select=id,title,product_id,document_type&id=eq.${version.document_id}`,
  );
  const [security] = await api.rpc<{ security_state: string; failure_code: string | null }[]>("knowledge", "version_security_status", { p_version_ids: [versionId] });
  const securityCategory = securityStatus(security?.security_state ?? version.security_state, security?.failure_code ?? null);
  const base: StatusRow = {
    line: row.line,
    file: row.file,
    category: "other",
    label: "",
    messages: [],
    versionId,
    documentId: version.document_id,
    productName: document ? products.get(document.product_id) : undefined,
    versionStatus: VERSION_STATUS[version.status]?.label ?? version.status,
    security: SECURITY_STATUS[securityCategory].label,
  };
  const done = (category: StatusCategory, messages: string[] = []): StatusRow => ({ ...base, category, label: CATEGORY_LABEL[category], messages });
  const reason = security?.failure_code ? REASON[security.failure_code] : undefined;

  if (version.security_state === "rejected") return done("security_rejected", [SECURITY_STATUS[securityCategory].label + "."]);
  if (version.security_state === "scan_failed") return done("scan_failed", [reason ?? "Teknisk scanfejl.", "Filen frigives ikke, før en scanning lykkes; workeren prøver igen."]);
  if (version.security_state !== "released") return done("waiting_scan", ["Start workeren (trin 4 i runbooken)."]);
  if (version.status === "processing_failed") {
    const [job] = await api.select<{ error_message: string | null }>(
      "knowledge",
      "ingestion_jobs",
      `select=error_message&document_version_id=eq.${versionId}&kind=eq.process&order=created_at.desc&limit=1`,
    );
    return done("processing_failed", [job?.error_message ?? "Behandlingen fejlede."]);
  }
  if (version.status === "uploaded" || version.status === "processing") return done("waiting_processing", ["Start workeren (trin 4 i runbooken)."]);
  if (version.status === "rejected") return done("review_rejected");
  if (!["processed", "under_review", "published"].includes(version.status)) return done("other", [base.versionStatus ?? version.status]);

  // Released and processed: prove that the whole version is there.
  const pages = await api.select<PageFact>("knowledge", "document_pages", `select=page_number,has_text_layer,char_start,char_end&document_version_id=eq.${versionId}&order=page_number`);
  const chunks = await api.select<ChunkFact>("knowledge", "document_chunks", `select=chunk_index,page_start,page_end,char_start,char_end&document_version_id=eq.${versionId}&order=chunk_index`);
  const grants = await api.select<{ id: string }>("knowledge", "document_access_grants", `select=id&document_id=eq.${version.document_id}`);
  let originalSha256: string | null = null;
  try {
    // Audited like every download of an original (knowledge.original.download_url_issued).
    const storedPath = await api.rpc<string>("knowledge", "log_original_download", { p_version_id: versionId });
    originalSha256 = sha256(await api.download(ORIGINALS_BUCKET, storedPath, MAX_ORIGINAL_BYTES));
  } catch {
    originalSha256 = null;
  }
  const completeness = assessCompleteness(
    {
      sha256: checksum,
      documentId: row.documentId,
      productId: row.newDocument?.productId ?? null,
      documentType: row.newDocument?.documentType ?? null,
      title: row.newDocument?.title ?? null,
      versionLabel: row.versionLabel,
      validFrom: row.validFrom,
      validTo: row.validTo,
      language: row.language,
      originalFilename: row.file,
      expectedPages: row.expectedPages,
    },
    {
      versionChecksum: version.checksum_sha256,
      storageBucket: version.storage_bucket,
      securityState: version.security_state,
      pageCount: version.page_count,
      documentId: version.document_id,
      productId: document?.product_id ?? "",
      documentType: document?.document_type ?? "",
      title: document?.title ?? "",
      versionLabel: version.version_label,
      validFrom: version.valid_from,
      validTo: version.valid_to,
      language: version.language,
      originalFilename: version.original_filename,
      originalSha256,
      pages,
      chunks,
    },
  );

  let reviewBlockers: string[] = [];
  const messages: string[] = [];
  if (version.status !== "published") {
    const review = await api.rpc<{ blockers?: { code: string; message: string }[]; warnings?: { code: string; message: string }[] }>("knowledge", "review_state", { p_version_id: versionId });
    reviewBlockers = (review.blockers ?? []).filter((blocker) => blocker.code !== "not_under_review").map((blocker) => blocker.message);
    messages.push(...(review.warnings ?? []).map((warning) => `Advarsel: ${warning.message}`));
  }
  // Before publication review_state already warns about it (no_grants).
  if (version.status === "published" && grants.length === 0) messages.push("Dokumentet har ingen adgangstildelinger: kun administratorer kan finde det. Tildel adgang i Admin.");
  const category: StatusCategory = !completeness.complete ? "incomplete" : version.status === "published" ? "published" : "ready_for_review";
  return {
    ...base,
    category,
    label: CATEGORY_LABEL[category],
    messages: [...completeness.problems, ...reviewBlockers.map((blocker) => `Blokerer godkendelse: ${blocker}`), ...messages],
    completeness,
    accessGrants: grants.length,
    reviewBlockers,
  };
}

// ---------------------------------------------------------------------------------------------
// produkter
// ---------------------------------------------------------------------------------------------

export interface ProductList {
  products: { id: string; name: string; category: string | null }[];
  documentTypes: { key: string; label: string }[];
}

/** The ids the import list refers to: active products and the eight document types. */
export async function listProducts(api: SupabaseApi): Promise<ProductList> {
  const products = await api.select<{ id: string; name: string; category: string | null }>("knowledge", "products", "select=id,name,category&status=eq.active&order=name");
  return { products, documentTypes: DOCUMENT_TYPES.map((type) => ({ key: type.key, label: type.label })) };
}
