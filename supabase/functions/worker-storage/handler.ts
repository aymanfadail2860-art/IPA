/**
 * Edge Function worker-storage — redemption of the worker's one-time storage tickets
 * (D-10 pkt. 3, docs/08b §21.4–21.6). Runtime-agnostic: Web-standard Request/Response only, so
 * the same code runs in Supabase's Deno runtime (index.ts) and in the Node tests.
 *
 * Narrow responsibility:
 *   * Accepts exactly one thing: POST {"ticket": "<64 hex>"}. No path, bucket, purpose or other
 *     field is accepted — the ticket alone decides which object, which operation, and only one.
 *   * Redeems the ticket through knowledge.redeem_worker_storage_ticket (service_role inside
 *     Supabase only): one time, within 60 seconds, bound to job, version, path, purpose and the
 *     worker's still-valid lease.
 *   * stream (download_original, scan_original): streams the bytes of that one object back.
 *   * release (release_original): reads the object in quarantine, computes its SHA-256 and —
 *     only if it is the checksum the safe verdict was given for — writes exactly those bytes to
 *     knowledge-originals. The database confirms with the checksum of the bytes actually moved
 *     (knowledge.confirm_worker_storage_operation); different bytes void the verdict.
 *   * quarantine (quarantine_original): moves a rejected file to knowledge-quarantine, which
 *     nobody can read.
 *
 * No signed URL, no credential, no bytes of a move and no other object ever leave the
 * function; nothing can be listed. The capability is the security boundary: Supabase Network
 * Restrictions protect Postgres and the pooler, not this HTTPS endpoint. The ticket is never
 * logged.
 */

export interface RedeemedTicket {
  bucket: string;
  object_path: string;
  purpose: string;
  checksum_sha256: string;
  operation?: "stream" | "release" | "quarantine";
  destination_bucket?: string | null;
  ticket_id?: string | null;
}

export interface WorkerStorageDeps {
  /** Redeems the ticket; null when it is invalid, used, expired or its lease is gone. */
  redeem(ticket: string): Promise<RedeemedTicket | null>;
  /** Opens exactly this object; null when it does not exist. */
  openObject(bucket: string, path: string): Promise<{ body: ReadableStream<Uint8Array>; size: number | null } | null>;
  /** Writes these bytes to exactly this object (overwriting a copy of an earlier attempt). */
  writeObject?(bucket: string, path: string, bytes: Uint8Array): Promise<boolean>;
  /** Removes exactly this object. */
  removeObject?(bucket: string, path: string): Promise<boolean>;
  /** knowledge.confirm_worker_storage_operation: the database's outcome of a move. */
  confirm?(ticketId: string, sha256: string): Promise<string | null>;
  log(entry: Record<string, unknown>): void;
}

export const TICKET_BUCKET = "knowledge-originals";
export const TICKET_PURPOSE = "download_original";
export const INTAKE_BUCKET = "knowledge-intake";
export const QUARANTINE_BUCKET = "knowledge-quarantine";
/** Which source buckets each purpose may touch, and where a move may go. */
const CONTRACT: Record<string, { operation: "stream" | "release" | "quarantine"; sources: string[]; destination: string | null }> = {
  download_original: { operation: "stream", sources: [TICKET_BUCKET], destination: null },
  scan_original: { operation: "stream", sources: [INTAKE_BUCKET, TICKET_BUCKET], destination: null },
  release_original: { operation: "release", sources: [INTAKE_BUCKET, TICKET_BUCKET], destination: TICKET_BUCKET },
  quarantine_original: { operation: "quarantine", sources: [INTAKE_BUCKET, TICKET_BUCKET], destination: QUARANTINE_BUCKET },
};
const MAX_BODY_BYTES = 512;
/** The bucket limit (50 MB). A move never reads more. */
const MAX_OBJECT_BYTES = 52_428_800;
const TICKET = /^[0-9a-f]{64}$/;
const OUTCOMES = new Set(["released", "already_released", "invalidated", "quarantined"]);

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readAll(body: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array | null> {
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return null;
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
}

function reply(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function handleWorkerStorage(request: Request, deps: WorkerStorageDeps): Promise<Response> {
  const done = (status: number, outcome: string) => {
    deps.log({ event: "worker_storage", outcome, status });
  };
  if (request.method !== "POST") {
    done(405, "method_not_allowed");
    return reply(405, "method_not_allowed");
  }
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    done(415, "unsupported_media_type");
    return reply(415, "unsupported_media_type");
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    done(413, "too_large");
    return reply(413, "too_large");
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    done(413, "too_large");
    return reply(413, "too_large");
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }
  // Exactly {"ticket": string}. Anything else — a path, a bucket, extra fields — is refused.
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || typeof (body as { ticket?: unknown }).ticket !== "string") {
    done(400, "invalid_request");
    return reply(400, "invalid_request");
  }
  const ticket = (body as { ticket: string }).ticket;
  if (!TICKET.test(ticket)) {
    done(403, "ticket_rejected");
    return reply(403, "ticket_rejected");
  }

  let redeemed: RedeemedTicket | null;
  try {
    redeemed = await deps.redeem(ticket);
  } catch {
    done(503, "unavailable");
    return reply(503, "unavailable");
  }
  if (!redeemed) {
    done(403, "ticket_rejected");
    return reply(403, "ticket_rejected");
  }
  // Defence in depth: the database binds the ticket; the function still accepts only its one use.
  const contract = CONTRACT[redeemed.purpose];
  const operation = redeemed.operation ?? "stream";
  if (
    !contract ||
    contract.operation !== operation ||
    !contract.sources.includes(redeemed.bucket) ||
    (redeemed.destination_bucket ?? null) !== contract.destination ||
    (contract.destination !== null && (!redeemed.ticket_id || !TICKET.test(redeemed.checksum_sha256 ?? ""))) ||
    !redeemed.object_path ||
    redeemed.object_path.startsWith("/") ||
    redeemed.object_path.split("/").includes("..")
  ) {
    done(403, "ticket_out_of_contract");
    return reply(403, "ticket_rejected");
  }
  if (operation !== "stream") return move(redeemed, contract.destination!, deps, done);

  let object: Awaited<ReturnType<WorkerStorageDeps["openObject"]>>;
  try {
    object = await deps.openObject(redeemed.bucket, redeemed.object_path);
  } catch {
    object = null;
  }
  if (!object) {
    done(502, "object_unavailable");
    return reply(502, "object_unavailable");
  }
  done(200, "redeemed");
  const headers: Record<string, string> = {
    "content-type": "application/octet-stream",
    "cache-control": "no-store",
    "x-ipa-checksum-sha256": redeemed.checksum_sha256,
  };
  if (object.size !== null) headers["content-length"] = String(object.size);
  return new Response(object.body, { status: 200, headers });
}

/**
 * A move out of quarantine. The bytes are hashed HERE and only exactly those bytes are written;
 * the database decides the outcome from that checksum. The source is removed only after the
 * database confirmed the move.
 */
async function move(ticket: RedeemedTicket, destination: string, deps: WorkerStorageDeps, done: (status: number, outcome: string) => void): Promise<Response> {
  if (!deps.writeObject || !deps.removeObject || !deps.confirm) {
    done(501, "move_unsupported");
    return reply(501, "move_unsupported");
  }
  let bytes: Uint8Array | null = null;
  try {
    const object = await deps.openObject(ticket.bucket, ticket.object_path);
    if (object) bytes = await readAll(object.body, MAX_OBJECT_BYTES);
  } catch {
    bytes = null;
  }
  if (!bytes) {
    done(502, "object_unavailable");
    return reply(502, "object_unavailable");
  }
  const sha256 = await sha256Hex(bytes);
  const same = ticket.bucket === destination;
  // A release of bytes other than the scanned ones is never written: the database voids the verdict.
  const write = ticket.operation === "quarantine" || (sha256 === ticket.checksum_sha256 && !same);
  try {
    if (write && !(await deps.writeObject(destination, ticket.object_path, bytes))) {
      done(502, "write_failed");
      return reply(502, "write_failed");
    }
    const outcome = await deps.confirm(ticket.ticket_id!, sha256);
    if (!outcome || !OUTCOMES.has(outcome)) {
      done(502, "confirm_failed");
      return reply(502, "confirm_failed");
    }
    if ((outcome === "released" || outcome === "quarantined") && !same) {
      const removed = await deps.removeObject(ticket.bucket, ticket.object_path).catch(() => false);
      if (!removed) deps.log({ event: "worker_storage", outcome: "source_not_removed", operation: ticket.operation });
    }
    done(200, outcome);
    return new Response(JSON.stringify({ outcome }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch {
    done(503, "unavailable");
    return reply(503, "unavailable");
  }
}

/** The minimal Supabase client surface the function needs (supabase-js satisfies it). */
export interface StorageClient {
  schema(name: "knowledge"): {
    rpc(fn: "redeem_worker_storage_ticket", args: { p_ticket: string }): PromiseLike<{ data: unknown; error: { code?: string } | null }>;
    rpc(fn: "confirm_worker_storage_operation", args: { p_ticket_id: string; p_sha256: string }): PromiseLike<{ data: unknown; error: { code?: string } | null }>;
  };
  storage: {
    from(bucket: string): {
      download(path: string): PromiseLike<{ data: Blob | null; error: unknown }>;
      upload(path: string, body: Uint8Array, options: { contentType: string; upsert: boolean }): PromiseLike<{ error: unknown }>;
      remove(paths: string[]): PromiseLike<{ error: unknown }>;
    };
  };
}

/** Wires the handler to a service-role client. The client never leaves the function. */
export function supabaseStorageDeps(client: StorageClient, log: (entry: Record<string, unknown>) => void): WorkerStorageDeps {
  return {
    async redeem(ticket) {
      const { data, error } = await client.schema("knowledge").rpc("redeem_worker_storage_ticket", { p_ticket: ticket });
      if (error) {
        if (error.code === "28000") return null;
        throw new Error("redeem_failed");
      }
      const row = Array.isArray(data) ? (data[0] as RedeemedTicket | undefined) : undefined;
      return row ?? null;
    },
    async openObject(bucket, path) {
      const { data, error } = await client.storage.from(bucket).download(path);
      if (error || !data) return null;
      return { body: data.stream(), size: data.size };
    },
    async writeObject(bucket, path, bytes) {
      const { error } = await client.storage.from(bucket).upload(path, bytes, { contentType: "application/pdf", upsert: true });
      return !error;
    },
    async removeObject(bucket, path) {
      const { error } = await client.storage.from(bucket).remove([path]);
      return !error;
    },
    async confirm(ticketId, sha256) {
      const { data, error } = await client.schema("knowledge").rpc("confirm_worker_storage_operation", { p_ticket_id: ticketId, p_sha256: sha256 });
      if (error) {
        if (error.code === "28000") return null;
        throw new Error("confirm_failed");
      }
      return typeof data === "string" ? data : null;
    },
    log,
  };
}
