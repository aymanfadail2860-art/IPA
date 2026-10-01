/**
 * Shared types of the ingestion worker (docs/07 §5). The worker is a standalone Node process
 * outside the Next.js app. It runs TypeScript directly (Node's type stripping), so only
 * erasable syntax is used and relative imports carry the .ts extension.
 */

/** A run of text on a line; a line with several runs separated by large gaps may be a table row. */
export interface TextRun {
  text: string;
  x: number;
  width: number;
}

export interface ExtractedLine {
  text: string;
  x: number;
  /** Baseline in PDF user space (larger y = higher on the page). */
  y: number;
  fontSize: number;
  bold: boolean;
  runs: TextRun[];
}

export interface ExtractedPage {
  pageNumber: number;
  hasTextLayer: boolean;
  lines: ExtractedLine[];
}

/** A failure the worker must not retry: the file itself is the problem (docs/07 §2.3). */
export class FileRejected extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "FileRejected";
  }
}
