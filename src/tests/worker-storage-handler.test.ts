import { describe, expect, it, vi } from "vitest";

import { handleWorkerStorage, supabaseStorageDeps, type RedeemedTicket, type StorageClient, type WorkerStorageDeps } from "../../supabase/functions/worker-storage/handler.ts";

/**
 * 8B-I4 — Edge Function worker-storage (docs/08b §21.5): the one-time ticket is the only
 * input and the security boundary. One object, one time; no path, no listing, no credential
 * out; the ticket is never logged.
 */

const TICKET = "a1".repeat(32);
const VALID: RedeemedTicket = { bucket: "knowledge-originals", object_path: "doc/ver/original.pdf", purpose: "download_original", checksum_sha256: "f".repeat(64) };

function deps(overrides: Partial<WorkerStorageDeps> = {}) {
  const logs: Record<string, unknown>[] = [];
  const used = new Set<string>();
  const opened: string[] = [];
  const value: WorkerStorageDeps = {
    redeem: async (ticket) => {
      if (ticket !== TICKET || used.has(ticket)) return null;
      used.add(ticket);
      return VALID;
    },
    openObject: async (bucket, path) => {
      opened.push(`${bucket}/${path}`);
      return { body: new Blob([new Uint8Array([37, 80, 68, 70])]).stream(), size: 4 };
    },
    log: (entry) => void logs.push(entry),
    ...overrides,
  };
  return { value, logs, opened };
}

const post = (body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) =>
  new Request("https://fn.test/functions/v1/worker-storage", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("worker-storage ticket redemption", () => {
  it("streams the one object of a valid ticket — no URL, no credential in the response", async () => {
    const d = deps();
    const response = await handleWorkerStorage(post({ ticket: TICKET }), d.value);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([37, 80, 68, 70]));
    expect(response.headers.get("x-ipa-checksum-sha256")).toBe(VALID.checksum_sha256);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect([...response.headers.keys()].sort()).toEqual(["cache-control", "content-length", "content-type", "x-ipa-checksum-sha256"]);
    expect(d.opened).toEqual(["knowledge-originals/doc/ver/original.pdf"]);
  });

  it("a ticket works once: a replay is refused", async () => {
    const d = deps();
    expect((await handleWorkerStorage(post({ ticket: TICKET }), d.value)).status).toBe(200);
    const replay = await handleWorkerStorage(post({ ticket: TICKET }), d.value);
    expect(replay.status).toBe(403);
    expect(await replay.json()).toEqual({ error: "ticket_rejected" });
    expect(d.opened).toHaveLength(1);
  });

  it.each([
    ["forged", { ticket: "b2".repeat(32) }, 403],
    ["malformed", { ticket: "not-a-ticket" }, 403],
    ["uppercase", { ticket: TICKET.toUpperCase() }, 403],
    ["a path (arbitrary object attempt)", { ticket: TICKET, path: "other/doc.pdf" }, 400],
    ["a bucket", { ticket: TICKET, bucket: "anything" }, 400],
    ["no ticket", { path: "doc.pdf" }, 400],
    ["an array", [TICKET], 400],
    ["not JSON", "ticket=x", 400],
  ])("refuses %s without opening any object", async (_name, body, status) => {
    const d = deps();
    expect((await handleWorkerStorage(post(body), d.value)).status).toBe(status);
    expect(d.opened).toEqual([]);
  });

  it("only POST with JSON and a tiny body", async () => {
    const d = deps();
    expect((await handleWorkerStorage(new Request("https://fn.test/x?path=doc.pdf"), d.value)).status).toBe(405);
    expect((await handleWorkerStorage(post({ ticket: TICKET }, { "content-type": "text/plain" }), d.value)).status).toBe(415);
    expect((await handleWorkerStorage(post({ ticket: TICKET, pad: "x".repeat(600) }), d.value)).status).toBe(413);
    expect(d.opened).toEqual([]);
  });

  it("refuses an expired, used or lease-less ticket the database will not redeem (uniform answer)", async () => {
    const d = deps({ redeem: async () => null });
    const response = await handleWorkerStorage(post({ ticket: TICKET }), d.value);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "ticket_rejected" });
  });

  it("refuses a redemption outside the contract even if the database returned one (defence in depth)", async () => {
    for (const odd of [{ ...VALID, bucket: "other" }, { ...VALID, purpose: "quarantine" }, { ...VALID, object_path: "../secrets" }, { ...VALID, object_path: "/abs" }]) {
      const d = deps({ redeem: async () => odd });
      expect((await handleWorkerStorage(post({ ticket: TICKET }), d.value)).status).toBe(403);
      expect(d.opened).toEqual([]);
    }
  });

  it("reports a database outage as unavailable, not as a valid or invalid ticket", async () => {
    const d = deps({ redeem: async () => Promise.reject(new Error("down")) });
    expect((await handleWorkerStorage(post({ ticket: TICKET }), d.value)).status).toBe(503);
  });

  it("never logs the ticket or the object path", async () => {
    const d = deps();
    await handleWorkerStorage(post({ ticket: TICKET }), d.value);
    await handleWorkerStorage(post({ ticket: TICKET }), d.value);
    await handleWorkerStorage(post({ ticket: "zz" }), d.value);
    const text = JSON.stringify(d.logs);
    expect(text).not.toContain(TICKET);
    expect(text).not.toContain("original.pdf");
    expect(d.logs.map((entry) => entry.outcome)).toEqual(["redeemed", "ticket_rejected", "ticket_rejected"]);
  });

  it("wires the service-role client to exactly one RPC and one object download", async () => {
    const rpc = vi.fn(async () => ({ data: [VALID], error: null }));
    const download = vi.fn(async () => ({ data: new Blob([new Uint8Array([1])]), error: null }));
    const from = vi.fn(() => ({ download }));
    const client = { schema: vi.fn(() => ({ rpc })), storage: { from } } as unknown as StorageClient;
    const wired = supabaseStorageDeps(client, () => {});
    expect(await wired.redeem(TICKET)).toEqual(VALID);
    expect(rpc).toHaveBeenCalledWith("redeem_worker_storage_ticket", { p_ticket: TICKET });
    expect(await wired.openObject("knowledge-originals", "a/b.pdf")).toMatchObject({ size: 1 });
    expect(from).toHaveBeenCalledWith("knowledge-originals");
    const refused = supabaseStorageDeps({ schema: () => ({ rpc: async () => ({ data: null, error: { code: "28000" } }) }), storage: { from } } as unknown as StorageClient, () => {});
    expect(await refused.redeem(TICKET)).toBeNull();
  });
});
