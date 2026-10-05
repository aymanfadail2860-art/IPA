/**
 * Edge Function worker-storage — redemption of the worker's one-time storage tickets
 * (D-10 pkt. 3, docs/08b §21.4–21.5). Runtime-agnostic: Web-standard Request/Response only, so
 * the same code runs in Supabase's Deno runtime (index.ts) and in the Node tests.
 *
 * Narrow responsibility:
 *   * Accepts exactly one thing: POST {"ticket": "<64 hex>"}. No path, bucket, purpose or other
 *     field is accepted — the ticket alone decides which object, and only one.
 *   * Redeems the ticket through knowledge.redeem_worker_storage_ticket (service_role inside
 *     Supabase only): one time, within 60 seconds, bound to job, version, path, purpose and the
 *     worker's still-valid lease.
 *   * Streams the bytes of that one object back. No signed URL, no credential and no other
 *     object ever leaves the function; nothing can be listed.
 *
 * The capability is the security boundary: Supabase Network Restrictions protect Postgres and
 * the pooler, not this HTTPS endpoint. The ticket is never logged.
 */

export interface RedeemedTicket {
  bucket: string;
  object_path: string;
  purpose: string;
  checksum_sha256: string;
}

export interface WorkerStorageDeps {
  /** Redeems the ticket; null when it is invalid, used, expired or its lease is gone. */
  redeem(ticket: string): Promise<RedeemedTicket | null>;
  /** Opens exactly this object; null when it does not exist. */
  openObject(bucket: string, path: string): Promise<{ body: ReadableStream<Uint8Array>; size: number | null } | null>;
  log(entry: Record<string, unknown>): void;
}

export const TICKET_BUCKET = "knowledge-originals";
export const TICKET_PURPOSE = "download_original";
const MAX_BODY_BYTES = 512;
const TICKET = /^[0-9a-f]{64}$/;

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
  if (
    redeemed.bucket !== TICKET_BUCKET ||
    redeemed.purpose !== TICKET_PURPOSE ||
    !redeemed.object_path ||
    redeemed.object_path.startsWith("/") ||
    redeemed.object_path.split("/").includes("..")
  ) {
    done(403, "ticket_out_of_contract");
    return reply(403, "ticket_rejected");
  }

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

/** The minimal Supabase client surface the function needs (supabase-js satisfies it). */
export interface StorageClient {
  schema(name: "knowledge"): {
    rpc(fn: "redeem_worker_storage_ticket", args: { p_ticket: string }): PromiseLike<{ data: unknown; error: { code?: string } | null }>;
  };
  storage: {
    from(bucket: string): { download(path: string): PromiseLike<{ data: Blob | null; error: unknown }> };
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
    log,
  };
}
