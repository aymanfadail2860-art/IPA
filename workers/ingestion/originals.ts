import type { MoveOutcome, OriginalStore, StoragePurpose, WorkerDb } from "./pipeline.ts";

/**
 * Originals through a one-time storage ticket (D-10 pkt. 3, docs/08b §21.5–21.6).
 *
 * The worker never holds a Storage credential. Under its lease it asks the database for a
 * ticket (worker_issue_storage_ticket) for ONE purpose, sends ONLY that ticket to the Edge
 * Function worker-storage, and gets:
 *
 *   * download_original / scan_original: the bytes of exactly the one object the ticket is
 *     bound to (a released original, or one in quarantine for the security examination);
 *   * release_original / quarantine_original: the outcome of moving that object out of
 *     quarantine, as confirmed by the database with the checksum of the bytes actually moved.
 *
 * The ticket is never logged and never sent anywhere else.
 */

export class OriginalUnavailable extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Originalen kunne ikke hentes (HTTP ${status}).`);
    this.name = "OriginalUnavailable";
    this.status = status;
  }
}

/** The object is larger than allowed. `received` holds the first bytes (at most limit + 1). */
export class OriginalTooLarge extends OriginalUnavailable {
  readonly received: Uint8Array;
  constructor(received: Uint8Array) {
    super(413);
    this.name = "OriginalTooLarge";
    this.received = received;
  }
}

export interface TicketOriginalsOptions {
  db: Pick<WorkerDb, "issueStorageTicket">;
  url: string;
  fetchImpl?: typeof fetch;
  /** The bucket's limit (50 MB, docs/07). Larger responses are cut off and refused. */
  maxBytes?: number;
  timeoutMs?: number;
}

const OUTCOMES: readonly MoveOutcome[] = ["released", "already_released", "invalidated", "quarantined"];

/** Reads a body up to `limit` bytes; one byte more and it stops with OriginalTooLarge. */
export async function readLimited(body: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  let tooLarge = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = limit + 1 - size;
    const part = value.byteLength > room ? value.subarray(0, room) : value;
    parts.push(part);
    size += part.byteLength;
    if (size > limit) {
      tooLarge = true;
      await reader.cancel().catch(() => {});
      break;
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  if (tooLarge) throw new OriginalTooLarge(bytes);
  return bytes;
}

export function ticketOriginals(options: TicketOriginalsOptions): OriginalStore {
  const fetchImpl = options.fetchImpl ?? fetch;
  const bucketLimit = options.maxBytes ?? 52_428_800;
  const redeem = async (jobId: string, purpose: StoragePurpose): Promise<Response> => {
    const { ticket } = await options.db.issueStorageTicket(jobId, purpose);
    return fetchImpl(options.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket }),
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
    });
  };
  return {
    async download(job, purpose, maxBytes) {
      const limit = Math.min(maxBytes ?? bucketLimit, bucketLimit);
      const response = await redeem(job.job_id, purpose);
      if (!response.ok || !response.body) throw new OriginalUnavailable(response.status);
      return readLimited(response.body, limit);
    },
    async move(job, purpose) {
      const response = await redeem(job.job_id, purpose);
      if (!response.ok) throw new OriginalUnavailable(response.status);
      const body = (await response.json().catch(() => null)) as { outcome?: unknown } | null;
      const outcome = body?.outcome;
      if (typeof outcome !== "string" || !OUTCOMES.includes(outcome as MoveOutcome)) throw new OriginalUnavailable(502);
      return outcome as MoveOutcome;
    },
  };
}
