/**
 * Proof that a stored document version is whole (beta L3, docs/beta.md §15.4) — computed from
 * what the platform holds, never from the document's text:
 *
 *   * the original: the bytes in knowledge-originals have the SHA-256 of the file in the import
 *     folder and of the registered version (scanned file = released file = imported file);
 *   * the pages: exactly pages 1..N of the PDF, N = the page count the worker read, every page
 *     with a text layer, and N = the number of pages in the import list when it gives one;
 *   * the order: pages and text segments follow each other in the document's own order, and every
 *     page with text is covered by a text segment;
 *   * the identity: product, document type, title, version, validity, language and file name are
 *     the ones in the import list.
 *
 * A version that fails any of these is not complete — whatever its status. Approval is blocked
 * independently by the database for unread pages (knowledge.review_state, "pages_unread").
 */

export interface PageFact {
  page_number: number;
  has_text_layer: boolean;
  char_start: number;
  char_end: number;
}

export interface ChunkFact {
  chunk_index: number;
  page_start: number;
  page_end: number;
  char_start: number;
  char_end: number;
}

export interface Expected {
  sha256: string;
  productId: string | null;
  documentType: string | null;
  title: string | null;
  documentId: string | null;
  versionLabel: string;
  validFrom: string;
  validTo: string | null;
  language: string;
  originalFilename: string;
  expectedPages: number | null;
}

export interface Stored {
  versionChecksum: string;
  storageBucket: string;
  securityState: string;
  pageCount: number | null;
  documentId: string;
  productId: string;
  documentType: string;
  title: string;
  versionLabel: string | null;
  validFrom: string | null;
  validTo: string | null;
  language: string;
  originalFilename: string | null;
  /** SHA-256 of the bytes downloaded from knowledge-originals; null when they could not be read. */
  originalSha256: string | null;
  pages: PageFact[];
  chunks: ChunkFact[];
}

export interface Completeness {
  complete: boolean;
  problems: string[];
  pages: number;
  pagesWithText: number;
  chunks: number;
  /** The stored original is byte for byte the imported file. */
  originalMatches: boolean;
  /** The version's extracted text in characters (its last page's end) — for the beta's budget (docs/beta.md §5.3). */
  characters: number;
}

export function assessCompleteness(expected: Expected, stored: Stored): Completeness {
  const problems: string[] = [];

  // The original.
  if (stored.securityState !== "released" || stored.storageBucket !== "knowledge-originals") problems.push("Originalen er ikke frigivet af sikkerhedskontrollen.");
  if (stored.versionChecksum !== expected.sha256) problems.push("Den registrerede kontrolsum er ikke filens SHA-256.");
  if (stored.originalSha256 === null) problems.push("Originalen kunne ikke hentes tilbage.");
  else if (stored.originalSha256 !== expected.sha256) problems.push("Den gemte original er ikke den importerede fil (SHA-256 afviger).");

  // The pages: 1..N, every one with a text layer.
  const pages = [...stored.pages].sort((a, b) => a.page_number - b.page_number);
  const count = stored.pageCount ?? 0;
  if (count < 1) problems.push("Sideantallet er ukendt.");
  if (pages.length !== count || pages.some((page, index) => page.page_number !== index + 1)) {
    problems.push(`Ikke alle sider er gemt (${pages.length} af ${count}).`);
  }
  const withoutText = pages.filter((page) => !page.has_text_layer).map((page) => page.page_number);
  if (withoutText.length > 0) problems.push(`Sider uden tekstlag: ${withoutText.join(", ")}.`);
  if (expected.expectedPages !== null && count !== expected.expectedPages) {
    problems.push(`Dokumentet har ${count} sider, men importlisten siger ${expected.expectedPages}.`);
  }
  let previousEnd = 0;
  for (const page of pages) {
    if (page.char_start < previousEnd || page.char_end < page.char_start) {
      problems.push(`Teksten på side ${page.page_number} ligger ikke i dokumentets rækkefølge.`);
      break;
    }
    previousEnd = page.char_end;
  }

  // The text segments: 0..M-1, in the document's order, covering every page with text.
  const chunks = [...stored.chunks].sort((a, b) => a.chunk_index - b.chunk_index);
  if (chunks.length === 0) problems.push("Dokumentet har ingen tekstsegmenter.");
  if (chunks.some((chunk, index) => chunk.chunk_index !== index)) problems.push("Tekstsegmenterne er ikke fortløbende.");
  for (let index = 1; index < chunks.length; index += 1) {
    const previous = chunks[index - 1]!;
    const chunk = chunks[index]!;
    if (chunk.char_start < previous.char_start || chunk.page_start < previous.page_start) {
      problems.push("Tekstsegmenterne følger ikke dokumentets rækkefølge.");
      break;
    }
  }
  const uncovered = pages
    .filter((page) => page.char_end > page.char_start)
    .filter((page) => !chunks.some((chunk) => chunk.page_start <= page.page_number && page.page_number <= chunk.page_end))
    .map((page) => page.page_number);
  if (uncovered.length > 0) problems.push(`Sider uden tekstsegment: ${uncovered.join(", ")}.`);
  if (chunks.some((chunk) => chunk.page_end > count || chunk.page_start < 1)) problems.push("Et tekstsegment peger uden for dokumentets sider.");

  // The identity.
  if (expected.documentId !== null && stored.documentId !== expected.documentId) problems.push("Versionen tilhører et andet dokument end importlisten angiver.");
  if (expected.productId !== null && stored.productId !== expected.productId) problems.push("Dokumentet tilhører et andet produkt end importlisten angiver.");
  if (expected.documentType !== null && stored.documentType !== expected.documentType) problems.push("Dokumenttypen er ikke den, importlisten angiver.");
  if (expected.title !== null && stored.title !== expected.title) problems.push("Titlen er ikke den, importlisten angiver.");
  if (stored.versionLabel !== expected.versionLabel) problems.push("Versionsbetegnelsen er ikke den, importlisten angiver.");
  if (stored.validFrom !== expected.validFrom || stored.validTo !== expected.validTo) problems.push("Gyldigheden er ikke den, importlisten angiver.");
  if (stored.language !== expected.language) problems.push("Sproget er ikke det, importlisten angiver.");
  if (stored.originalFilename !== expected.originalFilename) problems.push("Filnavnet er ikke det, importlisten angiver.");

  return {
    complete: problems.length === 0,
    problems,
    pages: count,
    pagesWithText: pages.filter((page) => page.has_text_layer).length,
    chunks: chunks.length,
    originalMatches: stored.originalSha256 === expected.sha256 && stored.versionChecksum === expected.sha256,
    characters: pages.reduce((end, page) => Math.max(end, page.char_end), 0),
  };
}
