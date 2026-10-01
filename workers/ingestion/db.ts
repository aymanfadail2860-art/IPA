import type { SupabaseClient } from "@supabase/supabase-js";

import type { Chunk } from "./chunker.ts";
import type { ClaimedJob, OriginalStore, WorkerDb } from "./pipeline.ts";

/**
 * The worker's only ways into the database and Storage (docs/07 §14.1): a narrow set of
 * named functions in the knowledge schema, and read access to originals. No direct table
 * writes. The connection is a development-only service-role client (B-16); a dedicated
 * least-privilege worker access replaces it before production data — without changing
 * this interface or the domain model.
 */

const LEASE_SECONDS = 300;

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
  return {
    async claim() {
      const rows = await call<ClaimedJob[]>(knowledge.rpc("worker_claim_job", { p_worker: workerId, p_lease_seconds: LEASE_SECONDS }));
      return rows?.[0] ?? null;
    },
    async heartbeat(jobId) {
      await call(knowledge.rpc("worker_heartbeat", { p_job_id: jobId, p_worker: workerId, p_lease_seconds: LEASE_SECONDS }));
    },
    async checkpoint(jobId, step, state) {
      await call(knowledge.rpc("worker_checkpoint", { p_job_id: jobId, p_worker: workerId, p_step: step, p_state: state }));
    },
    async storePages(jobId, pages, info) {
      await call(
        knowledge.rpc("worker_store_pages", {
          p_job_id: jobId,
          p_worker: workerId,
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
          p_worker: workerId,
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
      await call(knowledge.rpc("worker_complete_job", { p_job_id: jobId, p_worker: workerId, p_quality_report: report }));
    },
    async fail(jobId, code, message, retryable) {
      return call<"retry" | "failed">(
        knowledge.rpc("worker_fail_job", { p_job_id: jobId, p_worker: workerId, p_error_code: code, p_error_message: message, p_retryable: retryable }),
      );
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
