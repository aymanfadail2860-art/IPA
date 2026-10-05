import { createHash } from "node:crypto";
import { createServer, type AddressInfo, type Server, type Socket } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { securityStatus, SECURITY_STATUS } from "../lib/knowledge/admin-types";
import { handleWorkerStorage, type RedeemedTicket, type WorkerStorageDeps } from "../../supabase/functions/worker-storage/handler.ts";

import { simplePdf } from "./fixtures/knowledge-pdfs";
import { releasedGate } from "./fixtures/worker-fakes";

/**
 * 8B-I5 — the malware scanner (clamd protocol, fail closed), the examination's order, the scan
 * job's flow (release / quarantine / retry), the storage function's moves with checksum
 * confirmation, and the Admin's categories. No real ClamAV here (see the integration test).
 */

const spies = vi.hoisted(() => ({ extract: vi.fn(), chunk: vi.fn(), pdfjs: vi.fn() }));
vi.mock("../../workers/ingestion/extract.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../workers/ingestion/extract.ts")>();
  return { ...original, extractPdf: (...args: Parameters<typeof original.extractPdf>) => (spies.extract(), original.extractPdf(...args)) };
});
vi.mock("../../workers/ingestion/chunker.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../workers/ingestion/chunker.ts")>();
  return { ...original, chunkDocument: (...args: Parameters<typeof original.chunkDocument>) => (spies.chunk(), original.chunkDocument(...args)) };
});
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", async (importOriginal) => {
  const original = await importOriginal<typeof import("pdfjs-dist/legacy/build/pdf.mjs")>();
  return { ...original, getDocument: (...args: Parameters<typeof original.getDocument>) => (spies.pdfjs(), original.getDocument(...args)) };
});

const { clamdScanner, developmentFixtureScanner, parseClamdVersion, parseScanReply } = await import("../../workers/ingestion/security/scanner.ts");
const { examineOriginal, signatureAgeProblem } = await import("../../workers/ingestion/security/scan.ts");
const { runScanJob } = await import("../../workers/ingestion/scan-job.ts");
const { createWorkerRuntime } = await import("../../workers/ingestion/runtime.ts");
const { OriginalTooLarge } = await import("../../workers/ingestion/originals.ts");
type ScanContext = import("../../workers/ingestion/security/scan.ts").ScanContext;
type SecurityMeasurements = import("../../workers/ingestion/security/scan.ts").SecurityMeasurements;
type MalwareScanner = import("../../workers/ingestion/security/scanner.ts").MalwareScanner;
type PdfInspector = import("../../workers/ingestion/security/inspector.ts").PdfInspector;
type WorkerDb = import("../../workers/ingestion/pipeline.ts").WorkerDb;
type OriginalStore = import("../../workers/ingestion/pipeline.ts").OriginalStore;
type RecordedVerdict = import("../../workers/ingestion/pipeline.ts").RecordedVerdict;

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const NOW = Date.parse("2026-10-05T12:00:00Z");

// ------------------------------------------------------------------------- fake clamd

type Mode = "clean" | "infected" | "error" | "invalid" | "silent" | "flood";
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

async function fakeClamd(mode: Mode, version = "ClamAV 1.4.3/27790/Mon Oct  5 08:20:00 2026"): Promise<{ port: number; received: Uint8Array[] }> {
  const received: Uint8Array[] = [];
  const server = createServer((socket: Socket) => {
    let buffer = Buffer.alloc(0);
    socket.on("data", (data) => {
      buffer = Buffer.concat([buffer, data]);
      if (buffer.toString("latin1").startsWith("zVERSION\0")) return void socket.end(`${version}\0`);
      if (!buffer.toString("latin1").startsWith("zINSTREAM\0")) return;
      // Parse <4-byte length><data>… until a zero length.
      let offset = 10;
      const parts: Buffer[] = [];
      while (offset + 4 <= buffer.length) {
        const size = buffer.readUInt32BE(offset);
        if (size === 0) {
          received.push(new Uint8Array(Buffer.concat(parts)));
          if (mode === "silent") return;
          if (mode === "flood") return void socket.end("x".repeat(10_000));
          const reply = { clean: "stream: OK", infected: "stream: Eicar-Test-Signature FOUND", error: "INSTREAM size limit exceeded. ERROR", invalid: "hello there" }[mode];
          return void socket.end(`${reply}\0`);
        }
        if (offset + 4 + size > buffer.length) return;
        parts.push(buffer.subarray(offset + 4, offset + 4 + size));
        offset += 4 + size;
      }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { port: (server.address() as AddressInfo).port, received };
}

describe("clamd protocol (scanner.ts)", () => {
  it("parses the engine and signature version and time; anything else is unknown", () => {
    expect(parseClamdVersion("ClamAV 1.4.3/27790/Mon Oct  5 08:20:00 2026")).toEqual({
      engine: "ClamAV", engineVersion: "1.4.3", signatureVersion: "27790", signatureTime: new Date("2026-10-05T08:20:00Z"),
    });
    expect(parseClamdVersion("ClamAV 1.5.4")).toEqual({ engine: "ClamAV", engineVersion: "1.5.4", signatureVersion: null, signatureTime: null });
    expect(parseClamdVersion("FakeAV 1/2/3")).toBeNull();
    expect(parseClamdVersion("ClamAV 1.4.3/27790/not a date at all")?.signatureTime).toBeNull();
  });

  it("reads OK as clean, FOUND as infected (with a sanitized name) and everything else as an error", () => {
    expect(parseScanReply("stream: OK\0")).toEqual({ result: "clean" });
    expect(parseScanReply("stream: Win.Test.EICAR_HDB-1 FOUND")).toEqual({ result: "infected", name: "Win.Test.EICAR_HDB-1" });
    expect(parseScanReply("stream: <script>alert(1)</script> FOUND")).toEqual({ result: "infected", name: "unnamed-signature" });
    expect(parseScanReply("stream: OK FOUND? ERROR")).toEqual({ result: "error", code: "scanner_error" });
    expect(parseScanReply("")).toEqual({ result: "error", code: "invalid_response" });
    expect(parseScanReply("stream: ok")).toEqual({ result: "error", code: "invalid_response" });
  });

  it("streams the bytes in 64 KB chunks and reads a clean answer", async () => {
    const clamd = await fakeClamd("clean");
    const bytes = new Uint8Array(200_000).map((_, i) => i % 251);
    expect(await clamdScanner({ host: "127.0.0.1", port: clamd.port }).scan(bytes, 5_000)).toEqual({ result: "clean" });
    expect(sha(clamd.received[0]!)).toBe(sha(bytes));
  });

  it.each([
    ["infected", { result: "infected", name: "Eicar-Test-Signature" }],
    ["error", { result: "error", code: "scanner_error" }],
    ["invalid", { result: "error", code: "invalid_response" }],
    ["flood", { result: "error", code: "invalid_response" }],
  ] as const)("a %s answer", async (mode, expected) => {
    const clamd = await fakeClamd(mode);
    expect(await clamdScanner({ host: "127.0.0.1", port: clamd.port }).scan(new Uint8Array([1, 2, 3]), 5_000)).toEqual(expected);
  });

  it("fails closed when clamd is silent (timeout) or unavailable", async () => {
    const silent = await fakeClamd("silent");
    expect(await clamdScanner({ host: "127.0.0.1", port: silent.port }).scan(new Uint8Array([1]), 200)).toEqual({ result: "error", code: "scanner_timeout" });
    const closed = await fakeClamd("clean");
    await new Promise((resolve) => servers.pop()!.close(resolve));
    const scanner = clamdScanner({ host: "127.0.0.1", port: closed.port });
    expect(await scanner.scan(new Uint8Array([1]), 1_000)).toEqual({ result: "error", code: "scanner_unavailable" });
    expect(await scanner.info()).toEqual({ error: "scanner_unavailable" });
  });

  it("the development fixture scanner cannot be created outside local/test", () => {
    expect(() => developmentFixtureScanner("production")).toThrow();
    expect(() => developmentFixtureScanner("test")).not.toThrow();
  });
});

// ------------------------------------------------------------------------- examination

const CONTEXT = (bytes: Uint8Array, overrides: Partial<ScanContext> = {}): ScanContext => ({
  security_state: "scanning",
  storage_bucket: "knowledge-intake",
  policy_version: "pdf-v1",
  max_signature_age_seconds: 86_400,
  limits: {},
  checksum_sha256: sha(bytes),
  byte_size: bytes.byteLength,
  upload_mime: "application/pdf",
  original_filename: "fiktiv.pdf",
  ...overrides,
});

function scanner(options: { result?: "clean" | "infected" | "error"; signatureTime?: Date | null; info?: "error" } = {}): MalwareScanner & { scans: number } {
  const value = {
    scans: 0,
    async info() {
      if (options.info === "error") return { error: "scanner_unavailable" as const };
      return { engine: "ClamAV", engineVersion: "1.4.3", signatureVersion: "27790", signatureTime: options.signatureTime === undefined ? new Date(NOW - 3_600_000) : options.signatureTime };
    },
    async scan() {
      value.scans += 1;
      if (options.result === "infected") return { result: "infected" as const, name: "Eicar-Test-Signature" };
      if (options.result === "error") return { result: "error" as const, code: "scanner_timeout" as const };
      return { result: "clean" as const };
    },
  };
  return value;
}

function inspector(result: Awaited<ReturnType<PdfInspector["inspect"]>> = { pdfSecurity: { result: "pass" }, activeContent: { result: "pass", findings: [] }, pages: 1 }) {
  const value = { calls: 0, async inspect() { value.calls += 1; return result; } };
  return value;
}

describe("the examination's order: structure → ClamAV → PDF security", async () => {
  const pdf = await simplePdf("undersøgelse");
  const now = () => NOW;

  it("measures a clean, valid PDF as passed in every part — the worker never says 'safe' itself", async () => {
    const tools = { scanner: scanner(), inspector: inspector(), now };
    const measured = await examineOriginal(pdf, CONTEXT(pdf), tools);
    expect(measured).toMatchObject({
      policy_version: "pdf-v1", checksum_sha256: sha(pdf), byte_size: pdf.byteLength, detected_mime: "application/pdf",
      structural: { result: "pass", code: null }, malware: { result: "clean" }, pdf_security: { result: "pass" }, active_content: { result: "pass", findings: [] },
      scanner: { engine: "ClamAV", engine_version: "1.4.3", signature_version: "27790" },
    });
    expect(Object.keys(measured)).not.toEqual(expect.arrayContaining(["final"]));
    expect(JSON.stringify(measured)).not.toMatch(/"safe"/);
    expect(tools.inspector.calls).toBe(1);
  });

  it("stale or unknown signatures are never 'clean'; the PDF inspection does not run", async () => {
    for (const [signatureTime, code] of [[new Date(NOW - 3 * 86_400_000), "stale_signatures"], [null, "signature_unknown"], [new Date(NOW + 3_600_000), "stale_signatures"]] as const) {
      const tools = { scanner: scanner({ signatureTime }), inspector: inspector(), now };
      const measured = await examineOriginal(pdf, CONTEXT(pdf), tools);
      expect(measured.malware).toEqual({ result: "error", code, name: null });
      expect(tools.inspector.calls).toBe(0);
    }
    expect(signatureAgeProblem(new Date(NOW - 86_400_000 + 1_000), 86_400, NOW)).toBeNull();
  });

  it("a find wins over stale signatures; an unavailable scanner is an error, never clean", async () => {
    const infected = await examineOriginal(pdf, CONTEXT(pdf), { scanner: scanner({ result: "infected", signatureTime: null }), inspector: inspector(), now });
    expect(infected.malware).toEqual({ result: "infected", code: null, name: "Eicar-Test-Signature" });
    const down = scanner({ info: "error" });
    const unavailable = await examineOriginal(pdf, CONTEXT(pdf), { scanner: down, inspector: inspector(), now });
    expect(unavailable.malware).toEqual({ result: "error", code: "scanner_unavailable", name: null });
    expect(down.scans).toBe(0);
    const timeout = await examineOriginal(pdf, CONTEXT(pdf), { scanner: scanner({ result: "error" }), inspector: inspector(), now });
    expect(timeout.malware).toEqual({ result: "error", code: "scanner_timeout", name: null });
  });

  it("a structurally invalid file is still scanned for malware but never inspected as a PDF; a too large file is neither", async () => {
    const tools = { scanner: scanner(), inspector: inspector(), now };
    const wrongType = await examineOriginal(pdf, CONTEXT(pdf, { upload_mime: "text/html" }), tools);
    expect(wrongType).toMatchObject({ structural: { result: "fail", code: "mime_mismatch" }, malware: { result: "clean" }, pdf_security: { result: "not_run" } });
    expect(tools.scanner.scans).toBe(1);
    expect(tools.inspector.calls).toBe(0);
    const big = await examineOriginal(pdf, CONTEXT(pdf, { limits: { max_bytes: 10 } }), tools);
    expect(big).toMatchObject({ structural: { result: "fail", code: "too_large" }, malware: { result: "not_scanned" } });
    expect(tools.scanner.scans).toBe(1);
  });

  it("passes the inspection's findings and failures through unchanged", async () => {
    const active = await examineOriginal(pdf, CONTEXT(pdf), { scanner: scanner(), inspector: inspector({ pdfSecurity: { result: "pass" }, activeContent: { result: "fail", findings: ["javascript"] }, pages: 1 }), now });
    expect(active.active_content).toEqual({ result: "fail", findings: ["javascript"] });
    const timeout = await examineOriginal(pdf, CONTEXT(pdf), { scanner: scanner(), inspector: inspector({ pdfSecurity: { result: "error", code: "inspection_timeout" }, activeContent: { result: "not_run", findings: [] }, pages: null }), now });
    expect(timeout.pdf_security).toEqual({ result: "error", code: "inspection_timeout" });
  });
});

// ------------------------------------------------------------------------- scan job

const JOB = { job_id: "scan-1", version_id: "v-1", kind: "scan" as const, attempts: 1, max_attempts: 3, step_state: {}, storage_path: "d/v/original.pdf", checksum_sha256: "0".repeat(64) };

function scanDb(calls: string[], options: { context?: ScanContext; verdict?: RecordedVerdict; record?: (m: SecurityMeasurements) => void } = {}): WorkerDb {
  const fail = (name: string) => async () => {
    throw new Error(`${name} must not be called by a scan job`);
  };
  return {
    claim: async () => null,
    embeddingModels: fail("embeddingModels"),
    chunksToEmbed: fail("chunksToEmbed"),
    storeEmbeddings: fail("storeEmbeddings"),
    verifyIndex: fail("verifyIndex"),
    heartbeat: async () => {},
    checkpoint: fail("checkpoint"),
    storePages: fail("storePages"),
    storeChunks: fail("storeChunks"),
    securityClearance: fail("securityClearance"),
    complete: async () => void calls.push("complete"),
    fail: async (_job, code, _message, retryable) => (calls.push(`fail:${code}:${retryable}`), retryable ? "retry" : "failed"),
    issueStorageTicket: fail("issueStorageTicket"),
    forget: () => {},
    securityScanContext: async () => (calls.push("context"), options.context!),
    recordSecurityVerdict: async (_job, measurements) => {
      calls.push("record");
      options.record?.(measurements);
      return options.verdict!;
    },
  };
}

function scanOriginals(calls: string[], bytes: Uint8Array | (() => never), moves: Record<string, string> = {}): OriginalStore {
  return {
    download: async (_job, purpose, maxBytes) => (calls.push(`download:${purpose}:${maxBytes}`), typeof bytes === "function" ? bytes() : bytes),
    move: async (_job, purpose) => (calls.push(`move:${purpose}`), (moves[purpose] ?? "released") as never),
  };
}

describe("the scan job (claim → examine → verdict → release | quarantine | retry)", async () => {
  const pdf = await simplePdf("scanjob");
  const tools = () => ({ scanner: scanner({ signatureTime: new Date() }), inspector: inspector() });
  const verdict = (final: RecordedVerdict["final"], next: RecordedVerdict["next"], code: string | null = null): RecordedVerdict => ({ verdict_id: "d-1", final, failure_code: code, next });
  const reset = () => {
    spies.extract.mockClear();
    spies.chunk.mockClear();
    spies.pdfjs.mockClear();
  };
  const neverParsed = () => {
    expect(spies.extract).not.toHaveBeenCalled();
    expect(spies.chunk).not.toHaveBeenCalled();
    expect(spies.pdfjs).not.toHaveBeenCalled();
  };

  it("safe: the file is released by the storage function, then the job completes — nothing is parsed", async () => {
    reset();
    const calls: string[] = [];
    let measured: SecurityMeasurements | null = null;
    const db = scanDb(calls, { context: CONTEXT(pdf), verdict: verdict("safe", "release"), record: (m) => (measured = m) });
    const outcome = await runScanJob(JOB, { db, originals: scanOriginals(calls, pdf), gate: releasedGate(), scan: tools(), log: () => {} });
    expect(outcome).toBe("succeeded");
    expect(calls).toEqual(["context", `download:scan_original:${52_428_800}`, "record", "move:release_original", "complete"]);
    expect(measured!.checksum_sha256).toBe(sha(pdf));
    neverParsed();
  });

  it("rejected: the file goes to quarantine", async () => {
    reset();
    const calls: string[] = [];
    const db = scanDb(calls, { context: CONTEXT(pdf), verdict: verdict("rejected", "quarantine", "malware_detected") });
    expect(await runScanJob(JOB, { db, originals: scanOriginals(calls, pdf, { quarantine_original: "quarantined" }), gate: releasedGate(), scan: tools(), log: () => {} })).toBe("succeeded");
    expect(calls).toEqual(["context", `download:scan_original:${52_428_800}`, "record", "move:quarantine_original", "complete"]);
    neverParsed();
  });

  it("technical scan failure: retried, never released", async () => {
    const calls: string[] = [];
    const db = scanDb(calls, { context: CONTEXT(pdf), verdict: verdict("scan_failed", "retry", "stale_signatures") });
    expect(await runScanJob(JOB, { db, originals: scanOriginals(calls, pdf), gate: releasedGate(), scan: tools(), log: () => {} })).toBe("retry");
    expect(calls).toEqual(["context", `download:scan_original:${52_428_800}`, "record", "fail:stale_signatures:true"]);
  });

  it("bytes changed between scan and release: the verdict is void, the job scans again", async () => {
    const calls: string[] = [];
    const db = scanDb(calls, { context: CONTEXT(pdf), verdict: verdict("safe", "release") });
    expect(await runScanJob(JOB, { db, originals: scanOriginals(calls, pdf, { release_original: "invalidated" }), gate: releasedGate(), scan: tools(), log: () => {} })).toBe("retry");
    expect(calls.slice(-2)).toEqual(["move:release_original", "fail:checksum_changed:true"]);
    expect(calls).not.toContain("complete");
  });

  it("an earlier attempt's rejection is finished (moved to quarantine) without scanning again", async () => {
    const calls: string[] = [];
    const db = scanDb(calls, { context: CONTEXT(pdf, { security_state: "rejected" }) });
    expect(await runScanJob(JOB, { db, originals: scanOriginals(calls, pdf, { quarantine_original: "quarantined" }), gate: releasedGate(), scan: tools(), log: () => {} })).toBe("succeeded");
    expect(calls).toEqual(["context", "move:quarantine_original", "complete"]);
  });

  it("fails closed without a scanner, on an unexpected state and on a download error", async () => {
    let calls: string[] = [];
    expect(await runScanJob(JOB, { db: scanDb(calls, { context: CONTEXT(pdf) }), originals: scanOriginals(calls, pdf), gate: releasedGate(), log: () => {} })).toBe("retry");
    expect(calls).toEqual(["context", "fail:scan_error:true"]);
    calls = [];
    expect(await runScanJob(JOB, { db: scanDb(calls, { context: CONTEXT(pdf, { security_state: "released" }) }), originals: scanOriginals(calls, pdf), gate: releasedGate(), scan: tools(), log: () => {} })).toBe("failed");
    expect(calls).toEqual(["context", "fail:security_state_unexpected:false"]);
    calls = [];
    const broken = scanOriginals(calls, () => {
      throw Object.assign(new Error("502"), { name: "OriginalUnavailable" });
    });
    expect(await runScanJob(JOB, { db: scanDb(calls, { context: CONTEXT(pdf) }), originals: broken, gate: releasedGate(), scan: tools(), log: () => {} })).toBe("retry");
    expect(calls.at(-1)).toBe("fail:scan_error:true");
  });

  it("a file over the limit is examined on what was received — and rejected as too large", async () => {
    const calls: string[] = [];
    let measured: SecurityMeasurements | null = null;
    const db = scanDb(calls, { context: CONTEXT(pdf, { limits: { max_bytes: 100 } }), verdict: verdict("rejected", "quarantine", "too_large"), record: (m) => (measured = m) });
    const tooLarge = scanOriginals(calls, () => {
      throw new OriginalTooLarge(pdf.subarray(0, 101));
    });
    await runScanJob(JOB, { db, originals: tooLarge, gate: releasedGate(), scan: tools(), log: () => {} });
    expect(measured!.structural).toEqual({ result: "fail", code: "too_large" });
    expect(measured!.byte_size).toBe(101);
    expect(measured!.malware.result).toBe("not_scanned");
  });

  it("an aborted scan is never completed or failed by this worker", async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    const db = scanDb(calls, { context: CONTEXT(pdf), verdict: verdict("safe", "release") });
    db.recordSecurityVerdict = async () => {
      controller.abort({ kind: "lease_lost" });
      return verdict("safe", "release");
    };
    expect(await runScanJob(JOB, { db, originals: scanOriginals(calls, pdf), gate: releasedGate(), scan: tools(), log: () => {}, signal: controller.signal })).toBe("lost");
    expect(calls.some((call) => call === "complete" || call.startsWith("fail:") || call.startsWith("move:"))).toBe(false);
  });

  it("the runtime sends scan jobs to the examination, not to the pipeline", async () => {
    reset();
    const calls: string[] = [];
    const db = scanDb(calls, { context: CONTEXT(pdf), verdict: verdict("safe", "release") });
    let claimed = false;
    db.claim = async () => (claimed ? null : ((claimed = true), JOB));
    const config = { once: true, leaseSeconds: 300, heartbeatMs: 60_000, stallMs: 600_000, idle: { initialMs: 1, maxMs: 1 }, errorBackoff: { initialMs: 1, maxMs: 1 }, shutdownGraceMs: 1 };
    const result = await createWorkerRuntime(config, { db, originals: scanOriginals(calls, pdf), gate: releasedGate(), scan: tools(), log: () => {} }).run();
    expect(result).toEqual({ reason: "drained", jobs: 1 });
    expect(calls).toContain("move:release_original");
    neverParsed();
  });
});

// ------------------------------------------------------------------------- storage moves

const TICKET = "d4".repeat(32);
const PATH = "doc/ver/original.pdf";

function storage(bytes: Uint8Array, ticket: Partial<RedeemedTicket>, options: { confirm?: string | null | Error; write?: boolean } = {}) {
  const log: string[] = [];
  const written: Uint8Array[] = [];
  const deps: WorkerStorageDeps = {
    redeem: async () => ({ bucket: "knowledge-intake", object_path: PATH, purpose: "release_original", checksum_sha256: sha(bytes), operation: "release", destination_bucket: "knowledge-originals", ticket_id: "t-1", ...ticket }),
    openObject: async (bucket, path) => (log.push(`open:${bucket}/${path}`), { body: new Blob([bytes as Uint8Array<ArrayBuffer>]).stream(), size: bytes.byteLength }),
    writeObject: async (bucket, path, data) => (log.push(`write:${bucket}/${path}`), written.push(data), options.write ?? true),
    removeObject: async (bucket, path) => (log.push(`remove:${bucket}/${path}`), true),
    confirm: async (id, checksum) => {
      log.push(`confirm:${id}:${checksum === sha(bytes) ? "scanned" : checksum}`);
      if (options.confirm instanceof Error) throw options.confirm;
      return options.confirm === undefined ? "released" : options.confirm;
    },
    log: () => {},
  };
  return { deps, log, written };
}
const post = () => new Request("https://fn.test/functions/v1/worker-storage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticket: TICKET }) });

describe("worker-storage moves out of quarantine (8B-I5)", async () => {
  const bytes = await simplePdf("flytning");

  it("release: exactly the scanned bytes are written to knowledge-originals, confirmed, then removed from intake", async () => {
    const s = storage(bytes, {});
    const response = await handleWorkerStorage(post(), s.deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "released" });
    expect(s.log).toEqual([`open:knowledge-intake/${PATH}`, `write:knowledge-originals/${PATH}`, "confirm:t-1:scanned", `remove:knowledge-intake/${PATH}`]);
    expect(sha(s.written[0]!)).toBe(sha(bytes));
  });

  it("release of bytes other than the scanned ones: nothing is written; the database voids the verdict", async () => {
    const s = storage(bytes, { checksum_sha256: "a".repeat(64) }, { confirm: "invalidated" });
    const response = await handleWorkerStorage(post(), s.deps);
    expect(await response.json()).toEqual({ outcome: "invalidated" });
    expect(s.log).toEqual([`open:knowledge-intake/${PATH}`, "confirm:t-1:scanned"]);
  });

  it("a rescan of a file already in knowledge-originals only verifies and confirms", async () => {
    const s = storage(bytes, { bucket: "knowledge-originals" });
    expect(await (await handleWorkerStorage(post(), s.deps)).json()).toEqual({ outcome: "released" });
    expect(s.log).toEqual([`open:knowledge-originals/${PATH}`, "confirm:t-1:scanned"]);
  });

  it("quarantine: the rejected file goes to knowledge-quarantine and leaves intake", async () => {
    const s = storage(bytes, { purpose: "quarantine_original", operation: "quarantine", destination_bucket: "knowledge-quarantine" }, { confirm: "quarantined" });
    expect(await (await handleWorkerStorage(post(), s.deps)).json()).toEqual({ outcome: "quarantined" });
    expect(s.log).toEqual([`open:knowledge-intake/${PATH}`, `write:knowledge-quarantine/${PATH}`, "confirm:t-1:scanned", `remove:knowledge-intake/${PATH}`]);
  });

  it("removes nothing unless the database confirmed; a failed write is never confirmed", async () => {
    for (const confirm of [null, "safe", new Error("db down")]) {
      const s = storage(bytes, {}, { confirm });
      expect((await handleWorkerStorage(post(), s.deps)).status).toBeGreaterThanOrEqual(500);
      expect(s.log.some((entry) => entry.startsWith("remove:"))).toBe(false);
    }
    const failed = storage(bytes, {}, { write: false });
    expect((await handleWorkerStorage(post(), failed.deps)).status).toBe(502);
    expect(failed.log.some((entry) => entry.startsWith("confirm:"))).toBe(false);
  });

  it.each([
    ["a release to the quarantine bucket", { destination_bucket: "knowledge-quarantine" }],
    ["a release without a ticket id", { ticket_id: null }],
    ["a release from the quarantine bucket", { bucket: "knowledge-quarantine" }],
    ["a stream of an original from intake for processing", { purpose: "download_original", operation: "stream", destination_bucket: null, bucket: "knowledge-intake" }],
    ["a scan of a rejected file in quarantine", { purpose: "scan_original", operation: "stream", destination_bucket: null, bucket: "knowledge-quarantine" }],
    ["an operation that does not match the purpose", { purpose: "scan_original", operation: "release" }],
  ] as const)("refuses %s (defence in depth beyond the database)", async (_name, ticket) => {
    const s = storage(bytes, ticket as Partial<RedeemedTicket>);
    expect((await handleWorkerStorage(post(), s.deps)).status).toBe(403);
    expect(s.log).toEqual([]);
  });

  it("streams a file in quarantine for the scan", async () => {
    const s = storage(bytes, { purpose: "scan_original", operation: "stream", destination_bucket: null });
    const response = await handleWorkerStorage(post(), s.deps);
    expect(response.status).toBe(200);
    expect(sha(new Uint8Array(await response.arrayBuffer()))).toBe(sha(bytes));
  });
});

// ------------------------------------------------------------------------- Admin

describe("Admin security categories (8B-I5)", () => {
  it("shows exactly the agreed Danish labels", () => {
    expect(Object.values(SECURITY_STATUS).map((entry) => entry.label)).toEqual([
      "I karantæne", "Scanner", "Godkendt sikkerhedskontrol", "Afvist: ugyldig PDF", "Afvist: aktivt indhold", "Afvist: malware", "Teknisk scanfejl", "Ikke sikkerhedsscannet",
    ]);
  });

  it("maps states and codes to categories — never 'passed' for anything unknown", () => {
    expect(securityStatus("quarantined", null)).toBe("quarantined");
    expect(securityStatus("scanning", null)).toBe("scanning");
    expect(securityStatus("released", null)).toBe("released");
    expect(securityStatus("scan_failed", "scanner_unavailable")).toBe("scan_failed");
    expect(securityStatus("rejected", "malware_detected")).toBe("rejected_malware");
    expect(securityStatus("rejected", "active_content")).toBe("rejected_active_content");
    expect(securityStatus("rejected", "embedded_file")).toBe("rejected_active_content");
    for (const code of ["invalid_file_type", "extension_mismatch", "mime_mismatch", "polyglot", "invalid_pdf", "encrypted_pdf", "too_large", "checksum_mismatch", "inspection_timeout"]) {
      expect(securityStatus("rejected", code)).toBe("rejected_invalid");
    }
    expect(securityStatus("legacy_unscanned", null)).toBe("not_scanned");
    expect(securityStatus("released-by-client", null)).toBe("quarantined");
    expect(securityStatus(undefined, null)).toBe("quarantined");
  });
});
