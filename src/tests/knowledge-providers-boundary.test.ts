import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";
import { processingGateFor } from "../../workers/ingestion/gate.ts";

import { userText } from "@/lib/egress/classification";
import { embeddingInput } from "@/lib/knowledge/core/embedding";
import { retrievalFingerprint, retrievalFingerprintMaterial } from "@/lib/knowledge/core/provider";
import { DEFAULT_RETRIEVAL_CONFIG, RETRIEVAL_ALGORITHM_VERSION, runRetrieval, type KnowledgeRpcClient, type SearchRow } from "@/lib/knowledge/retrieval-core";
import { EMBED_V4_EU_1024_DESCRIPTOR } from "@/lib/knowledge/providers/bedrock/cohere-embed-v4";
import { COHERE_RERANK_35_ID, RERANK_35_DESCRIPTOR } from "@/lib/knowledge/providers/bedrock/cohere-rerank-3-5";
import { createProductionEmbedder, createProductionReranker, embeddingModelRow } from "@/lib/knowledge/providers/catalog";

import { configurationFingerprint } from "../../evals/engine/checksum.ts";
import { createFixtureRetrieval, fixtureUuid } from "../../evals/engine/fixture-retrieval.ts";
import { loadInputs } from "../../evals/engine/loader.ts";
import { runEvaluation } from "../../evals/engine/runner.ts";
import { validateDeclaredConfiguration } from "../../evals/engine/schema.ts";
import { processJob, type ClaimedJob, type IntegrityRow, type WorkerDb } from "../../workers/ingestion/pipeline.ts";
import { embedResponse, fakeBedrock, fakeVector, noSleep, type FakeCall } from "./fixtures/bedrock-fake";

/**
 * 8B-I2 — datagrænsen mod Bedrock, credentials og bundle, databasens vektormodel og
 * eval-integrationen. Ingen test kræver en AWS-konto; alt går gennem en falsk transport.
 */

const REPO = path.resolve(__dirname, "../..");
const bedrockRow = embeddingModelRow(EMBED_V4_EU_1024_DESCRIPTOR);

/** Answers embed and rerank calls; rerank scores fall with candidate position. */
function bedrockHandler(call: FakeCall): unknown {
  if (Array.isArray(call.body.texts)) return embedResponse(call.body.texts as string[]);
  const documents = call.body.documents as string[];
  return { results: documents.map((_, index) => ({ index, relevance_score: 1 / (index + 1) })) };
}

const ROW: SearchRow = {
  chunk_id: "chunk-1", chunk_index: 0, kind: "prose", text: "Selvrisikoen er 10.000 kr. for hver skade.", lead_in: "Gælder alle skader:", heading: "§ 3 Selvrisiko",
  heading_path: ["§ 3 Selvrisiko"], section_number: "3", page_start: 2, page_end: 2, char_start: 0, char_end: 42, overlap_chars: 0,
  version_id: "version-secret-id", version_label: "2", language: "da", valid_from: "2025-07-01", valid_to: null, approved_at: "2026-01-01T00:00:00Z",
  superseded_by: null, document_id: "document-secret-id", document_title: "Fortrolig titel (fiktiv)", document_type: "terms", product_id: "product-secret-id",
  product_name: "Fiktivt produkt", source_type: "manual_upload", temporal_status: "current", vector_rank: 1, vector_score: 0.9, lexical_rank: 1, lexical_score: 1, lexical_terms: ["selvrisiko"],
};


const TEST_GATE = processingGateFor("test");
describe("the data boundary: exactly what is sent to Bedrock", () => {
  async function retrieve(query: string) {
    const fake = fakeBedrock(bedrockHandler);
    const db: KnowledgeRpcClient = { rpc: async (fn) => ({ data: fn === "search_chunks" ? [ROW] : [], error: null }) };
    const runtime = { bedrock: fake.transport, retryDeps: noSleep };
    await runRetrieval({ query: userText(query, { caseBound: false, redacted: true }) }, { db, embedding: { embedder: createProductionEmbedder(bedrockRow, runtime), modelId: "m" }, reranker: createProductionReranker(COHERE_RERANK_35_ID, runtime) });
    return fake.calls;
  }

  it("query embedding: only the normalized query text, as a query", async () => {
    const calls = await retrieve("  Hvad er selvrisikoen?  ");
    expect(calls[0]!.body).toEqual({ texts: ["Hvad er selvrisikoen?"], input_type: "search_query", embedding_types: ["float"], output_dimension: 1024, truncate: "NONE" });
  });

  it("reranking: only the query and each candidate's heading chain and text", async () => {
    const calls = await retrieve("Hvad er selvrisikoen?");
    expect(calls[1]!.body).toEqual({ query: "Hvad er selvrisikoen?", documents: ["§ 3 Selvrisiko\nSelvrisikoen er 10.000 kr. for hver skade."], top_n: 1, api_version: 2 });
  });

  it("no ids, titles, products, sources or access data ever leave the platform", async () => {
    const sent = JSON.stringify(await retrieve("Hvad er selvrisikoen?"));
    for (const secret of ["version-secret-id", "document-secret-id", "product-secret-id", "chunk-1", "Fortrolig titel", "Fiktivt produkt", "manual_upload"]) {
      expect(sent).not.toContain(secret);
    }
  });

  it("document embedding in the worker: only the chunk's embedding input, as documents", async () => {
    const fake = fakeBedrock(bedrockHandler);
    const chunks = [
      { chunk_id: "c1", text: "Forsikringen dækker ikke forurening.", lead_in: null, heading_path: ["§ 4"], language: "da" },
      { chunk_id: "c2", text: "• skade forvoldt med forsæt", lead_in: "Forsikringen dækker ikke:", heading_path: ["§ 4"], language: "da" },
    ];
    const stored: { chunk_id: string; embedding: number[] }[] = [];
    const db = {
      claim: async () => null,
      embeddingModels: async () => [{ id: "m-bedrock", ...bedrockRow, status: "candidate" }],
      chunksToEmbed: async () => chunks.filter((chunk) => !stored.some((row) => row.chunk_id === chunk.chunk_id)),
      storeEmbeddings: async (_job: string, _model: string, rows: { chunk_id: string; embedding: number[] }[]) => {
        stored.push(...rows);
        return rows.length;
      },
      verifyIndex: async (): Promise<IntegrityRow[]> => [{ model_id: "m-bedrock", model: "x", status: "candidate", chunks: 2, embeddings: stored.length, wrong_dimensions: 0 }],
      heartbeat: async () => {},
      checkpoint: async () => {},
      storePages: async () => {},
      storeChunks: async () => 0,
      complete: async () => {},
      fail: async () => "failed" as const,
    } as unknown as WorkerDb;
    const job: ClaimedJob = { job_id: "j", version_id: "v", kind: "reembed", attempts: 1, max_attempts: 3, step_state: {}, storage_path: "a/b.pdf", checksum_sha256: "0".repeat(64) };
    const outcome = await processJob(job, { db, originals: { download: async () => new Uint8Array() }, log: () => {}, gate: TEST_GATE, embedderFor: (model) => createProductionEmbedder(model, { bedrock: fake.transport, retryDeps: noSleep }) });
    expect(outcome).toBe("succeeded");
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.body.input_type).toBe("search_document");
    expect(fake.calls[0]!.body.texts).toEqual(chunks.map((chunk) => embeddingInput(chunk)));
    expect(stored.every((row) => row.embedding.length === 1024)).toBe(true);
  });

  it("free text from customer cases cannot reach a provider in 8B-I2: no application module can construct one", () => {
    const sources = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === "tests" ? [] : sources(full);
        return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
      });
    const app = sources(path.join(REPO, "src")).filter((file) => !file.includes(`${path.sep}providers${path.sep}`));
    const importers = app.filter((file) => /from ["'][^"']*knowledge\/providers\//.test(fs.readFileSync(file, "utf8")));
    // The AI gateway, retrieval and every page use the registry, which does not know Bedrock.
    expect(importers.map((file) => path.relative(REPO, file))).toEqual([]);
  });
});

describe("credentials, secrets and the browser bundle", () => {
  const providerFiles = fs.readdirSync(path.join(REPO, "src/lib/knowledge/providers"), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));

  it("contains no AWS keys or secrets in code", () => {
    for (const file of providerFiles) {
      const text = fs.readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/AKIA[0-9A-Z]{16}|aws_secret_access_key|secretAccessKey|accessKeyId\s*:/);
    }
  });

  it("only the SDK transport imports the AWS SDK, and no client component reaches the providers", () => {
    const sdkImporters = providerFiles.filter((file) => /from ["']@aws-sdk\//.test(fs.readFileSync(file, "utf8"))).map((file) => path.basename(file));
    expect(sdkImporters).toEqual(["sdk-transport.ts"]);
    for (const file of providerFiles) expect(fs.readFileSync(file, "utf8"), file).not.toMatch(/^["']use client["']/m);
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
    expect(Object.keys(pkg.dependencies).filter((name: string) => name.startsWith("@aws-sdk/"))).toEqual(["@aws-sdk/client-bedrock-runtime"]);
  });
});

describe("the SDK transport (mocked SDK, no network)", () => {
  it("sends JSON to InvokeModel with the abort signal and the SDK's own retries switched off", async () => {
    vi.resetModules();
    const sent: { input: Record<string, unknown>; options: unknown }[] = [];
    const configs: unknown[] = [];
    vi.doMock("@aws-sdk/client-bedrock-runtime", () => ({
      BedrockRuntimeClient: class {
        constructor(config: unknown) {
          configs.push(config);
        }
        async send(command: { input: Record<string, unknown> }, options: unknown) {
          sent.push({ input: command.input, options });
          return { contentType: "application/json", body: new TextEncoder().encode(JSON.stringify(embedResponse(["x"]))) };
        }
      },
      InvokeModelCommand: class {
        input: Record<string, unknown>;
        constructor(input: Record<string, unknown>) {
          this.input = input;
        }
      },
    }));
    const { createSdkBedrockTransport } = await import("@/lib/knowledge/providers/bedrock/sdk-transport");
    const { authorizeEgress: authorize } = await import("@/lib/egress/policy");
    const { knowledgeText: knowledge } = await import("@/lib/egress/classification");
    const transport = createSdkBedrockTransport({ region: "eu-central-1", env: { IPA_RUNTIME_ENV: "test" } });
    expect(configs).toHaveLength(0); // No client (and no credentials) until the first call.
    const signal = new AbortController().signal;
    const egress = authorize({ provider: "aws-bedrock", operation: "embed_document", module: "test", parts: [{ role: "document", content: knowledge("x") }] }, { log: () => {} });
    const parsed = await transport.invoke({ modelId: "eu.cohere.embed-v4:0", egress, body: { texts: ["x"] }, signal });
    expect(parsed).toEqual(embedResponse(["x"]));
    expect(configs).toEqual([{ region: "eu-central-1", maxAttempts: 1 }]);
    expect(sent[0]!.input).toMatchObject({ modelId: "eu.cohere.embed-v4:0", contentType: "application/json", accept: "application/json" });
    expect(new TextDecoder().decode(sent[0]!.input.body as Uint8Array)).toBe('{"texts":["x"]}');
    expect(sent[0]!.options).toEqual({ abortSignal: signal });
    vi.doUnmock("@aws-sdk/client-bedrock-runtime");
  });

  it("classifies SDK errors and refuses non-JSON responses", async () => {
    vi.resetModules();
    let mode: "throw" | "text" = "throw";
    vi.doMock("@aws-sdk/client-bedrock-runtime", () => ({
      BedrockRuntimeClient: class {
        async send() {
          if (mode === "throw") throw Object.assign(new Error("x"), { name: "ThrottlingException", $metadata: { httpStatusCode: 429 } });
          return { contentType: "text/plain", body: new TextEncoder().encode("hej") };
        }
      },
      InvokeModelCommand: class {},
    }));
    const { createSdkBedrockTransport } = await import("@/lib/knowledge/providers/bedrock/sdk-transport");
    const { authorizeEgress: authorize } = await import("@/lib/egress/policy");
    const { knowledgeText: knowledge } = await import("@/lib/egress/classification");
    const transport = createSdkBedrockTransport({ region: "eu-central-1", env: { IPA_RUNTIME_ENV: "test" } });
    const egress = authorize({ provider: "aws-bedrock", operation: "embed_document", module: "test", parts: [{ role: "document", content: knowledge("x") }] }, { log: () => {} });
    const call = () => transport.invoke({ modelId: "m", egress, body: {}, signal: new AbortController().signal });
    await expect(call()).rejects.toMatchObject({ kind: "throttled", retryable: true });
    mode = "text";
    await expect(call()).rejects.toMatchObject({ kind: "invalid_response" });
    vi.doUnmock("@aws-sdk/client-bedrock-runtime");
  });

  it("refuses static keys in production at construction", async () => {
    const { createSdkBedrockTransport } = await import("@/lib/knowledge/providers/bedrock/sdk-transport");
    expect(() => createSdkBedrockTransport({ region: "eu-central-1", env: { IPA_RUNTIME_ENV: "production", AWS_ACCESS_KEY_ID: "AKIAFAKE" } })).toThrow(/Statiske AWS-nøgler/);
  });
});

describe("the vector model in the database supports 1024 dimensions without a migration", () => {
  const migration = fs.readFileSync(path.join(REPO, "supabase/migrations/20261001000400_knowledge_embeddings.sql"), "utf8");

  it("stores vectors without a fixed dimension, checked per model, up to 2000", () => {
    expect(migration).toMatch(/embedding extensions\.vector not null/);
    expect(migration).toMatch(/dimensions int not null check \(dimensions between 1 and 2000\)/);
    expect(migration).toMatch(/vector_dims\(new\.embedding\) <> v_model\.dimensions/);
    expect(EMBED_V4_EU_1024_DESCRIPTOR.dimensions).toBeLessThanOrEqual(2000);
  });

  it("the model row fits the table's constraints and is unique per configured dimension", () => {
    expect(bedrockRow).toEqual({ provider: "aws-bedrock", model_name: "cohere.embed-v4:0", model_version: "eu-1024-v1", dimensions: 1024 });
    expect(bedrockRow.provider).toMatch(/^[a-z0-9][a-z0-9_-]*$/);
    expect(bedrockRow.model_name.length).toBeLessThanOrEqual(200);
    expect(bedrockRow.model_version.length).toBeLessThanOrEqual(100);
  });
});

describe("evaluation integration (8B-I1 recognizes 8B-I2's configuration)", () => {
  it("the candidate configuration file is exactly the providers' fingerprint material", () => {
    const declared = validateDeclaredConfiguration(
      JSON.parse(fs.readFileSync(path.join(REPO, "evals/retrieval/configurations/bedrock-embed-v4-eu-1024-rerank-3-5.json"), "utf8")),
    );
    const material = retrievalFingerprintMaterial({
      embedding: EMBED_V4_EU_1024_DESCRIPTOR,
      reranker: RERANK_35_DESCRIPTOR,
      algorithmVersion: RETRIEVAL_ALGORITHM_VERSION,
      params: { ...DEFAULT_RETRIEVAL_CONFIG },
      chunkerVersions: ["fixture-sections/1"],
    });
    expect(declared.configuration).toEqual(material);
    expect(configurationFingerprint(declared.configuration)).toBe(retrievalFingerprint(material));
  });

  it("the runner evaluates the Bedrock adapters (fake transport): production implementations, but the report is never production-eligible", async () => {
    const inputs = loadInputs({ set: "example-v1", gates: "gates-v1", configuration: "bedrock-embed-v4-eu-1024-rerank-3-5" });
    const fake = fakeBedrock(bedrockHandler);
    const runtime = { bedrock: fake.transport, retryDeps: noSleep };
    const retrieval = createFixtureRetrieval({
      manifest: inputs.set.manifest,
      fixtures: inputs.fixtures,
      embedder: createProductionEmbedder({ ...bedrockRow }, runtime),
      reranker: createProductionReranker(COHERE_RERANK_35_ID, runtime),
      baselineReranker: createProductionReranker(COHERE_RERANK_35_ID, runtime),
      now: () => new Date("2026-10-03T10:00:00Z"),
    });
    const report = await runEvaluation({ set: inputs.set, gates: inputs.gates, declared: { label: inputs.declared.label, configuration: inputs.declared.configuration }, retrieval, runId: "r" });
    expect(report.configuration.matches).toBe(true);
    // The evidence comes from production implementations: no grade or provider breach in H6.
    expect(report.failures.filter((failure) => failure.gate === "H6")).toEqual([]);
    // But the fixture is not the evaluation environment (H7), and nothing can be activated.
    expect(report.hardGates.find((gate) => gate.id === "H7")!.status).toBe("fail");
    expect(report.verdict).toBe("fail");
    expect(report.production.eligible).toBe(false);
    expect(fake.calls.some((call) => call.body.input_type === "search_document")).toBe(true);
    expect(fake.calls.some((call) => call.body.input_type === "search_query")).toBe(true);
    expect(fakeVector("a")).toHaveLength(1024);
    expect(fixtureUuid("x")).toMatch(/^[0-9a-f-]{36}$/);
  });
});
