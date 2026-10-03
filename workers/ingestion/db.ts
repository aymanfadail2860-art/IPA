import type { SupabaseClient } from "@supabase/supabase-js";

import type { Chunk } from "./chunker.ts";
import type { ChunkToEmbed, ClaimedJob, EmbeddingModelRow, IntegrityRow, OriginalStore, WorkerDb } from "./pipeline.ts";

/**
 * The worker's only ways into the database and Storage (docs/07 §14.1): a narrow set of
 * named functions in the knowledge schema, and read access to originals. No direct table
 * writes. The connection is a development-only service-role client (B-16), allowed only in
 * local/test (main.ts); in production the worker connects as its own login role
 * (docs/08b §6.1.1, §21.4) — without changing this interface or the domain model.
 *
 * Every call on a job carries the lease token that worker_claim_job returned (8B-I3). The
 * token lives only in this process, keyed by job id, and is dropped when the job is completed
 * or failed. The job id alone gives no access.
 */

const LEASE_SECONDS = 300;

type ClaimedRow = ClaimedJob & { lease_token: string };

async function call<T>(promise: PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>): Promise<T> {
  const { data, error } = await promise;
  if (error) {
    const failure = new Error(error.message) as Error & { code?: string };
    failure.code = error.code;
    throw failure;
  }
  return data as T;
}

export function supabaseWorkerDb(client: SupabaseClient, workerId: string): WorkerDb {
  const knowledge = client.schema("knowledge");
  const leases = new Map<string, string>();
  const lease = (jobId: string): string => {
    const token = leases.get(jobId);
    if (!token) throw new Error("Workeren har ingen lease på jobbet.");
    return token;
  };
  return {
    async claim() {
      const rows = await call<ClaimedRow[]>(knowledge.rpc("worker_claim_job", { p_worker: workerId, p_lease_seconds: LEASE_SECONDS }));
      const row = rows?.[0];
      if (!row) return null;
      // The token stays here; the pipeline only sees the job.
      const { lease_token: token, ...job } = row;
      leases.set(job.job_id, token);
      return job;
    },
    async embeddingModels() {
      return (await call<EmbeddingModelRow[]>(knowledge.rpc("worker_embedding_models"))) ?? [];
    },
    async chunksToEmbed(jobId, modelId) {
      return (await call<ChunkToEmbed[]>(knowledge.rpc("worker_chunks_to_embed", { p_job_id: jobId, p_lease_token: lease(jobId), p_model_id: modelId }))) ?? [];
    },
    async storeEmbeddings(jobId, modelId, rows) {
      return call<number>(knowledge.rpc("worker_store_embeddings", { p_job_id: jobId, p_lease_token: lease(jobId), p_model_id: modelId, p_rows: rows }));
    },
    async verifyIndex(jobId) {
      return (await call<IntegrityRow[]>(knowledge.rpc("worker_verify_index", { p_job_id: jobId, p_lease_token: lease(jobId) }))) ?? [];
    },
    async heartbeat(jobId) {
      await call(knowledge.rpc("worker_heartbeat", { p_job_id: jobId, p_lease_token: lease(jobId), p_lease_seconds: LEASE_SECONDS }));
    },
    async checkpoint(jobId, step, state) {
      await call(knowledge.rpc("worker_checkpoint", { p_job_id: jobId, p_lease_token: lease(jobId), p_step: step, p_state: state }));
    },
    async storePages(jobId, pages, info) {
      await call(
        knowledge.rpc("worker_store_pages", {
          p_job_id: jobId,
          p_lease_token: lease(jobId),
          p_pages: pages,
          p_page_count: info.pageCount,
          p_byte_size: info.byteSize,
          p_mime_type: info.mimeType,
          p_extractor_version: info.extractorVersion,
        }),
      );
    },
    async storeChunks(jobId, chunks: Chunk[], chunkerVersion) {
      return call<number>(
        knowledge.rpc("worker_store_chunks", {
          p_job_id: jobId,
          p_lease_token: lease(jobId),
          p_chunker_version: chunkerVersion,
          p_chunks: chunks.map((chunk) => ({
            chunk_index: chunk.chunkIndex,
            kind: chunk.kind,
            text: chunk.text,
            lead_in: chunk.leadIn,
            heading: chunk.heading,
            heading_path: chunk.headingPath,
            section_number: chunk.sectionNumber,
            page_start: chunk.pageStart,
            page_end: chunk.pageEnd,
            char_start: chunk.charStart,
            char_end: chunk.charEnd,
            overlap_chars: chunk.overlapChars,
            content_hash: chunk.contentHash,
            char_count: chunk.charCount,
            token_estimate: chunk.tokenEstimate,
          })),
        }),
      );
    },
    async complete(jobId, report) {
      await call(knowledge.rpc("worker_complete_job", { p_job_id: jobId, p_lease_token: lease(jobId), p_quality_report: report }));
      leases.delete(jobId);
    },
    async fail(jobId, code, message, retryable) {
      try {
        return await call<"retry" | "failed">(
          knowledge.rpc("worker_fail_job", { p_job_id: jobId, p_lease_token: lease(jobId), p_error_code: code, p_error_message: message, p_retryable: retryable }),
        );
      } finally {
        leases.delete(jobId);
      }
    },
  };
}

export function supabaseOriginals(client: SupabaseClient): OriginalStore {
  return {
    async download(path) {
      const { data, error } = await client.storage.from("knowledge-originals").download(path);
      if (error || !data) throw new Error("Originalen kunne ikke hentes fra Storage.");
      return new Uint8Array(await data.arrayBuffer());
    },
  };
}
