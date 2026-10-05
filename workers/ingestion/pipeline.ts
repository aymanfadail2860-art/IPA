import { knowledgeText } from "../../src/lib/egress/classification.ts";
import { embeddingInput, inputHash, modelLabel, type Embedder, type EmbeddingModelSpec } from "../../src/lib/knowledge/core/embedding.ts";
import { createEmbedder } from "../../src/lib/knowledge/core/registry.ts";

import { CHUNKER_VERSION, chunkDocument, type Chunk } from "./chunker.ts";
import { EXTRACTOR_VERSION, extractPdf } from "./extract.ts";
import { ProcessingBlocked, type Clearance, type SecurityGate } from "./gate.ts";
import { normalizePages } from "./normalize.ts";
import { buildQualityReport, type WorkerQualityReport } from "./quality.ts";
import { structurePages } from "./structure.ts";
import type { PdfInspector } from "./security/inspector.ts";
import type { ScanContext, SecurityMeasurements } from "./security/scan.ts";
import type { MalwareScanner } from "./security/scanner.ts";
import { abortKind, isIdentityError, isLeaseLost, JobAborted, type JobOutcome } from "./job-control.ts";
import { FileRejected } from "./types.ts";
import { validateOriginal } from "./validate.ts";

/**
 * One ingestion job (docs/07 §5.2): validation → extraction → normalization → structuring →
 * chunking → embedding → indexing → quality report → "Klar til review". A "reembed" job only
 * adds embeddings for a candidate model to an already processed version (docs/07 §7).
 *
 * Technical processing only. Nothing here can make a version authoritative: the database
 * functions the worker calls cannot publish, and only `processed` is ever reached.
 *
 * 8B-I5: the release gate (gate.ts) decides — in the database — whether a job may enter at
 * all and whether the downloaded bytes are exactly the released ones, before ANY parsing. A
 * "scan" job (the security examination in quarantine) runs in scan-job.ts. An aborted job
 * (lease lost, stalled or shut down) is never completed or failed by this worker — its lease
 * runs out and another worker takes over.
 */

export interface ClaimedJob {
  job_id: string;
  version_id: string;
  kind: "scan" | "process" | "reembed";
  attempts: number;
  max_attempts: number;
  step_state: Record<string, Record<string, unknown>>;
  storage_path: string;
  checksum_sha256: string;
}

export interface StoredPage {
  page_number: number;
  text: string;
  has_text_layer: boolean;
  char_start: number;
  char_end: number;
}

export interface EmbeddingModelRow extends EmbeddingModelSpec {
  status: "active" | "candidate";
}

export interface ChunkToEmbed {
  chunk_id: string;
  text: string;
  lead_in: string | null;
  heading_path: string[];
  language: string;
}

export interface IntegrityRow {
  model_id: string;
  model: string;
  status: string;
  chunks: number;
  embeddings: number;
  wrong_dimensions: number;
}

export type StoragePurpose = "download_original" | "scan_original" | "release_original" | "quarantine_original";

/** What knowledge.worker_record_security_verdict answers: the DERIVED verdict and the next step. */
export interface RecordedVerdict {
  verdict_id: string;
  final: "safe" | "rejected" | "scan_failed";
  failure_code: string | null;
  next: "release" | "quarantine" | "retry";
}

export interface WorkerDb {
  claim(): Promise<ClaimedJob | null>;
  embeddingModels(): Promise<EmbeddingModelRow[]>;
  chunksToEmbed(jobId: string, modelId: string): Promise<ChunkToEmbed[]>;
  storeEmbeddings(jobId: string, modelId: string, rows: { chunk_id: string; embedding: number[]; language: string; input_hash: string }[]): Promise<number>;
  verifyIndex(jobId: string): Promise<IntegrityRow[]>;
  heartbeat(jobId: string): Promise<void>;
  checkpoint(jobId: string, step: string, state: Record<string, unknown>): Promise<void>;
  storePages(jobId: string, pages: StoredPage[], info: { pageCount: number; byteSize: number; mimeType: string; extractorVersion: string }): Promise<void>;
  storeChunks(jobId: string, chunks: Chunk[], chunkerVersion: string): Promise<number>;
  complete(jobId: string, report: WorkerQualityReport): Promise<void>;
  fail(jobId: string, code: string, message: string, retryable: boolean): Promise<"retry" | "failed">;
  issueStorageTicket(jobId: string, purpose: StoragePurpose): Promise<{ ticket: string; expiresAt: Date }>;
  /** Scan jobs: the active policy, its limits and what the upload declared. */
  securityScanContext(jobId: string): Promise<ScanContext>;
  /** Scan jobs: report the measurements; the database derives and stores the verdict. */
  recordSecurityVerdict(jobId: string, measurements: SecurityMeasurements): Promise<RecordedVerdict>;
  /** Process/re-embed jobs: the release gate (sha256 of the downloaded bytes, or null before). */
  securityClearance(jobId: string, sha256: string | null): Promise<Clearance>;
  /** Drops the process-local lease token of a job (after it ended or was abandoned). */
  forget(jobId: string): void;
}

/** The outcome of a move confirmed by the database (knowledge.confirm_worker_storage_operation). */
export type MoveOutcome = "released" | "already_released" | "invalidated" | "quarantined";

export interface OriginalStore {
  /** The bytes of the job's original. At most `maxBytes` (default: the bucket limit). */
  download(job: Pick<ClaimedJob, "job_id" | "storage_path">, purpose: "download_original" | "scan_original", maxBytes?: number): Promise<Uint8Array>;
  /** Moves the original out of quarantine — to knowledge-originals or knowledge-quarantine. */
  move(job: Pick<ClaimedJob, "job_id" | "storage_path">, purpose: "release_original" | "quarantine_original"): Promise<MoveOutcome>;
}

/** The tools of the security examination (scan jobs). */
export interface ScanTools {
  scanner: MalwareScanner;
  inspector: PdfInspector;
}

export type { AbortKind } from "./job-control.ts";

export interface PipelineDeps {
  db: WorkerDb;
  originals: OriginalStore;
  log: (event: Record<string, unknown>) => void;
  /** The release gate (gate.ts). Required: there is no default. */
  gate: SecurityGate;
  /** Scan jobs only. Without them a scan job fails closed (technical scan failure). */
  scan?: ScanTools;
  /** Defaults to the fail-closed registry (docs/07 §9.1). */
  embedderFor?: (model: EmbeddingModelSpec) => Embedder;
  /** Aborted by the runtime with { kind: AbortKind }. */
  signal?: AbortSignal;
}

const EMBED_BATCH = 64;

/** Embeds every chunk that lacks an embedding for each active/candidate model, then verifies. */
async function embedAndIndex(job: ClaimedJob, deps: PipelineDeps): Promise<{ models: IntegrityRow[]; active_model: string | null }> {
  const { db } = deps;
  const models = await db.embeddingModels();
  for (const model of models) {
    const embedder = (deps.embedderFor ?? createEmbedder)(model);
    const pending = await db.chunksToEmbed(job.job_id, model.id);
    for (let i = 0; i < pending.length; i += EMBED_BATCH) {
      const batch = pending.slice(i, i + EMBED_BATCH);
      const inputs = batch.map((chunk) => embeddingInput(chunk));
      // Chunks of a Knowledge Engine document version (8B-I2.5): classified as knowledge, so an
      // external embedder may receive them under the document policy. Nothing else is embedded.
      const vectors = await embedder.embed(inputs.map(knowledgeText), { inputType: "document" });
      if (vectors.length !== batch.length || vectors.some((vector) => vector.length !== model.dimensions)) {
        throw new Error("Embedderen returnerede et forkert antal vektorer eller en forkert dimension.");
      }
      await db.storeEmbeddings(
        job.job_id,
        model.id,
        batch.map((chunk, index) => ({
          chunk_id: chunk.chunk_id,
          embedding: vectors[index]!,
          language: chunk.language,
          input_hash: inputHash(embedder.id, inputs[index]!),
        })),
      );
      await db.heartbeat(job.job_id);
    }
  }
  const integrity = await db.verifyIndex(job.job_id);
  const incomplete = integrity.filter((row) => row.embeddings !== row.chunks || row.wrong_dimensions > 0);
  if (incomplete.length > 0) throw new Error("Indekset er ufuldstændigt efter embedding.");
  const active = models.find((model) => model.status === "active");
  return { models: integrity, active_model: active ? modelLabel(active) : null };
}

export { abortKind, isIdentityError, isLeaseLost, JobAborted, type JobOutcome } from "./job-control.ts";

export async function processJob(job: ClaimedJob, deps: PipelineDeps): Promise<JobOutcome> {
  const { db, log } = deps;
  const started = Date.now();
  const checkAborted = () => {
    const kind = abortKind(deps.signal);
    if (kind) throw new JobAborted(kind);
  };
  const step = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
    checkAborted();
    const begin = Date.now();
    const result = await run();
    log({ job: job.job_id, version: job.version_id, step: name, ms: Date.now() - begin });
    return result;
  };

  try {
    if (job.kind !== "process" && job.kind !== "reembed") throw new ProcessingBlocked("unknown_job_kind", "Ukendt jobtype.");
    // The release gate first: a version that is not released is neither downloaded nor embedded.
    const admitted = await step("gate", () => deps.gate.admit(job.job_id));
    if (!admitted.cleared) throw new ProcessingBlocked(admitted.code, admitted.message);
    if (job.kind === "reembed") {
      const embeddings = await step("embedding", () => embedAndIndex(job, deps));
      checkAborted();
      await db.complete(job.job_id, { reembed: embeddings } as unknown as WorkerQualityReport);
      log({ job: job.job_id, version: job.version_id, outcome: "succeeded", kind: "reembed", ms: Date.now() - started });
      return "succeeded";
    }

    const resumed = job.step_state.chunking;
    let report: WorkerQualityReport;

    if (
      resumed?.chunker_version === CHUNKER_VERSION &&
      resumed?.extractor_version === EXTRACTOR_VERSION &&
      resumed?.report
    ) {
      // Retry after a later step failed: pages and chunks are stored — resume from there.
      report = resumed.report as WorkerQualityReport;
      log({ job: job.job_id, version: job.version_id, step: "resume", from: "chunking" });
    } else {
      const bytes = await step("download", () => deps.originals.download(job, "download_original"));
      // The gate sees the downloaded bytes before ANY parsing: exactly the released bytes?
      const verdict = await step("gate", () => deps.gate.inspect({ jobId: job.job_id, bytes }));
      if (!verdict.cleared) throw new ProcessingBlocked(verdict.code, verdict.message);
      const { checksum } = await step("validation", async () => validateOriginal(bytes, job.checksum_sha256));
      await db.checkpoint(job.job_id, "validation", { checksum, byte_size: bytes.byteLength, gate: deps.gate.id, verdict: verdict.verdictId });

      const extracted = await step("extraction", () => extractPdf(bytes));
      if (!extracted.some((page) => page.hasTextLayer)) {
        throw new FileRejected("no_text", "Ingen tekst at læse. PDF'en har intet tekstlag (fx et scannet dokument), og OCR understøttes ikke.");
      }
      const { pages, stats } = await step("normalization", async () => normalizePages(extracted));
      const document = await step("structuring", async () => structurePages(pages));
      const chunks = await step("chunking", async () => chunkDocument(document));

      await db.heartbeat(job.job_id);
      await db.storePages(
        job.job_id,
        document.pages.map((page) => ({
          page_number: page.pageNumber,
          text: document.text.slice(page.start, page.end),
          has_text_layer: page.hasTextLayer,
          char_start: page.start,
          char_end: page.end,
        })),
        { pageCount: pages.length, byteSize: bytes.byteLength, mimeType: "application/pdf", extractorVersion: EXTRACTOR_VERSION },
      );
      await db.checkpoint(job.job_id, "extraction", { pages: pages.length, extractor_version: EXTRACTOR_VERSION });
      await db.storeChunks(job.job_id, chunks, CHUNKER_VERSION);

      report = buildQualityReport({
        document,
        chunks,
        normalization: stats,
        extractorVersion: EXTRACTOR_VERSION,
        chunkerVersion: CHUNKER_VERSION,
      });
      await db.checkpoint(job.job_id, "chunking", {
        chunks: chunks.length,
        chunker_version: CHUNKER_VERSION,
        extractor_version: EXTRACTOR_VERSION,
        report,
      });
    }

    const embeddings = await step("embedding", () => embedAndIndex(job, deps));
    await db.checkpoint(job.job_id, "embedding", { models: embeddings.models.map((row) => row.model) });
    report = { ...report, versions: { ...report.versions, embedding_model: embeddings.active_model }, embeddings };

    checkAborted();
    await db.complete(job.job_id, report);
    log({ job: job.job_id, version: job.version_id, outcome: "succeeded", ms: Date.now() - started });
    return "succeeded";
  } catch (error) {
    // Aborted by the runtime: never complete or fail — the lease runs out (or is already gone).
    const aborted = abortKind(deps.signal) ?? (error instanceof JobAborted ? error.kind : null);
    if (aborted) {
      const outcome: JobOutcome = aborted === "lease_lost" ? "lost" : "abandoned";
      log({ job: job.job_id, version: job.version_id, outcome, reason: aborted });
      return outcome;
    }
    if (isIdentityError(error)) throw error;
    // Failing needs the lease too: if it is gone meanwhile, the job is simply lost.
    const failOrLost = async (code: string, message: string, retryable: boolean): Promise<JobOutcome> => {
      try {
        return await db.fail(job.job_id, code, message, retryable);
      } catch (failure) {
        if (isLeaseLost(failure)) return "lost";
        throw failure;
      }
    };
    if (isLeaseLost(error)) {
      log({ job: job.job_id, version: job.version_id, outcome: "lost" });
      return "lost";
    }
    if (["GradeNotAllowedError", "ProviderNotConfiguredError"].includes((error as Error).name)) {
      const outcome = await failOrLost("embedding_unavailable", (error as Error).message, false);
      log({ job: job.job_id, version: job.version_id, outcome, code: "embedding_unavailable" });
      return outcome;
    }
    if (error instanceof ProcessingBlocked || error instanceof FileRejected) {
      const outcome = await failOrLost(error.code, error.message, false);
      log({ job: job.job_id, version: job.version_id, outcome, code: error.code });
      return outcome;
    }
    // Never log or store document content — only the kind of error.
    const name = (error as { name?: string }).name ?? "Error";
    const code = typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : undefined;
    const outcome = await failOrLost("processing_error", `Behandlingen fejlede (${name}). Der forsøges igen automatisk.`, true);
    log({ job: job.job_id, version: job.version_id, outcome, error: name, ...(code ? { code } : {}) });
    return outcome;
  }
}
