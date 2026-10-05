import { readFileSync } from "node:fs";

import postgres, { type JSONValue, type Options, type PendingQuery, type Row, type Sql } from "postgres";

import type { PostgresConfig } from "./config.ts";
import type { Chunk } from "./chunker.ts";
import type { Clearance } from "./gate.ts";
import type { ChunkToEmbed, ClaimedJob, EmbeddingModelRow, IntegrityRow, RecordedVerdict, WorkerDb } from "./pipeline.ts";
import type { ScanContext } from "./security/scan.ts";

/**
 * The production worker's database adapter (docs/08b §21.5): postgres.js, connected as the
 * active blue/green login role through Supavisor in transaction mode.
 *
 *   * ONLY the locked knowledge.worker_* API (I3). No table is queried or written, no admin or
 *     ops function is called (architecture test). Every call is one statement = one
 *     transaction, so nothing depends on session state between transactions.
 *   * prepare: false — Supavisor's transaction mode does not keep prepared statements.
 *   * fetch_types: false — no catalog query on connect.
 *   * The lease token from worker_claim_job lives only in this process, per job. The job id
 *     alone gives no access (I3).
 */

const APPLICATION_NAME = "ipa-ingestion-worker";

/** The postgres.js options for the worker. Exported so the configuration can be tested. */
export function postgresOptions(config: PostgresConfig, readFile: (path: string) => string = (path) => readFileSync(path, "utf8")): Options<Record<string, never>> {
  return {
    host: config.host,
    port: config.port,
    database: config.database,
    username: config.username,
    password: config.password,
    ssl: config.ssl === "verify-full" ? { ca: readFile(config.caFile!), rejectUnauthorized: true, servername: config.host } : false,
    prepare: false,
    fetch_types: false,
    max: config.poolMax,
    connect_timeout: config.connectTimeoutSeconds,
    idle_timeout: 30,
    max_lifetime: 15 * 60,
    connection: { application_name: APPLICATION_NAME },
    onnotice: () => {},
    debug: false,
  };
}

export function connectWorkerDatabase(config: PostgresConfig): Sql {
  return postgres(postgresOptions(config));
}

/** Cancels the query client-side after `ms` (the role's statement_timeout is the server side). */
async function timed<T extends readonly Row[]>(query: PendingQuery<T>, ms: number): Promise<T> {
  const timer = setTimeout(() => void query.cancel(), ms);
  try {
    return await query;
  } finally {
    clearTimeout(timer);
  }
}

type ClaimedRow = ClaimedJob & { lease_token: string; lease_expires_at: Date };

export interface PostgresWorkerDbOptions {
  leaseSeconds: number;
  queryTimeoutMs: number;
}

export function postgresWorkerDb(sql: Sql, workerLabel: string, options: PostgresWorkerDbOptions): WorkerDb {
  const leases = new Map<string, string>();
  const lease = (jobId: string): string => {
    const token = leases.get(jobId);
    if (!token) throw Object.assign(new Error("Workeren har ingen lease på jobbet."), { code: "55P03" });
    return token;
  };
  const run = <T extends readonly Row[]>(query: PendingQuery<T>) => timed(query, options.queryTimeoutMs);
  // Typed by the server as jsonb: postgres.js serializes the value itself (a pre-stringified
  // value would arrive as a JSON string).
  const json = (value: unknown) => sql.json(value as JSONValue);

  return {
    async claim() {
      const rows = await run(sql<ClaimedRow[]>`select * from knowledge.worker_claim_job(${workerLabel}::text, ${options.leaseSeconds}::int)`);
      const row = rows[0];
      if (!row) return null;
      // The token stays here; the pipeline only sees the job.
      const { lease_token: token, ...job } = row;
      leases.set(job.job_id, token);
      return job as ClaimedJob;
    },
    async embeddingModels() {
      return [...(await run(sql<EmbeddingModelRow[]>`select * from knowledge.worker_embedding_models()`))];
    },
    async chunksToEmbed(jobId, modelId) {
      // text[] arrives as jsonb: with fetch_types off, postgres.js parses no array types.
      return [
        ...(await run(
          sql<ChunkToEmbed[]>`select chunk_id, text, lead_in, to_jsonb(heading_path) as heading_path, language from knowledge.worker_chunks_to_embed(${jobId}::uuid, ${lease(jobId)}::text, ${modelId}::uuid)`,
        )),
      ];
    },
    async storeEmbeddings(jobId, modelId, rows) {
      const [result] = await run(
        sql<{ stored: number }[]>`select knowledge.worker_store_embeddings(${jobId}::uuid, ${lease(jobId)}::text, ${modelId}::uuid, ${json(rows)}::jsonb) as stored`,
      );
      return result!.stored;
    },
    async verifyIndex(jobId) {
      const [result] = await run(sql<{ integrity: IntegrityRow[] }[]>`select knowledge.worker_verify_index(${jobId}::uuid, ${lease(jobId)}::text) as integrity`);
      return result!.integrity ?? [];
    },
    async heartbeat(jobId) {
      await run(sql`select knowledge.worker_heartbeat(${jobId}::uuid, ${lease(jobId)}::text, ${options.leaseSeconds}::int) as lease_expires_at`);
    },
    async checkpoint(jobId, step, state) {
      await run(sql`select knowledge.worker_checkpoint(${jobId}::uuid, ${lease(jobId)}::text, ${step}::text, ${json(state)}::jsonb)`);
    },
    async storePages(jobId, pages, info) {
      await run(
        sql`select knowledge.worker_store_pages(${jobId}::uuid, ${lease(jobId)}::text, ${json(pages)}::jsonb, ${info.pageCount}::int, ${info.byteSize}::bigint, ${info.mimeType}::text, ${info.extractorVersion}::text)`,
      );
    },
    async storeChunks(jobId, chunks: Chunk[], chunkerVersion) {
      const payload = chunks.map((chunk) => ({
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
      }));
      const [result] = await run(
        sql<{ stored: number }[]>`select knowledge.worker_store_chunks(${jobId}::uuid, ${lease(jobId)}::text, ${json(payload)}::jsonb, ${chunkerVersion}::text) as stored`,
      );
      return result!.stored;
    },
    async complete(jobId, report) {
      await run(sql`select knowledge.worker_complete_job(${jobId}::uuid, ${lease(jobId)}::text, ${json(report)}::jsonb)`);
      leases.delete(jobId);
    },
    async fail(jobId, code, message, retryable) {
      try {
        const [result] = await run(
          sql<{ outcome: "retry" | "failed" }[]>`select knowledge.worker_fail_job(${jobId}::uuid, ${lease(jobId)}::text, ${code}::text, ${message}::text, ${retryable}::boolean) as outcome`,
        );
        return result!.outcome;
      } finally {
        leases.delete(jobId);
      }
    },
    async issueStorageTicket(jobId, purpose) {
      const [row] = await run(sql<{ ticket: string; expires_at: Date }[]>`select * from knowledge.worker_issue_storage_ticket(${jobId}::uuid, ${lease(jobId)}::text, ${purpose}::text)`);
      if (!row) throw new Error("Ingen billet.");
      return { ticket: row.ticket, expiresAt: row.expires_at };
    },
    async securityScanContext(jobId) {
      const [row] = await run(sql<{ context: ScanContext }[]>`select knowledge.worker_security_scan_context(${jobId}::uuid, ${lease(jobId)}::text) as context`);
      return row!.context;
    },
    async recordSecurityVerdict(jobId, measurements) {
      const [row] = await run(
        sql<{ verdict: RecordedVerdict }[]>`select knowledge.worker_record_security_verdict(${jobId}::uuid, ${lease(jobId)}::text, ${json(measurements)}::jsonb) as verdict`,
      );
      return row!.verdict;
    },
    async securityClearance(jobId, sha256) {
      const [row] = await run(sql<{ clearance: Clearance }[]>`select knowledge.worker_security_clearance(${jobId}::uuid, ${lease(jobId)}::text, ${sha256}::text) as clearance`);
      return row!.clearance;
    },
    forget(jobId) {
      leases.delete(jobId);
    },
  };
}
