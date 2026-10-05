import { describe, expect, it } from "vitest";
import { processingGateFor } from "../../workers/ingestion/gate.ts";

import { knowledgeText } from "@/lib/egress/classification";
import { embeddingInput, inputHash } from "@/lib/knowledge/core/embedding";
import { assertGradeAllowed, combinedGrade, runtimeEnv } from "@/lib/knowledge/core/grade";
import { createEmbedder } from "@/lib/knowledge/core/registry";
import { createTestEmbedder, hashEmbedding, TEST_EMBEDDER } from "@/lib/knowledge/core/test-embedder";

import { processJob, type ClaimedJob, type IntegrityRow, type WorkerDb } from "../../workers/ingestion/pipeline.ts";

/** Fase 7, trin 4 — embeddings, test-embedder og den fail-closed grad (docs/07 §7, §9.1). */

const testModel = { id: "m-test", ...TEST_EMBEDDER };

function cosine(a: number[], b: number[]): number {
  return a.reduce((sum, value, i) => sum + value * b[i]!, 0);
}


const TEST_GATE = processingGateFor("test");
describe("runtime environment and grade (docs/07 §9.1)", () => {
  it("treats a missing or unknown IPA_RUNTIME_ENV as production (fail-closed)", () => {
    expect(runtimeEnv(undefined)).toBe("production");
    expect(runtimeEnv("")).toBe("production");
    expect(runtimeEnv("staging")).toBe("production");
    expect(runtimeEnv("LOCAL")).toBe("production");
    expect(runtimeEnv("local")).toBe("local");
    expect(runtimeEnv("test")).toBe("test");
  });

  it("refuses development-grade implementations outside local/test", () => {
    expect(() => assertGradeAllowed("x", "development", "production")).toThrow(/udviklingsimplementering/);
    expect(() => assertGradeAllowed("x", "development", "test")).not.toThrow();
    expect(() => assertGradeAllowed("x", "production", "production")).not.toThrow();
  });

  it("combines grades: production only if every part is production", () => {
    expect(combinedGrade("production", "production")).toBe("production");
    expect(combinedGrade("production", "development")).toBe("development");
  });
});

describe("embedder registry (docs/07 §7, §17.4)", () => {
  it("builds the test embedder only in local/test", () => {
    expect(createEmbedder(testModel, "test").grade).toBe("development");
    expect(createEmbedder(testModel, "local").id).toBe("test:test-hash-embedder@1");
    expect(() => createEmbedder(testModel, "production")).toThrow(/udviklingsimplementering/);
  });

  it("has no real provider yet — an unknown model fails loudly instead of silently", () => {
    expect(() =>
      createEmbedder({ id: "m2", provider: "someprovider", model_name: "x", model_version: "1", dimensions: 1024 }, "test"),
    ).toThrow(/Udbyderen er ikke valgt/);
  });

  it("matches the test model exactly — the same name with another dimension is not the test embedder", () => {
    expect(() => createEmbedder({ ...testModel, dimensions: 512 }, "test")).toThrow();
  });
});

describe("test embedder (development only)", () => {
  it("is deterministic, has the model's dimension and unit length", async () => {
    const embedder = createTestEmbedder();
    const [a, b] = await embedder.embed([knowledgeText("Forsikringen dækker ikke forurening."), knowledgeText("Forsikringen dækker ikke forurening.")], { inputType: "document" });
    expect(a).toEqual(b);
    expect(a).toHaveLength(256);
    expect(Math.abs(Math.sqrt(cosine(a!, a!)) - 1)).toBeLessThan(1e-3);
  });

  it("places texts sharing words closer than unrelated texts", () => {
    const query = hashEmbedding("gradvis forurening af jord", 256);
    const related = hashEmbedding("Forsikringen dækker ikke gradvis forurening af jord, luft eller vand.", 256);
    const unrelated = hashEmbedding("Skaden skal anmeldes hurtigst muligt til testselskabet.", 256);
    expect(cosine(query, related)).toBeGreaterThan(cosine(query, unrelated));
  });

  it("embeds the heading chain and lead-in together with the chunk text", () => {
    const input = embeddingInput({ text: "• fiktiv undtagelse 9", lead_in: "Forsikringen dækker ikke:", heading_path: ["§ 4 Undtagelser", "4.2 Andre"] });
    expect(input).toBe("§ 4 Undtagelser › 4.2 Andre\nForsikringen dækker ikke:\n• fiktiv undtagelse 9");
    expect(inputHash("a", input)).not.toBe(inputHash("b", input));
  });
});

describe("embedding and indexing in the worker pipeline (docs/07 §5.2 steps 8–9)", () => {
  const job: ClaimedJob = {
    job_id: "job",
    version_id: "version",
    kind: "reembed",
    attempts: 1,
    max_attempts: 3,
    step_state: {},
    storage_path: "a/b/original.pdf",
    checksum_sha256: "0".repeat(64),
  };
  const chunks = [
    { chunk_id: "c1", text: "Forsikringen dækker ikke forurening.", lead_in: null, heading_path: ["§ 4"], language: "da" },
    { chunk_id: "c2", text: "• skade forvoldt med forsæt", lead_in: "Forsikringen dækker ikke:", heading_path: ["§ 4"], language: "da" },
  ];

  function db(integrity: (stored: number) => IntegrityRow[]) {
    const stored: { chunk_id: string; embedding: number[]; input_hash: string }[] = [];
    const calls: string[] = [];
    const fake: WorkerDb = {
      claim: async () => null,
      embeddingModels: async () => [{ ...testModel, status: "active" }],
      chunksToEmbed: async () => chunks.filter((chunk) => !stored.some((row) => row.chunk_id === chunk.chunk_id)),
      storeEmbeddings: async (_job, _model, rows) => {
        stored.push(...rows);
        return rows.length;
      },
      verifyIndex: async () => integrity(stored.length),
      heartbeat: async () => {},
      checkpoint: async () => {},
      storePages: async () => {},
      storeChunks: async () => 0,
      complete: async () => void calls.push("complete"),
      issueStorageTicket: async () => ({ ticket: "0".repeat(64), expiresAt: new Date() }),
      forget: () => {},
      fail: async (_job, code, _message, retryable) => {
        calls.push(`fail:${code}:${retryable}`);
        return retryable ? "retry" : "failed";
      },
    };
    return { fake, stored, calls };
  }

  const complete = (stored: number): IntegrityRow[] => [
    { model_id: "m-test", model: "test:test-hash-embedder@1", status: "active", chunks: 2, embeddings: stored, wrong_dimensions: 0 },
  ];

  it("embeds every chunk with the model and an input hash, then verifies the index", async () => {
    const { fake, stored, calls } = db(complete);
    const outcome = await processJob(job, { db: fake, originals: { download: async () => new Uint8Array() }, log: () => {}, gate: TEST_GATE, embedderFor: (model) => createEmbedder(model, "test") });
    expect(outcome).toBe("succeeded");
    expect(stored).toHaveLength(2);
    expect(stored.every((row) => row.embedding.length === 256 && /^[0-9a-f]{64}$/.test(row.input_hash))).toBe(true);
    expect(calls).toEqual(["complete"]);
  });

  it("retries when the index is incomplete after embedding", async () => {
    const { fake, calls } = db(() => complete(1));
    const outcome = await processJob(job, { db: fake, originals: { download: async () => new Uint8Array() }, log: () => {}, gate: TEST_GATE, embedderFor: (model) => createEmbedder(model, "test") });
    expect(outcome).toBe("retry");
    expect(calls).toEqual(["fail:processing_error:true"]);
  });

  it("fails without retry when the test embedder would run in production", async () => {
    const { fake, calls } = db(complete);
    const outcome = await processJob(job, { db: fake, originals: { download: async () => new Uint8Array() }, log: () => {}, gate: TEST_GATE, embedderFor: (model) => createEmbedder(model, "production") });
    expect(outcome).toBe("failed");
    expect(calls).toEqual(["fail:embedding_unavailable:false"]);
  });
});
