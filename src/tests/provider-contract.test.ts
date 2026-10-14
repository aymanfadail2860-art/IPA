import fs from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { userText, type ClassifiedText } from "@/lib/egress/classification";
import { embeddingInput, type Embedder, type EmbeddingModelSpec, type EmbeddingProvider } from "@/lib/knowledge/core/embedding";
import {
  backoffDelay,
  canonicalJson,
  ProviderError,
  PROVIDER_ERROR_KINDS,
  providerErrorFields,
  RETRYABLE_ERROR_KINDS,
  retrievalFingerprint,
  retrievalFingerprintMaterial,
  withRetry,
  type RetryPolicy,
} from "@/lib/knowledge/core/provider";
import { createEmbedder, createReranker, ProviderNotConfiguredError, RerankerNotConfiguredError } from "@/lib/knowledge/core/registry";
import { NONE_RERANKER_DESCRIPTOR, type Reranker, type RerankInput } from "@/lib/knowledge/core/reranker";
import { TEST_EMBEDDER, TEST_EMBEDDER_DESCRIPTOR } from "@/lib/knowledge/core/test-embedder";
import { DEFAULT_RETRIEVAL_CONFIG, RETRIEVAL_ALGORITHM_VERSION, runRetrieval, type KnowledgeRpcClient, type SearchRow } from "@/lib/knowledge/retrieval-core";
import { createRetrievalTelemetry, resetTelemetryCooldowns } from "@/lib/observability/retrieval-telemetry";

import { processJob, type ClaimedJob, type IntegrityRow, type WorkerDb } from "../../workers/ingestion/pipeline.ts";
import { checkEmbeddingModels, workerEmbedderFactory } from "../../workers/ingestion/providers.ts";

import { declaredProductionDoubles } from "./fixtures/production-config";
import { releasedGate, staticOriginals } from "./fixtures/worker-fakes";

/**
 * Beta L2 (docs/beta.md §14) — the vendor-neutral requirements of the provider contract, moved
 * here from the AWS-only tests before those were removed (knowledge-providers,
 * knowledge-providers-boundary, provider-metrics, worker-production-embedder,
 * application-aws-credentials). The Bedrock adapters are gone; what every embedding or reranking
 * provider must honour — and what retrieval, the worker and the telemetry do around it — stays:
 *
 *   * implementations declare themselves; error kinds, timeouts and retries are provider-agnostic;
 *   * fail-closed: the registry constructs no production provider, and a provider failure fails
 *     retrieval and stops the worker's start — never a fallback to a development implementation;
 *   * the data boundary: only the query text and each passage's heading chain and text are handed
 *     to a provider — no ids, titles, products or sources;
 *   * the fingerprint covers every result-relevant part and nothing else;
 *   * the error class reaches the log lines without the provider's message;
 *   * the monitoring spec (deploy/monitoring) uses the fields the code writes.
 */

const REPO = path.resolve(__dirname, "../..");
const SECRET_TEXT = "Kunden Jens Hansen, CPR 010190-1234";
const fast: RetryPolicy = { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100, attemptTimeoutMs: 50 };
const noSleep = { sleep: async () => {}, random: () => 0.5 };
const query = (text: string) => userText(text, { caseBound: false, redacted: true });

/** A provider double that records exactly what it is handed (the texts with their provenance). */
function recording() {
  const embedded: { texts: ClassifiedText[]; inputType: string }[] = [];
  const reranked: RerankInput[] = [];
  const embedder: Embedder = {
    id: "recording:embed@1",
    grade: "development",
    dimensions: 3,
    embed: async (texts, options) => {
      embedded.push({ texts: [...texts], inputType: options.inputType });
      return texts.map(() => [1, 0, 0]);
    },
  };
  const reranker: Reranker = {
    id: "recording:rerank",
    version: "1",
    grade: "development",
    rerank: async (input) => {
      reranked.push(input);
      return { ranked: input.candidates.map((candidate, i) => ({ chunkId: candidate.chunkId, score: 1 / (i + 1), rank: i + 1, reasons: [] })), reranker: { id: "recording:rerank", version: "1" } };
    },
  };
  return { embedder, reranker, embedded, reranked };
}

const ROW: SearchRow = {
  chunk_id: "chunk-1", chunk_index: 0, kind: "prose", text: "Selvrisikoen er 10.000 kr. for hver skade.", lead_in: "Gælder alle skader:", heading: "§ 3 Selvrisiko",
  heading_path: ["§ 3 Selvrisiko"], section_number: "3", page_start: 2, page_end: 2, char_start: 0, char_end: 42, overlap_chars: 0,
  version_id: "version-secret-id", version_label: "2", language: "da", valid_from: "2025-07-01", valid_to: null, approved_at: "2026-01-01T00:00:00Z",
  superseded_by: null, document_id: "document-secret-id", document_title: "Fortrolig titel (fiktiv)", document_type: "terms", product_id: "product-secret-id",
  product_name: "Fiktivt produkt", source_type: "manual_upload", temporal_status: "current", vector_rank: 1, vector_score: 0.9, lexical_rank: 1, lexical_score: 1, lexical_terms: ["selvrisiko"], chunker_version: "structure/1",
};
const db: KnowledgeRpcClient = { rpc: async (fn) => ({ data: fn === "search_chunks" ? [ROW] : [], error: null }) };

// ---------------------------------------------------------------------------------------------

describe("the provider contract: every implementation declares itself", () => {
  const declared = declaredProductionDoubles();
  const all = [TEST_EMBEDDER_DESCRIPTOR, NONE_RERANKER_DESCRIPTOR, declared.embedder.descriptor, declared.reranker.descriptor];

  it("declares provider, model, version, grade, processing, settings and limits", () => {
    for (const descriptor of all) {
      expect(descriptor.provider).toMatch(/^[a-z0-9][a-z0-9_-]*$/);
      expect(descriptor.model.length).toBeGreaterThan(0);
      expect(descriptor.modelVersion.length).toBeGreaterThan(0);
      expect(["development", "production"]).toContain(descriptor.grade);
      expect(["in_process", "in_region", "geographic"]).toContain(descriptor.processing.kind);
      expect(Object.isFrozen(descriptor)).toBe(true);
      expect(Object.values(descriptor.limits).every((value) => Number.isInteger(value) && value > 0)).toBe(true);
    }
  });

  it("the development implementations stay development and run in-process", () => {
    expect(TEST_EMBEDDER_DESCRIPTOR).toMatchObject({ grade: "development", processing: { kind: "in_process" }, inputTypes: "symmetric", dimensions: 256 });
    expect(NONE_RERANKER_DESCRIPTOR).toMatchObject({ grade: "development", id: "none", processing: { kind: "in_process" } });
    expect(createEmbedder({ id: "m", ...TEST_EMBEDDER }, "test").descriptor).toBe(TEST_EMBEDDER_DESCRIPTOR);
    expect(createReranker("none", "test").descriptor).toBe(NONE_RERANKER_DESCRIPTOR);
  });

  it("error kinds: only unavailable, throttled and timeout are retryable", () => {
    expect([...RETRYABLE_ERROR_KINDS].sort()).toEqual(["throttled", "timeout", "unavailable"]);
    for (const kind of PROVIDER_ERROR_KINDS) expect(new ProviderError(kind, "p", "x").retryable).toBe(RETRYABLE_ERROR_KINDS.includes(kind));
  });
});

describe("timeouts and retries (provider-agnostic)", () => {
  it("times out each attempt, aborts the call and gives up after maxAttempts", async () => {
    const signals: AbortSignal[] = [];
    const error = await withRetry("p", fast, (signal) => {
      signals.push(signal);
      return new Promise(() => {});
    }, noSleep).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ kind: "timeout", attempts: 3, retryable: true });
    expect(signals).toHaveLength(3);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("retries a retryable error and succeeds", async () => {
    let calls = 0;
    const result = await withRetry("p", fast, async () => {
      calls += 1;
      if (calls < 3) throw new ProviderError("throttled", "p", "429", { httpStatus: 429 });
      return "ok";
    }, noSleep);
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it.each(["invalid_request", "access_denied", "model_not_found", "credentials", "invalid_response"] as const)("does not retry %s", async (kind) => {
    let calls = 0;
    await expect(withRetry("p", fast, async () => {
      calls += 1;
      throw new ProviderError(kind, "p", "nej");
    }, noSleep)).rejects.toMatchObject({ kind });
    expect(calls).toBe(1);
  });

  it("backs off exponentially with full jitter, capped", () => {
    const policy = { ...fast, baseDelayMs: 100, maxDelayMs: 1000 };
    expect(backoffDelay(policy, 1, () => 0.999)).toBe(199);
    expect(backoffDelay(policy, 2, () => 0.999)).toBe(399);
    expect(backoffDelay(policy, 5, () => 0.999)).toBe(999);
    expect(backoffDelay(policy, 3, () => 0)).toBe(0);
  });

  it("waits between attempts and never after the last", async () => {
    const waits: number[] = [];
    const attempt = withRetry("p", { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1000, attemptTimeoutMs: 50 }, async () => {
      throw new ProviderError("unavailable", "p", "nede");
    }, { sleep: async (ms) => void waits.push(ms), random: () => 0.5 });
    await expect(attempt).rejects.toMatchObject({ kind: "unavailable", attempts: 3 });
    expect(waits).toEqual([100, 200]);
  });

  it("an unexpected throw inside an adapter is classified, never passed through as success", async () => {
    await expect(withRetry("p", fast, async () => {
      throw new TypeError("bug");
    })).rejects.toMatchObject({ kind: "invalid_response", retryable: false });
  });
});

// ---------------------------------------------------------------------------------------------

describe("fail-closed: no production provider, no fallback", () => {
  // The rows of the removed 8B adapters (docs/08b §2.2): data only.
  const removedEmbedding = { id: "m", provider: "aws-bedrock", model_name: "cohere.embed-v4:0", model_version: "eu-1024-v1", dimensions: 1024 };

  it("the registry constructs no production provider in any runtime (L2: none exists)", () => {
    for (const environment of ["local", "test", "production"] as const) {
      expect(() => createEmbedder(removedEmbedding, environment)).toThrow(ProviderNotConfiguredError);
      expect(() => createReranker("aws-bedrock:cohere.rerank-v3-5:0", environment)).toThrow(RerankerNotConfiguredError);
    }
  });

  it("a provider failure fails retrieval: no set is issued and nothing falls back", async () => {
    const failing: Embedder = { id: "x", grade: "development", dimensions: 3, embed: async () => { throw new ProviderError("unavailable", "p", "nede", { httpStatus: 503 }); } };
    await expect(runRetrieval({ query: query("selvrisiko") }, { db, embedding: { embedder: failing, modelId: "m" }, reranker: recording().reranker })).rejects.toMatchObject({ name: "ProviderError", kind: "unavailable" });
  });

  it("a reranker failure fails retrieval", async () => {
    const failing: Reranker = { id: "x", version: "1", grade: "development", rerank: async () => { throw new ProviderError("invalid_response", "p", "svar uden resultater"); } };
    await expect(runRetrieval({ query: query("selvrisiko") }, { db, embedding: null, reranker: failing })).rejects.toMatchObject({ kind: "invalid_response" });
  });

  describe("the worker's start (docs/07 §9.1, 8B-I8 C7)", () => {
    const factory = (environment: "production" | "test") => workerEmbedderFactory({ environment });

    it("an embedding model without an implementation stops the start — in every runtime", () => {
      for (const environment of ["production", "test"] as const) {
        expect(checkEmbeddingModels([removedEmbedding], factory(environment))).toEqual([{ model: "aws-bedrock:cohere.embed-v4:0@eu-1024-v1", code: "ProviderNotConfiguredError" }]);
      }
      expect(checkEmbeddingModels([{ id: "m", provider: "acme", model_name: "x", model_version: "1", dimensions: 1024 }], factory("test"))).toEqual([{ model: "acme:x@1", code: "ProviderNotConfiguredError" }]);
    });

    it("a development-only model is refused in production, allowed in test", () => {
      expect(checkEmbeddingModels([{ id: "t", ...TEST_EMBEDDER }], factory("production"))[0]?.code).toBe("GradeNotAllowedError");
      expect(checkEmbeddingModels([{ id: "t", ...TEST_EMBEDDER }], factory("test"))).toEqual([]);
    });

    it("a resolved embedder whose dimension is not the registered one stops the start", () => {
      const model: EmbeddingModelSpec = { id: "t", ...TEST_EMBEDDER };
      const resolved = factory("test")(model);
      const wrong = { ...resolved, descriptor: { ...resolved.descriptor, dimensions: 1536 } } as EmbeddingProvider;
      expect(checkEmbeddingModels([model], () => wrong)).toEqual([{ model: "test:test-hash-embedder@1", code: "dimensions" }]);
    });

    it("never the test embedder instead — an unknown model is an error, not a substitution", () => {
      expect(() => factory("test")({ ...TEST_EMBEDDER, id: "t", model_version: "unknown" })).toThrow(ProviderNotConfiguredError);
    });
  });
});

// ---------------------------------------------------------------------------------------------

describe("the data boundary: exactly what retrieval and the worker hand to a provider", () => {
  async function retrieve(text: string) {
    const providers = recording();
    await runRetrieval({ query: query(text) }, { db, embedding: { embedder: providers.embedder, modelId: "m" }, reranker: providers.reranker });
    return providers;
  }

  it("query embedding: only the normalized query text, as a query, with its provenance", async () => {
    const { embedded } = await retrieve("  Hvad er selvrisikoen?  ");
    expect(embedded).toHaveLength(1);
    expect(embedded[0]!.inputType).toBe("query");
    expect(embedded[0]!.texts.map((entry) => entry.text)).toEqual(["Hvad er selvrisikoen?"]);
    expect(embedded[0]!.texts[0]!.provenance.category).toBe("user_question");
  });

  it("reranking: only the query and each candidate's heading chain and text, as Knowledge Engine text", async () => {
    const { reranked } = await retrieve("Hvad er selvrisikoen?");
    expect(reranked).toHaveLength(1);
    expect(reranked[0]!.query.text).toBe("Hvad er selvrisikoen?");
    expect(reranked[0]!.candidates.map((candidate) => candidate.document.text)).toEqual(["§ 3 Selvrisiko\nSelvrisikoen er 10.000 kr. for hver skade."]);
    expect(reranked[0]!.candidates[0]!.document.provenance.source).toBe("knowledge_engine");
  });

  it("no ids, titles, products, sources or access data are handed to a provider", async () => {
    const { embedded, reranked } = await retrieve("Hvad er selvrisikoen?");
    const handed = JSON.stringify([embedded.map((call) => call.texts.map((entry) => entry.text)), reranked.map((input) => [input.query.text, input.candidates.map((candidate) => candidate.document.text)])]);
    for (const secret of ["version-secret-id", "document-secret-id", "product-secret-id", "chunk-1", "Fortrolig titel", "Fiktivt produkt", "manual_upload"]) {
      expect(handed).not.toContain(secret);
    }
  });

  it("document embedding in the worker: only each chunk's embedding input, as documents of the Knowledge Engine", async () => {
    const providers = recording();
    const chunks = [
      { chunk_id: "c1", text: "Forsikringen dækker ikke forurening.", lead_in: null, heading_path: ["§ 4"], language: "da" },
      { chunk_id: "c2", text: "• skade forvoldt med forsæt", lead_in: "Forsikringen dækker ikke:", heading_path: ["§ 4"], language: "da" },
    ];
    const stored: { chunk_id: string; embedding: number[] }[] = [];
    const workerDb = {
      claim: async () => null,
      embeddingModels: async () => [{ id: "m", provider: "recording", model_name: "embed", model_version: "1", dimensions: 3, status: "candidate" }],
      chunksToEmbed: async () => chunks.filter((chunk) => !stored.some((row) => row.chunk_id === chunk.chunk_id)),
      storeEmbeddings: async (_job: string, _model: string, rows: { chunk_id: string; embedding: number[] }[]) => {
        stored.push(...rows);
        return rows.length;
      },
      verifyIndex: async (): Promise<IntegrityRow[]> => [{ model_id: "m", model: "x", status: "candidate", chunks: 2, embeddings: stored.length, wrong_dimensions: 0 }],
      heartbeat: async () => {},
      checkpoint: async () => {},
      storePages: async () => {},
      storeChunks: async () => 0,
      complete: async () => {},
      fail: async () => "failed" as const,
    } as unknown as WorkerDb;
    const job: ClaimedJob = { job_id: "j", version_id: "v", kind: "reembed", attempts: 1, max_attempts: 3, step_state: {}, storage_path: "a/b.pdf", checksum_sha256: "0".repeat(64) };
    const embedderFor = () => ({ ...providers.embedder, descriptor: TEST_EMBEDDER_DESCRIPTOR }) as EmbeddingProvider;
    expect(await processJob(job, { db: workerDb, originals: staticOriginals(), log: () => {}, gate: releasedGate(), embedderFor })).toBe("succeeded");
    expect(providers.embedded).toHaveLength(1);
    expect(providers.embedded[0]!.inputType).toBe("document");
    expect(providers.embedded[0]!.texts.map((entry) => entry.text)).toEqual(chunks.map((chunk) => embeddingInput(chunk)));
    expect(providers.embedded[0]!.texts.every((entry) => entry.provenance.source === "knowledge_engine")).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------

describe("fingerprint material (docs/08b §10.1)", () => {
  const { embedder, reranker } = declaredProductionDoubles();
  const E = embedder.descriptor;
  const R = reranker.descriptor;
  const material = (overrides: Partial<Parameters<typeof retrievalFingerprintMaterial>[0]> = {}) =>
    retrievalFingerprintMaterial({ embedding: E, reranker: R, algorithmVersion: RETRIEVAL_ALGORITHM_VERSION, params: { ...DEFAULT_RETRIEVAL_CONFIG }, chunkerVersions: ["structure/1"], ...overrides });
  const base = retrievalFingerprint(material());

  it("changes with every result-relevant part", () => {
    const variants = [
      material({ embedding: { ...E, provider: "other" } }),
      material({ embedding: { ...E, model: "embed:1" } }),
      material({ embedding: { ...E, modelVersion: "v2" } }),
      material({ embedding: { ...E, dimensions: 1536 } }),
      material({ embedding: { ...E, settings: { ...E.settings, truncate: "END" } } }),
      material({ embedding: { ...E, processing: { kind: "in_region", region: "eu-central-1" } } }),
      material({ embedding: TEST_EMBEDDER_DESCRIPTOR }),
      material({ embedding: null }),
      material({ reranker: NONE_RERANKER_DESCRIPTOR }),
      material({ reranker: { ...R, settings: { ...R.settings, topN: 10 } } }),
      material({ reranker: { ...R, version: "v2" } }),
      material({ algorithmVersion: "hybrid-rrf-2" }),
      material({ params: { ...DEFAULT_RETRIEVAL_CONFIG, minScore: 0.2 } }),
      material({ chunkerVersions: ["structure/2"] }),
    ];
    const fingerprints = variants.map(retrievalFingerprint);
    for (const fingerprint of fingerprints) expect(fingerprint).not.toBe(base);
    expect(new Set(fingerprints).size).toBe(fingerprints.length);
  });

  it("is stable when only runtime details change: limits or chunker order", () => {
    expect(retrievalFingerprint(material({ embedding: { ...E, limits: { maxTextsPerRequest: 10, maxCharsPerText: 10, maxCharsPerRequest: 10 } } }))).toBe(base);
    expect(retrievalFingerprint(material({ chunkerVersions: ["b", "a", "a"] }))).toBe(retrievalFingerprint(material({ chunkerVersions: ["a", "b"] })));
    expect(canonicalJson(material())).not.toMatch(/attemptTimeoutMs|maxAttempts|maxTextsPerRequest/);
  });
});

// ---------------------------------------------------------------------------------------------

describe("the provider's error class reaches the log lines — never its message (8B-I8 C3)", () => {
  beforeEach(() => resetTelemetryCooldowns());
  const throttled = () => new ProviderError("throttled", "external-provider", `HTTP 429 ${SECRET_TEXT}`, { attempts: 3, httpStatus: 429 });

  it("keeps the HTTP status and marks 429 as throttled, also after retries", async () => {
    expect(providerErrorFields(throttled())).toEqual({ provider_error_kind: "throttled", throttled: true, timeout: false, retryable: true, http_status: 429, error_class: "ProviderError" });
    const final = await withRetry("external-provider", { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 1, attemptTimeoutMs: 1_000 }, async () => {
      throw throttled();
    }, noSleep).catch((error: unknown) => error as ProviderError);
    expect(final).toMatchObject({ kind: "throttled", attempts: 2, httpStatus: 429 });
    expect(providerErrorFields(new TypeError("x"))).toEqual({ provider_error_kind: null, throttled: false, timeout: false, retryable: null, http_status: null, error_class: "TypeError" });
  });

  it("the retrieval line carries the failing step's provider error; request_id correlates", async () => {
    const written: string[] = [];
    const telemetry = createRetrievalTelemetry({ sink: { send: async () => {} }, write: (line) => void written.push(line), requestId: "req-7" });
    telemetry.observe("query_embedding", 12, true);
    telemetry.observe("rerank", 40, false, throttled());
    telemetry.observe("total", 60, false, throttled());
    await telemetry.failed("error");
    const line = JSON.parse(written[0]!) as Record<string, unknown>;
    expect(line).toMatchObject({ event: "retrieval", request_id: "req-7", outcome: "error", failed_steps: ["rerank", "total"] });
    expect(line.provider_errors).toEqual([
      { step: "rerank", provider: "external-provider", provider_error_kind: "throttled", throttled: true, timeout: false, retryable: true, http_status: 429, error_class: "ProviderError", attempts: 3 },
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

  it("the worker's failure line names the step, the duration and the provider error class", async () => {
    const lines: Record<string, unknown>[] = [];
    const workerDb = {
      embeddingModels: async () => [{ id: "m", provider: "external-provider", model_name: "embed", model_version: "1", dimensions: 3, status: "candidate" }],
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
      grade: "development" as const,
      dimensions: 3,
      embed: async () => {
        throw new ProviderError("throttled", "external-provider", `HTTP 429 ${SECRET_TEXT}`, { attempts: 5, httpStatus: 429 });
      },
    }) as unknown as EmbeddingProvider;
    expect(await processJob(job, { db: workerDb, originals: staticOriginals(), log: (event) => void lines.push(event), gate: releasedGate(), embedderFor })).toBe("retry");
    const failure = lines.find((line) => line.outcome === "retry")!;
    expect(failure).toMatchObject({ step: "embedding", error: "ProviderError", provider: "external-provider", operation: "embed_document", provider_error_kind: "throttled", throttled: true, timeout: false, http_status: 429, attempts: 5 });
    expect(typeof failure.ms).toBe("number");
    expect(JSON.stringify(lines)).not.toContain("Hansen");
  });
});

describe("the monitoring spec uses the fields the code writes (B-033; version 2, beta L2)", () => {
  const spec = JSON.parse(fs.readFileSync(path.join(REPO, "deploy/monitoring/aggregate-alarms.json"), "utf8")) as {
    version: number;
    minimumSamples: number;
    minimumSamplesAppliesTo: string[];
    singleEventAlarms: string[];
    sources: Record<string, { event: string; fields: string[]; emittedBy: string[] }>;
    alarms: { id: string; kind: "rate" | "p95"; source: string; threshold: number; windowMinutes: number; severity: string; minimumSamples: number }[];
    removedInVersion2: { alarms: string[]; sources: string[]; singleEventAlarms: string[] };
  };

  it("is versioned, with the B-033 minimum of 20 samples for every rate and p95 alarm", () => {
    expect(spec.version).toBe(2);
    expect(spec.minimumSamples).toBe(20);
    expect([...spec.minimumSamplesAppliesTo].sort()).toEqual(["p95", "rate"]);
    for (const alarm of spec.alarms) {
      expect(["rate", "p95"], alarm.id).toContain(alarm.kind);
      expect(alarm.minimumSamples, alarm.id).toBe(spec.minimumSamples);
      expect(alarm.severity, alarm.id).toBe("warning");
      expect(alarm.windowMinutes, alarm.id).toBe(15);
    }
    // Single events are never held back by the minimum.
    expect(spec.singleEventAlarms).toEqual(expect.arrayContaining(["hard_gate_regression", "configuration_suspended", "scanner_failures", "malware_found", "evaluation_invalid", "retrieval_unavailable"]));
  });

  it("every field an alarm needs is written by the module that emits the event", () => {
    for (const [name, source] of Object.entries(spec.sources)) {
      const code = source.emittedBy.map((file) => fs.readFileSync(path.join(REPO, file), "utf8")).join("\n");
      expect(code, name).toContain(source.event);
      for (const field of source.fields) expect(code, `${name}.${field}`).toMatch(new RegExp(`\\b${field}\\b`));
    }
    for (const alarm of spec.alarms) expect(Object.keys(spec.sources), alarm.id).toContain(alarm.source);
  });

  it("L2 removed exactly the Bedrock-only source and alarms; nothing names AWS any more", () => {
    expect(spec.alarms.map((alarm) => alarm.id)).toEqual(["A1", "A3", "A4", "A5"]);
    expect(spec.removedInVersion2).toMatchObject({ alarms: ["A2", "A6"], sources: ["provider_call"] });
    expect(Object.keys(spec.sources)).not.toContain("provider_call");
    for (const removed of spec.removedInVersion2.singleEventAlarms) expect(spec.singleEventAlarms).not.toContain(removed);
    const live = JSON.stringify({ ...spec, removedInVersion2: undefined, $comment: undefined });
    expect(live).not.toMatch(/CloudWatch|Bedrock|aws/i);
  });

  it("the markdown names the same version and alarms", () => {
    const markdown = fs.readFileSync(path.join(REPO, "deploy/monitoring/aggregate-alarms.md"), "utf8");
    expect(markdown).toContain(`version ${spec.version}`);
    for (const alarm of spec.alarms) expect(markdown, alarm.id).toContain(`| ${alarm.id} |`);
    for (const removed of spec.removedInVersion2.alarms) expect(markdown, removed).not.toContain(`| ${removed} |`);
  });
});

describe("providers, the egress boundary and credentials stay on the server", () => {
  const SRC = path.join(REPO, "src");

  function resolveImport(from: string, specifier: string): string | null {
    const base = specifier.startsWith("@/") ? path.join(SRC, specifier.slice(2)) : specifier.startsWith(".") ? path.resolve(path.dirname(from), specifier) : null;
    if (!base) return null;
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    return null;
  }

  /** Every module and package a client component pulls into the browser bundle. */
  function clientGraph(): { files: Set<string>; packages: Set<string> } {
    const files = new Set<string>();
    const packages = new Set<string>();
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === "tests" ? [] : walk(full);
        return /\.tsx?$/.test(entry.name) ? [full] : [];
      });
    const queue = walk(SRC).filter((file) => /^["']use client["']/m.test(fs.readFileSync(file, "utf8")));
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (files.has(file)) continue;
      files.add(file);
      const text = fs.readFileSync(file, "utf8");
      // A server action is only a reference in the client bundle; its code stays on the server.
      if (/^["']use server["']/m.test(text)) continue;
      for (const match of text.matchAll(/^\s*(import|export)\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm)) {
        const specifier = match[2] ?? match[3]!;
        const resolved = resolveImport(file, specifier);
        if (resolved) queue.push(resolved);
        else if (!specifier.startsWith(".") && !specifier.startsWith("@/")) packages.add(specifier);
      }
    }
    return { files, packages };
  }

  it("no client component reaches the provider selection, the registry, retrieval or the egress boundary", () => {
    const { files, packages } = clientGraph();
    expect(files.size).toBeGreaterThan(20);
    const reached = [...files].map((file) => path.relative(REPO, file).split(path.sep).join("/"));
    expect(reached.filter((file) => /lib\/knowledge\/(providers|core\/registry|retrieval)|lib\/egress\//.test(file))).toEqual([]);
    expect([...packages].filter((name) => /^@aws-sdk\/|^@smithy\/|^@anthropic-ai\/|^openai$|^@vercel\/oidc/.test(name))).toEqual([]);
  });

  it("no NEXT_PUBLIC_ variable carries a key, a secret or a provider credential into the browser", () => {
    const code = fs.readdirSync(SRC, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.parentPath.includes(`${path.sep}tests`))
      .map((entry) => fs.readFileSync(path.join(entry.parentPath, entry.name), "utf8"))
      .join("\n");
    const publicNames = new Set([...code.matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)].map((match) => match[0]));
    expect([...publicNames].filter((name) => /SECRET|SERVICE_ROLE|PASSWORD|TOKEN|AWS|ANTHROPIC|API_KEY/.test(name))).toEqual([]);
  });
});
