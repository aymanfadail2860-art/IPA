import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { knowledgeText, userText } from "@/lib/egress/classification";
import { ProviderError, providerErrorFields, withRetry } from "@/lib/knowledge/core/provider";
import { createCohereEmbedV4 } from "@/lib/knowledge/providers/bedrock/cohere-embed-v4";
import { createCohereRerank35 } from "@/lib/knowledge/providers/bedrock/cohere-rerank-3-5";
import { classifyBedrockError } from "@/lib/knowledge/providers/bedrock/transport";
import { observedTransport, PROVIDER_CALL_EVENT } from "@/lib/knowledge/providers/provider-metrics";
import { createRetrievalTelemetry, resetTelemetryCooldowns } from "@/lib/observability/retrieval-telemetry";

import { processJob, type ClaimedJob, type IntegrityRow, type WorkerDb } from "../../workers/ingestion/pipeline.ts";

import { awsError, embedResponse, fakeBedrock, noSleep } from "./fixtures/bedrock-fake";
import { releasedGate, staticOriginals } from "./fixtures/worker-fakes";

/**
 * 8B-I8 C3 — provider error metrics (docs/08b §14, B-033). Every provider call is one log line
 * with the error's kind, whether it was throttling (429) or a timeout, its HTTP status and the
 * duration; the retrieval line and the worker's failure line carry the same fields. From these
 * the platform computes the provider error, throttling and timeout rates. Never a message,
 * query or text.
 */

const SECRET_TEXT = "Kunden Hansen ApS har en skade på 4,2 mio. kr.";
const throttled = () => classifyBedrockError(awsError("ThrottlingException", 429));

function recorder() {
  const lines: Record<string, unknown>[] = [];
  return { lines, log: (fields: Record<string, unknown>) => void lines.push(fields) };
}

describe("one provider_call line per attempt", () => {
  it("a 429 that a retry absorbs still counts: two throttled attempts and one success", async () => {
    let calls = 0;
    const fake = fakeBedrock((call) => {
      calls += 1;
      if (calls <= 2) throw throttled();
      return embedResponse(call.body.texts as string[]);
    });
    const { lines, log } = recorder();
    const transport = observedTransport(fake.transport, { runtime: "worker" }, log);
    const embedder = createCohereEmbedV4({ transport, retryDeps: noSleep, egressLog: () => {} });
    await embedder.embed([knowledgeText(SECRET_TEXT)], { inputType: "document" });

    expect(lines).toHaveLength(3);
    expect(lines.map((line) => [line.outcome, line.provider_error_kind, line.throttled, line.http_status])).toEqual([
      ["error", "throttled", true, 429],
      ["error", "throttled", true, 429],
      ["ok", null, false, null],
    ]);
    for (const line of lines) {
      expect(line).toMatchObject({ event: PROVIDER_CALL_EVENT, runtime: "worker", provider: "aws-bedrock", operation: "embed_document", model: "eu.cohere.embed-v4:0", timeout: false });
      expect(typeof line.duration_ms).toBe("number");
      expect(typeof line.correlation_id).toBe("string");
    }
    // Rates the platform computes from these lines (deploy/monitoring/aggregate-alarms.json).
    const throttleRate = lines.filter((line) => line.throttled).length / lines.length;
    expect(throttleRate).toBeCloseTo(2 / 3);
  });

  it("a timeout of the retry policy is a timeout, and the app's labels are carried", async () => {
    const fake = fakeBedrock((call) => new Promise((_, reject) => call.signal.addEventListener("abort", () => reject(classifyBedrockError(Object.assign(new Error("aborted"), { name: "AbortError" }))))));
    const { lines, log } = recorder();
    const labels = { runtime: "application" as const, request_id: "req-1", configuration_id: "cfg-1", configuration_fingerprint: "f".repeat(64) };
    const reranker = createCohereRerank35({ transport: observedTransport(fake.transport, labels, log), retryDeps: noSleep, egressLog: () => {}, retry: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1, attemptTimeoutMs: 5 } });
    await expect(
      reranker.rerank({
        query: userText("Hvad dækker erhvervsansvar?", { caseBound: false, redacted: true }),
        topN: 1,
        candidates: [{ chunkId: "c1", document: knowledgeText(SECRET_TEXT), retrieval: { fusedScore: 1 } }] as never,
      }),
    ).rejects.toMatchObject({ kind: "timeout" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ ...labels, operation: "rerank", outcome: "error", provider_error_kind: "timeout", timeout: true, throttled: false });
  });

  it("never logs the provider's message, a query or a text", async () => {
    const fake = fakeBedrock(() => {
      throw new ProviderError("invalid_request", "aws-bedrock", `Bedrock afviste: ${SECRET_TEXT}`, { httpStatus: 400 });
    });
    const { lines, log } = recorder();
    const embedder = createCohereEmbedV4({ transport: observedTransport(fake.transport, { runtime: "application" }, log), retryDeps: noSleep, egressLog: () => {} });
    await expect(embedder.embed([knowledgeText(SECRET_TEXT)], { inputType: "document" })).rejects.toBeInstanceOf(Error);
    const json = JSON.stringify(lines);
    expect(json).not.toContain("Hansen");
    expect(json).not.toContain("afviste");
    expect(lines[0]).toMatchObject({ provider_error_kind: "invalid_request", http_status: 400, retryable: false, error_class: "ProviderError" });
  });

  it("forwards the call unchanged, and a failing log never fails the call", async () => {
    const fake = fakeBedrock((call) => embedResponse(call.body.texts as string[]));
    const transport = observedTransport(fake.transport, { runtime: "worker" }, () => {
      throw new Error("log down");
    });
    const embedder = createCohereEmbedV4({ transport, retryDeps: noSleep, egressLog: () => {} });
    const [vector] = await embedder.embed([knowledgeText("Selvrisiko")], { inputType: "document" });
    expect(vector).toHaveLength(1024);
    expect(fake.calls[0]!.body).toMatchObject({ texts: ["Selvrisiko"], input_type: "search_document" });
    expect(transport.region).toBe(fake.transport.region);
  });
});

describe("the error class survives classification and retries", () => {
  it("keeps the HTTP status and marks 429 as throttled", async () => {
    expect(providerErrorFields(throttled())).toEqual({ provider_error_kind: "throttled", throttled: true, timeout: false, retryable: true, http_status: 429, error_class: "ProviderError" });
    expect(providerErrorFields(classifyBedrockError(awsError("InternalServerException", 500)))).toMatchObject({ provider_error_kind: "unavailable", http_status: 500 });
    const final = await withRetry("aws-bedrock", { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 1, attemptTimeoutMs: 1_000 }, async () => {
      throw throttled();
    }, noSleep).catch((error: unknown) => error as ProviderError);
    expect(final).toMatchObject({ kind: "throttled", attempts: 2, httpStatus: 429 });
    expect(providerErrorFields(new TypeError("x"))).toEqual({ provider_error_kind: null, throttled: false, timeout: false, retryable: null, http_status: null, error_class: "TypeError" });
  });
});

describe("the retrieval line carries the failing step's provider error", () => {
  it("rerank throttled: provider_errors with kind, throttled and attempts; request_id correlates", async () => {
    resetTelemetryCooldowns();
    const written: string[] = [];
    const telemetry = createRetrievalTelemetry({ sink: { send: async () => {} }, write: (line) => void written.push(line), requestId: "req-7" });
    const error = new ProviderError("throttled", "aws-bedrock", `HTTP 429 ${SECRET_TEXT}`, { attempts: 3, httpStatus: 429 });
    telemetry.observe("query_embedding", 12, true);
    telemetry.observe("rerank", 40, false, error);
    telemetry.observe("total", 60, false, error);
    await telemetry.failed("error");
    const line = JSON.parse(written[0]!) as Record<string, unknown>;
    expect(line).toMatchObject({ event: "retrieval", request_id: "req-7", outcome: "error", failed_steps: ["rerank", "total"] });
    expect(line.provider_errors).toEqual([
      { step: "rerank", provider: "aws-bedrock", provider_error_kind: "throttled", throttled: true, timeout: false, retryable: true, http_status: 429, error_class: "ProviderError", attempts: 3 },
    ]);
    expect(written[0]).not.toContain("Hansen");
  });

  it("a failure that is not the provider's carries no provider fields", async () => {
    const written: string[] = [];
    const telemetry = createRetrievalTelemetry({ sink: { send: async () => {} }, write: (line) => void written.push(line) });
    telemetry.observe("search", 5, false, new Error("db"));
    await telemetry.failed("unavailable");
    expect(JSON.parse(written[0]!)).not.toHaveProperty("provider_errors");
  });
});

describe("the worker's failure line", () => {
  it("names the step, the duration and the provider error class", async () => {
    const lines: Record<string, unknown>[] = [];
    const db = {
      embeddingModels: async () => [{ id: "m", provider: "aws-bedrock", model_name: "cohere.embed-v4:0", model_version: "eu-1024-v1", dimensions: 1024, status: "candidate" }],
      chunksToEmbed: async () => [{ chunk_id: "c1", text: SECRET_TEXT, lead_in: null, heading_path: [], language: "da" }],
      verifyIndex: async (): Promise<IntegrityRow[]> => [],
      heartbeat: async () => {},
      checkpoint: async () => {},
      complete: async () => {},
      fail: async () => "retry" as const,
    } as unknown as WorkerDb;
    const job: ClaimedJob = { job_id: "j", version_id: "v", kind: "reembed", attempts: 1, max_attempts: 3, step_state: {}, storage_path: "a/b.pdf", checksum_sha256: "0".repeat(64) };
    const embedderFor = () => ({
      id: "x",
      grade: "production" as const,
      dimensions: 1024,
      embed: async () => {
        throw new ProviderError("throttled", "aws-bedrock", `HTTP 429 ${SECRET_TEXT}`, { attempts: 5, httpStatus: 429 });
      },
    });
    const outcome = await processJob(job, { db, originals: staticOriginals(), log: (event) => void lines.push(event), gate: releasedGate(), embedderFor });
    expect(outcome).toBe("retry");
    const failure = lines.find((line) => line.outcome === "retry")!;
    expect(failure).toMatchObject({
      step: "embedding",
      error: "ProviderError",
      provider: "aws-bedrock",
      operation: "embed_document",
      provider_error_kind: "throttled",
      throttled: true,
      timeout: false,
      http_status: 429,
      attempts: 5,
    });
    expect(typeof failure.ms).toBe("number");
    expect(JSON.stringify(lines)).not.toContain("Hansen");
  });
});

describe("the monitoring spec uses the fields the code writes", () => {
  const root = path.resolve(__dirname, "../..");
  const spec = JSON.parse(fs.readFileSync(path.join(root, "deploy/monitoring/aggregate-alarms.json"), "utf8")) as {
    version: number;
    minimumSamples: number;
    minimumSamplesAppliesTo: string[];
    singleEventAlarms: string[];
    sources: Record<string, { event: string; fields: string[]; emittedBy: string[] }>;
    alarms: { id: string; kind: "rate" | "p95"; source: string; threshold: number; windowMinutes: number; severity: string; minimumSamples: number }[];
  };

  it("is versioned, with the B-033 minimum of 20 samples for every rate and p95 alarm", () => {
    expect(spec.version).toBeGreaterThanOrEqual(1);
    expect(spec.minimumSamples).toBe(20);
    expect(spec.minimumSamplesAppliesTo.sort()).toEqual(["p95", "rate"]);
    for (const alarm of spec.alarms) {
      expect(["rate", "p95"], alarm.id).toContain(alarm.kind);
      expect(alarm.minimumSamples, alarm.id).toBe(spec.minimumSamples);
      expect(alarm.severity, alarm.id).toBe("warning");
      expect(alarm.windowMinutes, alarm.id).toBe(15);
    }
    // Single events are never held back by the minimum.
    expect(spec.singleEventAlarms).toEqual(expect.arrayContaining(["hard_gate_regression", "configuration_suspended", "scanner_failures", "ipa-scanner-technical-failures", "evaluation_invalid", "retrieval_unavailable"]));
  });

  it("every field an alarm needs is written by the module that emits the event", () => {
    for (const [name, source] of Object.entries(spec.sources)) {
      const code = source.emittedBy.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
      expect(code, name).toContain(source.event);
      for (const field of source.fields) expect(code, `${name}.${field}`).toMatch(new RegExp(`\\b${field}\\b`));
    }
    for (const alarm of spec.alarms) expect(Object.keys(spec.sources), alarm.id).toContain(alarm.source);
    // A6 (throttling) and the timeout rate are buildable now: the provider_call line carries both.
    expect(spec.sources.provider_call!.fields).toEqual(expect.arrayContaining(["provider_error_kind", "throttled", "timeout", "operation", "runtime"]));
    expect(spec.alarms.map((alarm) => alarm.id)).toEqual(expect.arrayContaining(["A6"]));
  });

  it("the markdown names the same version and alarms", () => {
    const markdown = fs.readFileSync(path.join(root, "deploy/monitoring/aggregate-alarms.md"), "utf8");
    expect(markdown).toContain(`version ${spec.version}`);
    for (const alarm of spec.alarms) expect(markdown, alarm.id).toContain(`| ${alarm.id} |`);
    expect(markdown).not.toContain("Kan ikke bygges endnu");
  });
});
