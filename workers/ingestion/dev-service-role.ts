import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Chunk } from "./chunker.ts";
import { handleWorkerStorage, supabaseStorageDeps, type StorageClient } from "../../supabase/functions/worker-storage/handler.ts";

import type { Clearance } from "./gate.ts";
import type { HealthSource } from "./health-monitor.ts";
import { ticketOriginals } from "./originals.ts";
import type { ChunkToEmbed, ClaimedJob, EmbeddingModelRow, IntegrityRow, OriginalStore, RecordedVerdict, WorkerDb } from "./pipeline.ts";
import type { ScanContext } from "./security/scan.ts";

/**
 * ⚠ DEVELOPMENT-ONLY worker access (phase 7, B-16; docs/08b §6.1.1 pkt. 6).
 *
 * The local worker reaches the same knowledge.worker_* functions through PostgREST with the
 * local service-role key; the database lets service_role in only through the development seed
 * (supabase/seed.sql). Originals go through the same one-time tickets and the same storage
 * handler as in production (worker-storage/handler.ts), run in-process with the local
 * service-role client — so quarantine, release and the checksum confirmation are the real ones.
 *
 * This file is never part of the production worker: main.ts loads it only when the validated
 * configuration is the local/test service-role path, the production image does not contain it
 * (.dockerignore), and @supabase/supabase-js is not in the image (guardrail tests). The
 * production adapter is db.ts (postgres.js, own login role, docs/08b §21.5).
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

export function createDevServiceRoleClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function devServiceRoleWorkerDb(client: SupabaseClient, workerId: string): WorkerDb {
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
    async issueStorageTicket(jobId, purpose) {
      const rows = await call<{ ticket: string; expires_at: string }[]>(
        knowledge.rpc("worker_issue_storage_ticket", { p_job_id: jobId, p_lease_token: lease(jobId), p_purpose: purpose }),
      );
      const row = rows?.[0];
      if (!row) throw new Error("Ingen billet.");
      return { ticket: row.ticket, expiresAt: new Date(row.expires_at) };
    },
    async securityScanContext(jobId) {
      return call<ScanContext>(knowledge.rpc("worker_security_scan_context", { p_job_id: jobId, p_lease_token: lease(jobId) }));
    },
    async recordSecurityVerdict(jobId, measurements) {
      return call<RecordedVerdict>(knowledge.rpc("worker_record_security_verdict", { p_job_id: jobId, p_lease_token: lease(jobId), p_result: measurements }));
    },
    async securityClearance(jobId, sha256) {
      return call<Clearance>(knowledge.rpc("worker_security_clearance", { p_job_id: jobId, p_lease_token: lease(jobId), p_sha256: sha256 }));
    },
    forget(jobId) {
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

export function devServiceRoleOriginals(client: SupabaseClient, db: Pick<WorkerDb, "issueStorageTicket">): OriginalStore {
  const deps = supabaseStorageDeps(client as unknown as StorageClient, () => {});
  return ticketOriginals({ db, url: "http://worker-storage.local/", fetchImpl: async (_url, init) => handleWorkerStorage(new Request("http://worker-storage.local/", init), deps) });
}

/** The health check over the development path (local/test only). */
export function devServiceRoleHealthSource(client: SupabaseClient): HealthSource {
  return {
    async systemHealth() {
      return call<unknown>(client.schema("knowledge").rpc("worker_system_health"));
    },
  };
}
