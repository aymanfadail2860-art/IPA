import { describe, expect, it, vi } from "vitest";

import { buildPdf, termsFixturePages } from "./fixtures/knowledge-pdfs";
import { sha256 } from "./fixtures/knowledge-pdfs";

/**
 * 8B-I4 — the I5 gate sits between the download and the parser (docs/08b §21.5). An
 * unscanned document never reaches the parser, the chunker or the embedder; local/test
 * fixtures still go all the way.
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
const { processingGateFor } = await import("../../workers/ingestion/gate.ts");
const { createEmbedder } = await import("../../src/lib/knowledge/core/registry.ts");
type WorkerDb = import("../../workers/ingestion/pipeline.ts").WorkerDb;
type ProcessingGate = import("../../workers/ingestion/gate.ts").ProcessingGate;

function fakeDb(calls: string[]): WorkerDb {
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
  };
}

describe("I5 processing gate between download and parser", async () => {
  const bytes = await buildPdf(termsFixturePages());
  const job = { job_id: "j", version_id: "v", kind: "process" as const, attempts: 1, max_attempts: 3, step_state: {}, storage_path: "p", checksum_sha256: sha256(bytes) };

  it("an unscanned document is downloaded and verified, but never parsed, chunked or embedded", async () => {
    spies.extract.mockClear();
    spies.chunk.mockClear();
    const scanUnavailable: ProcessingGate = { id: "scan-unavailable", open: true, inspect: async () => ({ cleared: false, code: "security_scan_unavailable", message: "Ikke scannet." }) };
    const embedderFor = vi.fn();
    const calls: string[] = [];
    let downloads = 0;
    const outcome = await processJob(job, { db: fakeDb(calls), gate: scanUnavailable, originals: { download: async () => (downloads++, bytes) }, log: () => {}, embedderFor });
    expect(outcome).toBe("failed");
    expect(downloads).toBe(1);
    expect(spies.extract).not.toHaveBeenCalled();
    expect(spies.chunk).not.toHaveBeenCalled();
    expect(embedderFor).not.toHaveBeenCalled();
    expect(calls).toEqual(["fail:security_scan_unavailable:false"]);
  });

  it("the production gate lets nothing in — not even a re-embedding job", async () => {
    const calls: string[] = [];
    const embedderFor = vi.fn();
    const outcome = await processJob({ ...job, kind: "reembed" }, { db: fakeDb(calls), gate: processingGateFor("production"), originals: { download: async () => bytes }, log: () => {}, embedderFor });
    expect(outcome).toBe("failed");
    expect(embedderFor).not.toHaveBeenCalled();
    expect(calls).toEqual(["fail:security_scan_unavailable:false"]);
  });

  it("local/test fixtures still go through parser, chunker and embedder", async () => {
    spies.extract.mockClear();
    spies.chunk.mockClear();
    const calls: string[] = [];
    const outcome = await processJob(job, { db: fakeDb(calls), gate: processingGateFor("test"), originals: { download: async () => bytes }, log: () => {}, embedderFor: (model) => createEmbedder(model, "test") });
    expect(outcome).toBe("succeeded");
    expect(spies.extract).toHaveBeenCalledTimes(1);
    expect(spies.chunk).toHaveBeenCalledTimes(1);
    expect(calls[0]).toBe("checkpoint:validation");
    expect(calls).toContain("complete");
  });
});
