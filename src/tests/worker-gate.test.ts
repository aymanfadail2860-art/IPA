import { describe, expect, it, vi } from "vitest";

import { buildPdf, termsFixturePages } from "./fixtures/knowledge-pdfs";
import { sha256 } from "./fixtures/knowledge-pdfs";
import { releasedGate, securityDbDefaults, staticOriginals } from "./fixtures/worker-fakes";

/**
 * 8B-I5 — the release gate between quarantine and the parser (docs/08b §21.6). A version that
 * is not released — or bytes that are not exactly the released ones — never reach the parser,
 * the chunker or the embedder. The answer is the database's (worker_security_clearance); the
 * gate only computes the checksum of what was downloaded and refuses anything but an explicit
 * pass.
 */

const spies = vi.hoisted(() => ({ extract: vi.fn(), chunk: vi.fn() }));
vi.mock("../../workers/ingestion/extract.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../workers/ingestion/extract.ts")>();
  return { ...original, extractPdf: (...args: Parameters<typeof original.extractPdf>) => (spies.extract(), original.extractPdf(...args)) };
});
vi.mock("../../workers/ingestion/chunker.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../workers/ingestion/chunker.ts")>();
  return { ...original, chunkDocument: (...args: Parameters<typeof original.chunkDocument>) => (spies.chunk(), original.chunkDocument(...args)) };
});

const { processJob } = await import("../../workers/ingestion/pipeline.ts");
const { databaseSecurityGate } = await import("../../workers/ingestion/gate.ts");
const { createEmbedder } = await import("../../src/lib/knowledge/core/registry.ts");
type WorkerDb = import("../../workers/ingestion/pipeline.ts").WorkerDb;
type Clearance = import("../../workers/ingestion/gate.ts").Clearance;

const VERDICT = "00000000-0000-4000-a000-0000000000bb";

function fakeDb(calls: string[], clearance: (sha: string | null) => Clearance): WorkerDb {
  return {
    claim: async () => null,
    embeddingModels: async () => [{ id: "m", provider: "test", model_name: "test-hash-embedder", model_version: "1", dimensions: 256, status: "active" }],
    chunksToEmbed: async () => [],
    storeEmbeddings: async () => 0,
    verifyIndex: async () => [],
    heartbeat: async () => {},
    checkpoint: async (_job, step) => void calls.push(`checkpoint:${step}`),
    storePages: async () => void calls.push("storePages"),
    storeChunks: async () => (calls.push("storeChunks"), 0),
    complete: async () => void calls.push("complete"),
    fail: async (_job, code, _message, retryable) => (calls.push(`fail:${code}:${retryable}`), retryable ? "retry" : "failed"),
    issueStorageTicket: async () => ({ ticket: "0".repeat(64), expiresAt: new Date() }),
    forget: () => {},
    ...securityDbDefaults(),
    securityClearance: async (_job, sha) => (calls.push(`clearance:${sha === null ? "before" : "after"}`), clearance(sha)),
  };
}

const cleared = (): Clearance => ({ cleared: true, reason: null, verdict_id: VERDICT, policy_version: "pdf-v1" });
const blocked = (reason: string): Clearance => ({ cleared: false, reason, verdict_id: null, policy_version: "pdf-v1" });

describe("the release gate between quarantine and the parser", async () => {
  const bytes = await buildPdf(termsFixturePages());
  const released = sha256(bytes);
  const job = { job_id: "j", version_id: "v", kind: "process" as const, attempts: 1, max_attempts: 3, step_state: {}, storage_path: "p", checksum_sha256: released };
  const reset = () => {
    spies.extract.mockClear();
    spies.chunk.mockClear();
  };

  it("a version without a released verdict is not even downloaded", async () => {
    reset();
    const calls: string[] = [];
    const embedderFor = vi.fn();
    let downloads = 0;
    const db = fakeDb(calls, () => blocked("not_released"));
    const outcome = await processJob(job, { db, gate: databaseSecurityGate(db), originals: staticOriginals(() => (downloads++, bytes)), log: () => {}, embedderFor });
    expect(outcome).toBe("failed");
    expect(downloads).toBe(0);
    expect(spies.extract).not.toHaveBeenCalled();
    expect(embedderFor).not.toHaveBeenCalled();
    expect(calls).toEqual(["clearance:before", "fail:security_not_released:false"]);
  });

  it("bytes other than the released ones are downloaded but never parsed, chunked or embedded", async () => {
    reset();
    const calls: string[] = [];
    const embedderFor = vi.fn();
    const db = fakeDb(calls, (sha) => (sha === null || sha === released ? cleared() : blocked("bytes_changed")));
    const tampered = new Uint8Array(bytes);
    tampered[tampered.length - 20] ^= 1;
    const outcome = await processJob(job, { db, gate: databaseSecurityGate(db), originals: staticOriginals(tampered), log: () => {}, embedderFor });
    expect(outcome).toBe("failed");
    expect(spies.extract).not.toHaveBeenCalled();
    expect(spies.chunk).not.toHaveBeenCalled();
    expect(embedderFor).not.toHaveBeenCalled();
    expect(calls).toEqual(["clearance:before", "clearance:after", "fail:security_not_released:false"]);
  });

  it("a re-embedding job of a version that is not released creates no embedder", async () => {
    const calls: string[] = [];
    const embedderFor = vi.fn();
    const db = fakeDb(calls, () => blocked("policy_outdated"));
    const outcome = await processJob({ ...job, kind: "reembed" }, { db, gate: databaseSecurityGate(db), originals: staticOriginals(bytes), log: () => {}, embedderFor });
    expect(outcome).toBe("failed");
    expect(embedderFor).not.toHaveBeenCalled();
  });

  it("the released bytes go through parser, chunker and embedder", async () => {
    reset();
    const calls: string[] = [];
    const db = fakeDb(calls, (sha) => (sha === null || sha === released ? cleared() : blocked("bytes_changed")));
    const outcome = await processJob(job, { db, gate: databaseSecurityGate(db), originals: staticOriginals(bytes), log: () => {}, embedderFor: (model) => createEmbedder(model, "test") });
    expect(outcome).toBe("succeeded");
    expect(spies.extract).toHaveBeenCalledTimes(1);
    expect(spies.chunk).toHaveBeenCalledTimes(1);
    expect(calls.slice(0, 3)).toEqual(["clearance:before", "clearance:after", "checkpoint:validation"]);
    expect(calls).toContain("complete");
  });

  it("the gate computes the checksum itself and accepts nothing but an explicit pass", async () => {
    const seen: (string | null)[] = [];
    const answers: Clearance[] = [
      { cleared: true, reason: "not_released", verdict_id: VERDICT, policy_version: "pdf-v1" },
      { cleared: "true" as unknown as boolean, reason: null, verdict_id: VERDICT, policy_version: "pdf-v1" },
      { cleared: true, reason: null, verdict_id: null, policy_version: "pdf-v1" },
      { cleared: true, reason: null, verdict_id: "", policy_version: "pdf-v1" },
    ];
    for (const answer of answers) {
      const gate = databaseSecurityGate({ securityClearance: async (_job, sha) => (seen.push(sha), answer) });
      expect((await gate.inspect({ jobId: "j", bytes })).cleared).toBe(false);
      expect((await gate.admit("j")).cleared).toBe(false);
    }
    expect(seen.filter((sha) => sha !== null)).toEqual(Array(answers.length).fill(released));
  });

  it("the test stand-in is only for tests that are about something else", () => {
    expect(releasedGate().id).toBe("test-released");
  });
});
