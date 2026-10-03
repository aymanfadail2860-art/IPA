import { embeddingInput, inputHash, modelLabel, type Embedder, type EmbeddingModelSpec } from "../../src/lib/knowledge/core/embedding.ts";
import { createEmbedder } from "../../src/lib/knowledge/core/registry.ts";

import { CHUNKER_VERSION, chunkDocument, type Chunk } from "./chunker.ts";
import { EXTRACTOR_VERSION, extractPdf } from "./extract.ts";
import { normalizePages } from "./normalize.ts";
import { buildQualityReport, type WorkerQualityReport } from "./quality.ts";
import { structurePages } from "./structure.ts";
import { FileRejected } from "./types.ts";
import { validateOriginal } from "./validate.ts";

/**
 * One ingestion job (docs/07 §5.2): validation → extraction → normalization → structuring →
 * chunking → embedding → indexing → quality report → "Klar til review". A "reembed" job only
 * adds embeddings for a candidate model to an already processed version (docs/07 §7).
 *
 * Technical processing only. Nothing here can make a version authoritative: the database
 * functions the worker calls cannot publish, and only `processed` is ever reached.
 */

export interface ClaimedJob {
  job_id: string;
  version_id: string;
  kind: "process" | "reembed";
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
}

export interface OriginalStore {
  download(path: string): Promise<Uint8Array>;
}

export interface PipelineDeps {
  db: WorkerDb;
  originals: OriginalStore;
  log: (event: Record<string, unknown>) => void;
  /** Defaults to the fail-closed registry (docs/07 §9.1). */
  embedderFor?: (model: EmbeddingModelSpec) => Embedder;
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
      const vectors = await embedder.embed(inputs, { inputType: "document" });
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

export type JobOutcome = "succeeded" | "retry" | "failed" | "lost";

/** The database refused the job: another worker holds it (lease expired). Stop silently. */
function isLeaseLost(error: unknown): boolean {
  return (error as { code?: string }).code === "55P03";
}

export async function processJob(job: ClaimedJob, deps: PipelineDeps): Promise<JobOutcome> {
  const { db, log } = deps;
  const started = Date.now();
  const step = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
    const begin = Date.now();
    const result = await run();
    log({ job: job.job_id, version: job.version_id, step: name, ms: Date.now() - begin });
    return result;
  };

  try {
    if (job.kind === "reembed") {
      const embeddings = await step("embedding", () => embedAndIndex(job, deps));
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
      const bytes = await step("download", () => deps.originals.download(job.storage_path));
      const { checksum } = await step("validation", async () => validateOriginal(bytes, job.checksum_sha256));
      await db.checkpoint(job.job_id, "validation", { checksum, byte_size: bytes.byteLength });

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

    await db.complete(job.job_id, report);
    log({ job: job.job_id, version: job.version_id, outcome: "succeeded", ms: Date.now() - started });
    return "succeeded";
  } catch (error) {
    if (isLeaseLost(error)) {
      log({ job: job.job_id, version: job.version_id, outcome: "lost" });
      return "lost";
    }
    if (["GradeNotAllowedError", "ProviderNotConfiguredError"].includes((error as Error).name)) {
      const outcome = await db.fail(job.job_id, "embedding_unavailable", (error as Error).message, false);
      log({ job: job.job_id, version: job.version_id, outcome, code: "embedding_unavailable" });
      return outcome;
    }
    if (error instanceof FileRejected) {
      const outcome = await db.fail(job.job_id, error.code, error.message, false);
      log({ job: job.job_id, version: job.version_id, outcome, code: error.code });
      return outcome;
    }
    // Never log or store document content — only the kind of error.
    const name = (error as { name?: string }).name ?? "Error";
    const outcome = await db.fail(job.job_id, "processing_error", `Behandlingen fejlede (${name}). Der forsøges igen automatisk.`, true);
    log({ job: job.job_id, version: job.version_id, outcome, error: name });
    return outcome;
  }
}
