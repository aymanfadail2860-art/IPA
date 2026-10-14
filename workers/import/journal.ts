import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { isUuid } from "../../src/lib/knowledge/upload-validation.ts";

/**
 * The import journal (beta L3): which ids a file was given, and how far it got — so an
 * interrupted import resumes with the same ids instead of starting a second copy:
 *
 *   reserved   ids chosen, nothing sent yet
 *   uploaded   the file is in quarantine (knowledge-intake), not yet registered
 *   registered the version exists and its security examination is queued
 *
 * The database stays the source of truth: a file whose SHA-256 is already registered is never
 * uploaded again, journal or not (knowledge.find_versions_by_checksum). The journal holds ids,
 * checksums and file names only — no content, no credential. It is written atomically (a
 * temporary file renamed over the old one), so a crash never leaves half a journal.
 */

export const JOURNAL_FILE = "import-journal.json";

export type JournalStage = "reserved" | "uploaded" | "registered";

export interface JournalEntry {
  file: string;
  documentId: string;
  versionId: string;
  newDocument: boolean;
  stage: JournalStage;
  updatedAt: string;
}

export interface Journal {
  version: 1;
  /** Keyed by the file's SHA-256. */
  entries: Record<string, JournalEntry>;
}

export interface JournalStore {
  read(): Promise<Journal>;
  write(journal: Journal): Promise<void>;
}

const STAGES: readonly JournalStage[] = ["reserved", "uploaded", "registered"];

export function emptyJournal(): Journal {
  return { version: 1, entries: {} };
}

/** A journal read from disk is data: anything malformed is refused, never half-used. */
export function validateJournal(value: unknown): Journal {
  const fail = () => new Error(`${JOURNAL_FILE} i rapportmappen er ødelagt. Flyt filen væk og kør importen igen; filer, der allerede er registreret, findes stadig og springes over.`);
  if (!value || typeof value !== "object") throw fail();
  const journal = value as { version?: unknown; entries?: unknown };
  if (journal.version !== 1 || !journal.entries || typeof journal.entries !== "object" || Array.isArray(journal.entries)) throw fail();
  const entries: Record<string, JournalEntry> = {};
  for (const [sha, raw] of Object.entries(journal.entries as Record<string, unknown>)) {
    const entry = raw as Partial<JournalEntry> | null;
    if (
      !/^[0-9a-f]{64}$/.test(sha) ||
      !entry ||
      typeof entry.file !== "string" ||
      !isUuid(entry.documentId) ||
      !isUuid(entry.versionId) ||
      typeof entry.newDocument !== "boolean" ||
      !STAGES.includes(entry.stage as JournalStage) ||
      typeof entry.updatedAt !== "string"
    ) {
      throw fail();
    }
    entries[sha] = { file: entry.file, documentId: entry.documentId!, versionId: entry.versionId!, newDocument: entry.newDocument, stage: entry.stage!, updatedAt: entry.updatedAt };
  }
  return { version: 1, entries };
}

export function fileJournal(directory: string): JournalStore {
  const target = path.join(directory, JOURNAL_FILE);
  return {
    async read() {
      let text: string;
      try {
        text = await readFile(target, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyJournal();
        throw error;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      return validateJournal(parsed);
    },
    async write(journal) {
      await mkdir(directory, { recursive: true });
      const temporary = `${target}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, target);
    },
  };
}

/** For tests and dry runs. */
export function memoryJournal(initial: Journal = emptyJournal()): JournalStore & { current(): Journal } {
  let state = structuredClone(initial);
  return {
    async read() {
      return structuredClone(state);
    },
    async write(journal) {
      state = structuredClone(journal);
    },
    current() {
      return structuredClone(state);
    },
  };
}
