import type { OriginalStore, WorkerDb } from "./pipeline.ts";

/**
 * Originals through a one-time storage ticket (D-10 pkt. 3, docs/08b §21.5).
 *
 * The worker never holds a Storage credential. Under its lease it asks the database for a
 * ticket (worker_issue_storage_ticket), sends ONLY that ticket to the Edge Function
 * worker-storage, and receives the bytes of exactly the one object the ticket is bound to.
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

export interface TicketOriginalsOptions {
  db: Pick<WorkerDb, "issueStorageTicket">;
  url: string;
  fetchImpl?: typeof fetch;
  /** The bucket's limit (50 MB, docs/07). Larger responses are cut off and refused. */
  maxBytes?: number;
  timeoutMs?: number;
}

export function ticketOriginals(options: TicketOriginalsOptions): OriginalStore {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxBytes = options.maxBytes ?? 52_428_800;
  return {
    async download(job) {
      const { ticket } = await options.db.issueStorageTicket(job.job_id, "download_original");
      const response = await fetchImpl(options.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticket }),
        redirect: "error",
        signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
      });
      if (!response.ok || !response.body) throw new OriginalUnavailable(response.status);
      const declared = Number(response.headers.get("content-length") ?? "0");
      if (declared > maxBytes) throw new OriginalUnavailable(413);
      const reader = response.body.getReader();
      const parts: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          throw new OriginalUnavailable(413);
        }
        parts.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const part of parts) {
        bytes.set(part, offset);
        offset += part.byteLength;
      }
      return bytes;
    },
  };
}
