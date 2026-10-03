import { describe, expect, it } from "vitest";

import { NONE_RERANKER_DESCRIPTOR } from "@/lib/knowledge/core/reranker";
import {
  backoffDelay,
  canonicalJson,
  embeddingLabel,
  ProviderError,
  PROVIDER_ERROR_KINDS,
  RETRYABLE_ERROR_KINDS,
  retrievalFingerprint,
  retrievalFingerprintMaterial,
  withRetry,
  type EmbeddingProviderDescriptor,
  type RetryPolicy,
} from "@/lib/knowledge/core/provider";
import { TEST_EMBEDDER_DESCRIPTOR } from "@/lib/knowledge/core/test-embedder";
import { createEmbedder, createReranker, ProviderNotConfiguredError, RerankerNotConfiguredError } from "@/lib/knowledge/core/registry";
import { DEFAULT_RETRIEVAL_CONFIG, RETRIEVAL_ALGORITHM_VERSION, runRetrieval, type KnowledgeRpcClient, type SearchRow } from "@/lib/knowledge/retrieval-core";
import {
  batchTexts,
  COHERE_EMBED_V4_EU_PROFILE,
  createCohereEmbedV4,
  EMBED_RETRY_POLICY,
  EMBED_V4_EU_1024_DESCRIPTOR,
  embedRequestBody,
} from "@/lib/knowledge/providers/bedrock/cohere-embed-v4";
import { COHERE_RERANK_35_ID, COHERE_RERANK_35_MODEL, createCohereRerank35, RERANK_35_DESCRIPTOR, rerankRequestBody } from "@/lib/knowledge/providers/bedrock/cohere-rerank-3-5";
import { assertNoStaticKeys, classifyBedrockError } from "@/lib/knowledge/providers/bedrock/transport";
import { createProductionEmbedder, createProductionReranker, embeddingModelRow, PRODUCTION_EMBEDDING_DESCRIPTORS } from "@/lib/knowledge/providers/catalog";
import type { RerankCandidate } from "@/lib/knowledge/core/reranker";

import { awsError, embedResponse, fakeBedrock, fakeVector, noSleep } from "./fixtures/bedrock-fake";

/** 8B-I2 — provider-kontrakten og Bedrock-adapterne (docs/08b §2–§3). Alt kører mod en falsk transport. */

const fast: RetryPolicy = { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100, attemptTimeoutMs: 50 };

function embedder(handler: Parameters<typeof fakeBedrock>[0], options: { retry?: RetryPolicy; region?: string } = {}) {
  const fake = fakeBedrock(handler, options.region);
  return { ...fake, embedder: createCohereEmbedV4({ transport: fake.transport, retry: options.retry ?? fast, retryDeps: noSleep }) };
}

function reranker(handler: Parameters<typeof fakeBedrock>[0], options: { retry?: RetryPolicy } = {}) {
  const fake = fakeBedrock(handler);
  return { ...fake, reranker: createCohereRerank35({ transport: fake.transport, retry: options.retry ?? fast, retryDeps: noSleep }) };
}

const candidate = (i: number, overrides: Partial<RerankCandidate> = {}): RerankCandidate => ({
  chunkId: `c${i}`,
  text: `Fiktiv passage nummer ${i}.`,
  headingPath: [`§ ${i}`],
  retrieval: { fusedScore: 1 / (i + 1) },
  ...overrides,
});

async function kindOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return error instanceof ProviderError ? error.kind : `other:${(error as Error).name}`;
  }
}

// ---------------------------------------------------------------------------------------------

describe("the provider contract: every implementation declares itself", () => {
  const all = [TEST_EMBEDDER_DESCRIPTOR, NONE_RERANKER_DESCRIPTOR, EMBED_V4_EU_1024_DESCRIPTOR, RERANK_35_DESCRIPTOR];

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
    expect(createEmbedder({ id: "m", ...{ provider: "test", model_name: "test-hash-embedder", model_version: "1", dimensions: 256 } }, "test").descriptor).toBe(TEST_EMBEDDER_DESCRIPTOR);
    expect(createReranker("none", "test").descriptor).toBe(NONE_RERANKER_DESCRIPTOR);
  });

  it("Embed v4 is EU-geographic with source region eu-central-1 — not Frankfurt-only (D-1)", () => {
    expect(EMBED_V4_EU_1024_DESCRIPTOR).toMatchObject({
      provider: "aws-bedrock",
      model: "cohere.embed-v4:0",
      grade: "production",
      dimensions: 1024,
      inputTypes: "asymmetric",
      processing: { kind: "geographic", geography: "EU", sourceRegion: "eu-central-1", inferenceProfile: "eu.cohere.embed-v4:0" },
    });
    expect(JSON.stringify(EMBED_V4_EU_1024_DESCRIPTOR)).not.toMatch(/frankfurt/i);
  });

  it("Rerank 3.5 runs in-region in eu-central-1 (D-3)", () => {
    expect(RERANK_35_DESCRIPTOR).toMatchObject({ provider: "aws-bedrock", model: "cohere.rerank-v3-5:0", grade: "production", processing: { kind: "in_region", region: "eu-central-1" } });
  });

  it("error kinds: only unavailable, throttled and timeout are retryable", () => {
    expect([...RETRYABLE_ERROR_KINDS].sort()).toEqual(["throttled", "timeout", "unavailable"]);
    for (const kind of PROVIDER_ERROR_KINDS) expect(new ProviderError(kind, "p", "x").retryable).toBe(RETRYABLE_ERROR_KINDS.includes(kind));
  });
});

// ---------------------------------------------------------------------------------------------

describe("Cohere Embed v4 on Bedrock", () => {
  it("serializes exactly the documented request, to the EU inference profile", async () => {
    const { embedder: e, calls } = embedder((call) => embedResponse(call.body.texts as string[]));
    await e.embed(["Forsikringen dækker ikke forurening."], { inputType: "document" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.modelId).toBe(COHERE_EMBED_V4_EU_PROFILE);
    expect(calls[0]!.body).toEqual({ texts: ["Forsikringen dækker ikke forurening."], input_type: "search_document", embedding_types: ["float"], output_dimension: 1024, truncate: "NONE" });
  });

  it("embeds documents and queries with different input types (asymmetric model, K-2)", async () => {
    const { embedder: e, calls } = embedder((call) => embedResponse(call.body.texts as string[]));
    await e.embed(["dokument"], { inputType: "document" });
    await e.embed(["forespørgsel"], { inputType: "query" });
    expect(calls.map((call) => call.body.input_type)).toEqual(["search_document", "search_query"]);
    expect(embedRequestBody(["x"], "query").input_type).toBe("search_query");
    expect(await kindOf(e.embed(["x"], {} as never))).toBe("configuration");
  });

  it("returns 1024-dimensional vectors in input order and declares 1024 dimensions", async () => {
    const { embedder: e } = embedder((call) => embedResponse(call.body.texts as string[]));
    const vectors = await e.embed(["a-tekst", "b-tekst"], { inputType: "document" });
    expect(e.dimensions).toBe(1024);
    expect(vectors).toEqual([fakeVector("a-tekst"), fakeVector("b-tekst")]);
    expect(e.id).toBe(embeddingLabel({ provider: "aws-bedrock", model: "cohere.embed-v4:0", modelVersion: "eu-1024-v1" }));
  });

  it.each([
    ["not an object", () => "nonsense", "invalid_response"],
    ["no embeddings by type", () => ({ embeddings: [[0.1]] }), "invalid_response"],
    ["no float embeddings", () => ({ embeddings: { int8: [[1]] } }), "invalid_response"],
    ["too few vectors", () => ({ embeddings: { float: [] } }), "invalid_response"],
    ["a vector that is not a list", () => ({ embeddings: { float: ["x"] } }), "invalid_response"],
    ["a wrong dimension", () => embedResponse(["x"], 1536), "dimension_mismatch"],
    ["a non-finite value", () => ({ embeddings: { float: [[...fakeVector("x").slice(1), Number.NaN]] } }), "invalid_response"],
    ["a zero vector", () => ({ embeddings: { float: [new Array(1024).fill(0)] } }), "invalid_response"],
  ])("refuses a malformed response: %s", async (_label, response, kind) => {
    const { embedder: e, calls } = embedder(response as () => unknown);
    expect(await kindOf(e.embed(["x"], { inputType: "document" }))).toBe(kind);
    expect(calls).toHaveLength(1); // An invalid response is not retried.
  });

  it("batches within 96 texts and the character limit, keeping order", async () => {
    const { embedder: e, calls } = embedder((call) => embedResponse(call.body.texts as string[]));
    const texts = Array.from({ length: 200 }, (_, i) => `tekst ${i}`);
    const vectors = await e.embed(texts, { inputType: "document" });
    expect(calls.map((call) => (call.body.texts as string[]).length)).toEqual([96, 96, 8]);
    expect(vectors).toEqual(texts.map((text) => fakeVector(text)));
    const limits = { maxTextsPerRequest: 96, maxCharsPerText: 8000, maxCharsPerRequest: 10 };
    expect(batchTexts(["12345", "67890", "x"], limits).map((batch) => batch.texts)).toEqual([["12345", "67890"], ["x"]]);
  });

  it("validates every text before calling: a defective text is named and nothing is sent", async () => {
    const { embedder: e, calls } = embedder((call) => embedResponse(call.body.texts as string[]));
    const tooLong = "x".repeat(8001);
    for (const [texts, kind, index] of [
      [["ok", "  ", "ok"], "invalid_request", 1],
      [["ok", "ok", tooLong], "input_too_large", 2],
    ] as const) {
      const error = await e.embed([...texts], { inputType: "document" }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ProviderError);
      expect(error).toMatchObject({ kind, inputIndex: index, retryable: false });
    }
    expect(calls).toHaveLength(0);
    expect(await e.embed([], { inputType: "document" })).toEqual([]);
  });

  it("refuses any other model, dimension, profile or region at construction (no wrong model)", () => {
    const transport = fakeBedrock(() => ({})).transport;
    const variants: Partial<EmbeddingProviderDescriptor>[] = [
      { model: "cohere.embed-multilingual-v3" },
      { dimensions: 1000 },
      { processing: { kind: "geographic", geography: "EU", sourceRegion: "eu-central-1", inferenceProfile: "us.cohere.embed-v4:0" } },
      { processing: { kind: "in_region", region: "eu-central-1" } },
    ];
    for (const variant of variants) {
      expect(() => createCohereEmbedV4({ transport, descriptor: { ...EMBED_V4_EU_1024_DESCRIPTOR, ...variant } })).toThrow(ProviderError);
    }
    expect(() => createCohereEmbedV4({ transport: fakeBedrock(() => ({}), "us-east-1").transport })).toThrow(/understøttes ikke/);
  });
});

// ---------------------------------------------------------------------------------------------

describe("Cohere Rerank 3.5 on Bedrock", () => {
  const results = (scores: number[]) => ({ id: "fake", results: scores.map((relevance_score, index) => ({ index, relevance_score })) });

  it("serializes exactly the documented request, in-region, with every candidate scored", async () => {
    const { reranker: r, calls } = reranker(() => results([0.2, 0.9]));
    await r.rerank({ query: "selvrisiko", topN: 1, candidates: [candidate(0, { headingPath: ["§ 3 Selvrisiko"] }), candidate(1, { headingPath: [] })] });
    expect(calls[0]!.modelId).toBe(COHERE_RERANK_35_MODEL);
    expect(calls[0]!.body).toEqual({ query: "selvrisiko", documents: ["§ 3 Selvrisiko\nFiktiv passage nummer 0.", "Fiktiv passage nummer 1."], top_n: 2, api_version: 2 });
    expect(rerankRequestBody("q", [candidate(0)])).toEqual({ query: "q", documents: ["§ 0\nFiktiv passage nummer 0."], top_n: 1, api_version: 2 });
  });

  it("maps results back to the original candidates deterministically, keeps chunk identity and orders ties by candidate order", async () => {
    // The provider's list order is shuffled; candidates 1 and 3 tie.
    const { reranker: r } = reranker(() => ({ results: [
      { index: 3, relevance_score: 0.7 },
      { index: 0, relevance_score: 0.1 },
      { index: 2, relevance_score: 0.95 },
      { index: 1, relevance_score: 0.7 },
    ] }));
    const output = await r.rerank({ query: "q", topN: 3, candidates: [0, 1, 2, 3].map((i) => candidate(i)) });
    expect(output.ranked).toEqual([
      { chunkId: "c2", score: 0.95, rank: 1, reasons: [{ kind: "reranker_score", score: 0.95 }] },
      { chunkId: "c1", score: 0.7, rank: 2, reasons: [{ kind: "reranker_score", score: 0.7 }] },
      { chunkId: "c3", score: 0.7, rank: 3, reasons: [{ kind: "reranker_score", score: 0.7 }] },
    ]);
    expect(output.reranker).toEqual({ id: COHERE_RERANK_35_ID, version: "euc1-v1" });
  });

  it.each([
    ["a missing result", { results: [{ index: 0, relevance_score: 0.5 }] }],
    ["an extra result", { results: [0, 1, 1].map((index) => ({ index, relevance_score: 0.5 })) }],
    ["a duplicate index", { results: [{ index: 0, relevance_score: 0.5 }, { index: 0, relevance_score: 0.4 }] }],
    ["an unknown index", { results: [{ index: 0, relevance_score: 0.5 }, { index: 2, relevance_score: 0.4 }] }],
    ["a negative index", { results: [{ index: 0, relevance_score: 0.5 }, { index: -1, relevance_score: 0.4 }] }],
    ["a fractional index", { results: [{ index: 0, relevance_score: 0.5 }, { index: 0.5, relevance_score: 0.4 }] }],
    ["a score above 1", { results: [{ index: 0, relevance_score: 1.5 }, { index: 1, relevance_score: 0.4 }] }],
    ["a missing score", { results: [{ index: 0 }, { index: 1, relevance_score: 0.4 }] }],
    ["no results", { id: "x" }],
  ])("refuses %s (fail-closed)", async (_label, response) => {
    const { reranker: r, calls } = reranker(() => response);
    expect(await kindOf(r.rerank({ query: "q", topN: 2, candidates: [candidate(0), candidate(1)] }))).toBe("invalid_response");
    expect(calls).toHaveLength(1);
  });

  it("refuses duplicate chunk ids, empty or over-long documents and an empty query — before calling", async () => {
    const { reranker: r, calls } = reranker(() => results([0.5, 0.5]));
    expect(await kindOf(r.rerank({ query: "q", topN: 2, candidates: [candidate(0), candidate(1, { chunkId: "c0" })] }))).toBe("invalid_request");
    expect(await kindOf(r.rerank({ query: "q", topN: 2, candidates: [candidate(0), candidate(1, { text: "", headingPath: [] })] }))).toBe("invalid_request");
    expect(await kindOf(r.rerank({ query: "q", topN: 2, candidates: [candidate(0), candidate(1, { text: "x".repeat(9000) })] }))).toBe("input_too_large");
    expect(await kindOf(r.rerank({ query: " ", topN: 2, candidates: [candidate(0), candidate(1)] }))).toBe("invalid_request");
    expect(calls).toHaveLength(0);
    expect(await r.rerank({ query: "q", topN: 5, candidates: [] })).toEqual({ ranked: [], reranker: { id: COHERE_RERANK_35_ID, version: "euc1-v1" } });
  });

  it("refuses a transport outside eu-central-1 at construction (in-region only)", () => {
    expect(() => createCohereRerank35({ transport: fakeBedrock(() => ({}), "eu-west-1").transport })).toThrow(/in-region i eu-central-1/);
  });

  it("only reorders: it never adds a candidate it was not given", async () => {
    const { reranker: r } = reranker(() => results([0.3, 0.6, 0.1]));
    const candidates = [candidate(0), candidate(1), candidate(2)];
    const output = await r.rerank({ query: "q", topN: 10, candidates });
    expect(output.ranked.map((entry) => entry.chunkId).sort()).toEqual(candidates.map((entry) => entry.chunkId).sort());
  });
});

// ---------------------------------------------------------------------------------------------

describe("timeouts and retries", () => {
  it("times out each attempt, aborts the call and gives up after maxAttempts", async () => {
    const signals: AbortSignal[] = [];
    const { embedder: e, calls } = embedder((call) => {
      signals.push(call.signal);
      return new Promise(() => {});
    });
    const error = await e.embed(["x"], { inputType: "query" }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ kind: "timeout", attempts: 3, retryable: true });
    expect(calls).toHaveLength(3);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("retries a retryable error and succeeds", async () => {
    const { embedder: e, calls } = embedder((call, i) => {
      if (i < 2) throw classifyBedrockError(awsError("ThrottlingException", 429));
      return embedResponse(call.body.texts as string[]);
    });
    expect(await e.embed(["x"], { inputType: "query" })).toHaveLength(1);
    expect(calls).toHaveLength(3);
  });

  it.each(["ValidationException", "AccessDeniedException", "ResourceNotFoundException", "CredentialsProviderError", "ModelErrorException"])("does not retry %s", async (name) => {
    const { embedder: e, calls } = embedder(() => {
      throw classifyBedrockError(awsError(name, 400));
    });
    expect(await kindOf(e.embed(["x"], { inputType: "query" }))).not.toBe("ok");
    expect(calls).toHaveLength(1);
  });

  it("classifies Bedrock and network errors", () => {
    const cases: [unknown, string][] = [
      [awsError("ThrottlingException", 429), "throttled"],
      [awsError("ServiceQuotaExceededException", 429), "throttled"],
      [awsError("ServiceUnavailableException", 503), "unavailable"],
      [awsError("InternalServerException", 500), "unavailable"],
      [awsError("ModelNotReadyException", 429), "unavailable"],
      [awsError("ModelTimeoutException", 408), "timeout"],
      [awsError("AbortError"), "timeout"],
      [awsError("ValidationException", 400), "invalid_request"],
      [awsError("AccessDeniedException", 403), "access_denied"],
      [awsError("ResourceNotFoundException", 404), "model_not_found"],
      [awsError("CredentialsProviderError"), "credentials"],
      [awsError("ExpiredTokenException", 403), "credentials"],
      [Object.assign(new Error("reset"), { code: "ECONNRESET" }), "unavailable"],
      [awsError("SomethingNew", 502), "unavailable"],
      [awsError("SomethingNew", 429), "throttled"],
      [awsError("SomethingNew", 400), "invalid_response"],
      ["not even an error", "invalid_response"],
    ];
    for (const [error, kind] of cases) expect(classifyBedrockError(error).kind, String((error as Error).name ?? error)).toBe(kind);
    // The provider's message may echo input; it is never kept.
    expect(classifyBedrockError(Object.assign(new Error("Kunden Jens Hansen …"), { name: "ValidationException" })).message).not.toMatch(/Jens/);
  });

  it("backs off exponentially with full jitter, capped", () => {
    const policy = { ...EMBED_RETRY_POLICY, baseDelayMs: 100, maxDelayMs: 1000 };
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

describe("fail-closed: no fallback, and no production evidence from 8B-I2 alone", () => {
  const bedrockRow = embeddingModelRow(EMBED_V4_EU_1024_DESCRIPTOR);

  it("the application registry does not construct the production providers (they are not wired in)", () => {
    for (const environment of ["local", "test", "production"] as const) {
      expect(() => createEmbedder({ id: "m", ...bedrockRow }, environment)).toThrow(ProviderNotConfiguredError);
      expect(() => createReranker(COHERE_RERANK_35_ID, environment)).toThrow(RerankerNotConfiguredError);
    }
  });

  it("the catalogue refuses unknown models and rerankers — never the test embedder or none instead", () => {
    const { transport } = fakeBedrock(() => ({}));
    expect(() => createProductionEmbedder({ ...bedrockRow, dimensions: 1536 }, { bedrock: transport })).toThrow(ProviderError);
    expect(() => createProductionEmbedder({ ...bedrockRow, model_version: "x" }, { bedrock: transport })).toThrow(/ingen production-implementering/);
    expect(() => createProductionReranker("none", { bedrock: transport })).toThrow(ProviderError);
    expect(createProductionEmbedder(bedrockRow, { bedrock: transport }).descriptor).toBe(EMBED_V4_EU_1024_DESCRIPTOR);
    expect(PRODUCTION_EMBEDDING_DESCRIPTORS.every((descriptor) => descriptor.grade === "production")).toBe(true);
  });

  it("a provider failure fails retrieval: no set is issued and nothing falls back to development implementations", async () => {
    const db: KnowledgeRpcClient = { rpc: async () => ({ data: [] as SearchRow[], error: null }) };
    const { transport } = fakeBedrock(() => {
      throw classifyBedrockError(awsError("ServiceUnavailableException", 503));
    });
    const bedrockEmbedder = createProductionEmbedder(bedrockRow, { bedrock: transport, retryDeps: noSleep });
    const failing = runRetrieval({ query: "selvrisiko" }, { db, embedding: { embedder: bedrockEmbedder, modelId: "m" }, reranker: createProductionReranker(COHERE_RERANK_35_ID, { bedrock: transport }) });
    await expect(failing).rejects.toMatchObject({ name: "ProviderError", kind: "unavailable" });
  });

  it("a reranker failure fails retrieval", async () => {
    const row = { chunk_id: "c0", chunk_index: 0, kind: "prose", text: "Fiktiv tekst.", lead_in: null, heading: null, heading_path: [], section_number: null, page_start: 1, page_end: 1, char_start: 0, char_end: 13, overlap_chars: 0,
      version_id: "v", version_label: "1", language: "da", valid_from: "2025-01-01", valid_to: null, approved_at: null, superseded_by: null, document_id: "d", document_title: "Fiktiv", document_type: "terms",
      product_id: "p", product_name: "Fiktiv", source_type: "manual_upload", temporal_status: "current", vector_rank: null, vector_score: null, lexical_rank: 1, lexical_score: 1, lexical_terms: ["fiktiv"] } satisfies SearchRow;
    const db: KnowledgeRpcClient = { rpc: async (fn) => ({ data: fn === "search_chunks" ? [row] : [], error: null }) };
    const { transport } = fakeBedrock(() => ({ results: [] }));
    const failing = runRetrieval({ query: "fiktiv" }, { db, embedding: null, reranker: createProductionReranker(COHERE_RERANK_35_ID, { bedrock: transport, retryDeps: noSleep }) });
    await expect(failing).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("refuses static long-lived AWS keys in production; federated, temporary credentials are fine", () => {
    expect(() => assertNoStaticKeys({ AWS_ACCESS_KEY_ID: "AKIAFAKEFAKEFAKEFAKE" }, "production")).toThrow(/Statiske AWS-nøgler/);
    expect(() => assertNoStaticKeys({ AWS_ACCESS_KEY_ID: "ASIAFAKE", AWS_SESSION_TOKEN: "token" }, "production")).not.toThrow();
    expect(() => assertNoStaticKeys({}, "production")).not.toThrow();
    expect(() => assertNoStaticKeys({ AWS_ACCESS_KEY_ID: "AKIAFAKE" }, "local")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------------------------

describe("fingerprint material (docs/08b §10.1)", () => {
  const material = (overrides: Partial<Parameters<typeof retrievalFingerprintMaterial>[0]> = {}) =>
    retrievalFingerprintMaterial({
      embedding: EMBED_V4_EU_1024_DESCRIPTOR,
      reranker: RERANK_35_DESCRIPTOR,
      algorithmVersion: RETRIEVAL_ALGORITHM_VERSION,
      params: { ...DEFAULT_RETRIEVAL_CONFIG },
      chunkerVersions: ["structure/1"],
      ...overrides,
    });
  const base = retrievalFingerprint(material());

  it("changes with every result-relevant part", () => {
    const variants = [
      material({ embedding: { ...EMBED_V4_EU_1024_DESCRIPTOR, provider: "other" } }),
      material({ embedding: { ...EMBED_V4_EU_1024_DESCRIPTOR, model: "cohere.embed-v4:1" } }),
      material({ embedding: { ...EMBED_V4_EU_1024_DESCRIPTOR, modelVersion: "eu-1024-v2" } }),
      material({ embedding: { ...EMBED_V4_EU_1024_DESCRIPTOR, dimensions: 1536 } }),
      material({ embedding: { ...EMBED_V4_EU_1024_DESCRIPTOR, settings: { ...EMBED_V4_EU_1024_DESCRIPTOR.settings, truncate: "END" } } }),
      material({ embedding: { ...EMBED_V4_EU_1024_DESCRIPTOR, processing: { kind: "in_region", region: "eu-central-1" } } }),
      material({ embedding: TEST_EMBEDDER_DESCRIPTOR }),
      material({ embedding: null }),
      material({ reranker: NONE_RERANKER_DESCRIPTOR }),
      material({ reranker: { ...RERANK_35_DESCRIPTOR, settings: { ...RERANK_35_DESCRIPTOR.settings, topN: 10 } } }),
      material({ reranker: { ...RERANK_35_DESCRIPTOR, version: "euc1-v2" } }),
      material({ algorithmVersion: "hybrid-rrf-2" }),
      material({ params: { ...DEFAULT_RETRIEVAL_CONFIG, minScore: 0.2 } }),
      material({ chunkerVersions: ["structure/2"] }),
    ];
    const fingerprints = variants.map(retrievalFingerprint);
    for (const fingerprint of fingerprints) expect(fingerprint).not.toBe(base);
    expect(new Set(fingerprints).size).toBe(fingerprints.length);
  });

  it("is stable when only runtime details change: timeouts, retries, transport, limits or chunker order", () => {
    const one = createCohereEmbedV4({ transport: fakeBedrock(() => ({})).transport, retry: fast });
    const two = createCohereEmbedV4({ transport: fakeBedrock(() => ({}), "eu-central-1").transport, retry: { ...EMBED_RETRY_POLICY, attemptTimeoutMs: 1 } });
    expect(retrievalFingerprint(material({ embedding: one.descriptor }))).toBe(base);
    expect(retrievalFingerprint(material({ embedding: two.descriptor }))).toBe(base);
    expect(retrievalFingerprint(material({ embedding: { ...EMBED_V4_EU_1024_DESCRIPTOR, limits: { maxTextsPerRequest: 10, maxCharsPerText: 10, maxCharsPerRequest: 10 } } }))).toBe(base);
    expect(retrievalFingerprint(material({ chunkerVersions: ["b", "a", "a"] }))).toBe(retrievalFingerprint(material({ chunkerVersions: ["a", "b"] })));
    expect(canonicalJson(material())).not.toMatch(/attemptTimeoutMs|maxAttempts|maxTextsPerRequest/);
  });
});
