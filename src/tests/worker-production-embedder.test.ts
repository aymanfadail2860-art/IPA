import { describe, expect, it } from "vitest";

import { embeddingInput, type EmbeddingModelSpec } from "@/lib/knowledge/core/embedding";
import { ProviderError } from "@/lib/knowledge/core/provider";
import { TEST_EMBEDDER } from "@/lib/knowledge/core/test-embedder";
import { credentialPlanFor, type AwsCredentials } from "@/lib/knowledge/providers/aws-credentials";
import type { BedrockInvocation, BedrockTransport } from "@/lib/knowledge/providers/bedrock/transport";
import { COHERE_EMBED_V4_EU_PROFILE, EMBED_V4_EU_1024_DESCRIPTOR, EU_SOURCE_REGION } from "@/lib/knowledge/providers/bedrock/cohere-embed-v4";
import { createSdkBedrockTransport } from "@/lib/knowledge/providers/bedrock/sdk-transport";
import { embeddingModelRow, PRODUCTION_EMBEDDING_DESCRIPTORS } from "@/lib/knowledge/providers/catalog";
import { providersForContext } from "@/lib/knowledge/providers/configured";
import { CONTAINER_CREDENTIAL_SOURCES } from "@/lib/knowledge/providers/credentials-container";
import { ENVIRONMENT_CREDENTIAL_SOURCES } from "@/lib/knowledge/providers/credentials-environment";
import { createRuntimeEmbedder, providerRuntimeFor } from "@/lib/knowledge/providers/runtime";

import { loadConfig } from "../../workers/ingestion/config.ts";
import { devFakeBedrockRuntime, devFakeBedrockTransport } from "../../workers/ingestion/dev-fake-bedrock.ts";
import { processJob, type ClaimedJob, type IntegrityRow, type WorkerDb } from "../../workers/ingestion/pipeline.ts";
import { checkEmbeddingModels, workerEmbedderFactory, workerProviderRuntime } from "../../workers/ingestion/providers.ts";

import { embedResponse, fakeBedrock, noSleep } from "./fixtures/bedrock-fake";
import { releasedGate, staticOriginals } from "./fixtures/worker-fakes";

/**
 * 8B-I8 C7 — the ingestion worker embeds with the production provider the registry authorizes:
 * model row → production catalogue → the runtime's provider transport (ECS task role) →
 * embedder. No fallback to the test embedder, another model or a development provider; no
 * static key. All without an AWS account: the transport is fake.
 */

const EMBED_V4: EmbeddingModelSpec = { id: "c7000000-0000-4000-8000-000000000001", ...embeddingModelRow(EMBED_V4_EU_1024_DESCRIPTOR) };
const ECS_ENV = { AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/credentials/fictional", AWS_REGION: "eu-central-1" };
const handler = (call: { body: Record<string, unknown> }) => embedResponse(call.body.texts as string[]);

function recordingTransport() {
  const fake = fakeBedrock(handler);
  const egress: BedrockInvocation["egress"][] = [];
  const transport: BedrockTransport = {
    region: fake.transport.region,
    invoke: (call) => {
      egress.push(call.egress);
      return fake.transport.invoke(call);
    },
  };
  return { transport, calls: fake.calls, egress };
}

const productionFactory = (transport: BedrockTransport) => workerEmbedderFactory({ environment: "production", runtime: () => ({ bedrock: transport, retryDeps: noSleep }) });

describe("the production worker embeds with Cohere Embed v4 (fake Bedrock transport)", () => {
  it("starts: the registered Embed v4 model resolves to the production adapter", () => {
    const { transport } = recordingTransport();
    const embedderFor = productionFactory(transport);
    expect(checkEmbeddingModels([EMBED_V4], embedderFor)).toEqual([]);
    const embedder = embedderFor(EMBED_V4);
    expect(embedder.grade).toBe("production");
    expect(embedder.descriptor).toEqual(EMBED_V4_EU_1024_DESCRIPTOR);
  });

  it("embeds a document version: document input type, 1024 dimensions, authorized as knowledge", async () => {
    const recorded = recordingTransport();
    const chunks = [
      { chunk_id: "c1", text: "Forsikringen dækker ikke forurening.", lead_in: null, heading_path: ["§ 4"], language: "da" },
      { chunk_id: "c2", text: "• skade forvoldt med forsæt", lead_in: "Forsikringen dækker ikke:", heading_path: ["§ 4"], language: "da" },
    ];
    const stored: { chunk_id: string; embedding: number[] }[] = [];
    const db = {
      embeddingModels: async () => [{ ...EMBED_V4, status: "candidate" }],
      chunksToEmbed: async () => chunks.filter((chunk) => !stored.some((row) => row.chunk_id === chunk.chunk_id)),
      storeEmbeddings: async (_job: string, _model: string, rows: { chunk_id: string; embedding: number[] }[]) => void stored.push(...rows),
      verifyIndex: async (): Promise<IntegrityRow[]> => [{ model_id: EMBED_V4.id, model: "x", status: "candidate", chunks: 2, embeddings: stored.length, wrong_dimensions: 0 }],
      heartbeat: async () => {},
      checkpoint: async () => {},
      complete: async () => {},
      fail: async () => "failed" as const,
    } as unknown as WorkerDb;
    const job: ClaimedJob = { job_id: "j", version_id: "v", kind: "reembed", attempts: 1, max_attempts: 3, step_state: {}, storage_path: "a/b.pdf", checksum_sha256: "0".repeat(64) };
    const outcome = await processJob(job, { db, originals: staticOriginals(), log: () => {}, gate: releasedGate(), embedderFor: productionFactory(recorded.transport) });
    expect(outcome).toBe("succeeded");
    expect(recorded.calls).toHaveLength(1);
    expect(recorded.calls[0]!.body).toMatchObject({ input_type: "search_document", output_dimension: 1024, texts: chunks.map((chunk) => embeddingInput(chunk)) });
    expect(stored.map((row) => row.embedding.length)).toEqual([1024, 1024]);
    // The egress authorization of exactly these texts as document embedding (knowledge, 8B-I2.5).
    expect(recorded.egress[0]).toMatchObject({ provider: "aws-bedrock", operation: "embed_document", texts: chunks.map((chunk) => embeddingInput(chunk)) });
  });
});

describe("credentials: the ECS task role, nothing else", () => {
  it("the production worker runtime uses the container credential provider", () => {
    const seen: string[] = [];
    const plan = credentialPlanFor("worker", ECS_ENV, { containerTaskRole: () => (seen.push("container"), (async () => ({ accessKeyId: "x", secretAccessKey: "y" })) as AwsCredentials) });
    expect(plan.source).toBe("ecs-task-role");
    expect(seen).toEqual(["container"]);
    expect(workerProviderRuntime(ECS_ENV).credentialSource).toBe("ecs-task-role");
  });

  it("the Bedrock client gets exactly that provider", async () => {
    const plan = credentialPlanFor("worker", ECS_ENV, CONTAINER_CREDENTIAL_SOURCES);
    let config: Record<string, unknown> | null = null;
    const transport = createSdkBedrockTransport({ region: "eu-central-1", credentials: plan.credentials, env: ECS_ENV, createClient: (given) => ((config = given as Record<string, unknown>), { send: async () => ({ contentType: "application/json", body: new TextEncoder().encode(JSON.stringify(embedResponse(["x"]))) }) }) as never });
    const embedder = createRuntimeEmbedder(EMBED_V4, () => ({ bedrock: transport, retryDeps: noSleep }), "production");
    await embedder.embed([], { inputType: "document" }).catch(() => undefined);
    const { knowledgeText } = await import("@/lib/egress/classification");
    await embedder.embed([knowledgeText("Selvrisiko")], { inputType: "document" });
    expect(config!.credentials).toBe(plan.credentials);
    expect(config!.region).toBe("eu-central-1");
  });

  it("static AWS credentials never become a fallback — not even temporary ones, not a profile or a file", () => {
    for (const extra of [
      { AWS_ACCESS_KEY_ID: "AKIAFICTIONAL", AWS_SECRET_ACCESS_KEY: "fictional" },
      { AWS_ACCESS_KEY_ID: "ASIAFICTIONAL", AWS_SECRET_ACCESS_KEY: "fictional", AWS_SESSION_TOKEN: "fictional" },
      { AWS_PROFILE: "default" },
      { AWS_SHARED_CREDENTIALS_FILE: "/root/.aws/credentials" },
      { AWS_WEB_IDENTITY_TOKEN_FILE: "/tmp/token", AWS_ROLE_ARN: "arn:aws:iam::000000000000:role/x" },
    ]) {
      expect(() => credentialPlanFor("worker", { ...ECS_ENV, ...extra }, CONTAINER_CREDENTIAL_SOURCES), JSON.stringify(Object.keys(extra))).toThrow(ProviderError);
    }
  });

  it("without the container credential endpoint, or without the container source, the worker fails closed", () => {
    expect(() => credentialPlanFor("worker", { AWS_REGION: "eu-central-1" }, CONTAINER_CREDENTIAL_SOURCES)).toThrow(/credential-endpoint/);
    expect(() => credentialPlanFor("worker", ECS_ENV, {})).toThrow(ProviderError);
    // The worker never ships another runtime's source: it cannot borrow the CI job's environment path.
    expect(() => credentialPlanFor("worker", ECS_ENV, ENVIRONMENT_CREDENTIAL_SOURCES)).toThrow(ProviderError);
  });

  it("errors name variables, never values", () => {
    try {
      credentialPlanFor("worker", { ...ECS_ENV, AWS_SECRET_ACCESS_KEY: "do-not-log-me" }, CONTAINER_CREDENTIAL_SOURCES);
    } catch (error) {
      expect((error as Error).message).toContain("AWS_SECRET_ACCESS_KEY");
      expect((error as Error).message).not.toContain("do-not-log-me");
    }
  });

  it("local/test keep the development path and the fake transport", async () => {
    expect(credentialPlanFor("worker", { IPA_RUNTIME_ENV: "test" }, {})).toEqual({ source: "development-default-chain", credentials: undefined });
    const embedder = createRuntimeEmbedder(EMBED_V4, () => devFakeBedrockRuntime("test"), "test");
    const { knowledgeText } = await import("@/lib/egress/classification");
    const [vector] = await embedder.embed([knowledgeText("Erhvervsansvar dækker skade på ting")], { inputType: "document" });
    expect(vector).toHaveLength(1024);
    expect(() => devFakeBedrockRuntime("production")).toThrow();
  });
});

describe("fail closed: no fallback", () => {
  const check = (model: EmbeddingModelSpec, embedderFor = productionFactory(recordingTransport().transport)) => checkEmbeddingModels([model], embedderFor);

  it("a resolved embedder whose dimension is not the registered one stops the start", () => {
    const { transport } = recordingTransport();
    const real = productionFactory(transport)(EMBED_V4);
    const wrong = { ...real, descriptor: { ...real.descriptor, dimensions: 1536 } };
    expect(checkEmbeddingModels([EMBED_V4], () => wrong)).toEqual([{ model: "aws-bedrock:cohere.embed-v4:0@eu-1024-v1", code: "dimensions" }]);
  });

  it("an unknown provider stops the start", () => {
    expect(check({ id: "m", provider: "acme", model_name: "x", model_version: "1", dimensions: 1024 })).toEqual([{ model: "acme:x@1", code: "ProviderNotConfiguredError" }]);
  });

  it("an unknown model, version or dimension of a production provider stops the start", () => {
    for (const model of [
      { ...EMBED_V4, model_version: "eu-1024-v2" },
      { ...EMBED_V4, dimensions: 1536 },
      { ...EMBED_V4, model_name: "cohere.embed-multilingual-v3" },
    ]) {
      expect(check(model)[0]?.code, JSON.stringify(model)).toBe("configuration");
    }
  });

  it("a development-only model is refused in production", () => {
    expect(check({ id: "t", ...TEST_EMBEDDER })[0]?.code).toBe("GradeNotAllowedError");
  });

  it("a runtime that cannot be constructed stops the start", () => {
    const broken = workerEmbedderFactory({ environment: "production", runtime: () => workerProviderRuntime({}) });
    expect(checkEmbeddingModels([EMBED_V4], broken)).toEqual([{ model: "aws-bedrock:cohere.embed-v4:0@eu-1024-v1", code: "credentials" }]);
  });

  it("never the test embedder instead — not even in local/test", () => {
    for (const environment of ["production", "test"] as const) {
      expect(() => createRuntimeEmbedder({ ...EMBED_V4, model_version: "unknown" }, () => ({ bedrock: devFakeBedrockTransport() }), environment)).toThrow(ProviderError);
    }
  });

  it("the development fake transport cannot be configured in production", () => {
    const problems = (() => {
      try {
        loadConfig({ IPA_RUNTIME_ENV: "production", IPA_DEV_FAKE_BEDROCK: "1", IPA_WORKER_DB_HOST: "x" });
        return [];
      } catch (error) {
        return (error as { problems?: string[] }).problems ?? [];
      }
    })();
    expect(problems.some((problem) => problem.includes("IPA_DEV_FAKE_BEDROCK"))).toBe(true);
    expect(loadConfig({ IPA_RUNTIME_ENV: "test", IPA_DEV_FAKE_BEDROCK: "1", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "x", IPA_HEALTH_CHECK_INTERVAL_MS: "0" }).providers).toBe("development-fake");
  });
});

describe("guardrail: every production embedding model is constructible in every runtime that needs it", () => {
  const productionEnvs = {
    application: { VERCEL: "1", IPA_AWS_ROLE_ARN: "arn:aws:iam::000000000000:role/ipa-application" },
    worker: ECS_ENV,
    evaluation: { GITHUB_ACTIONS: "true", AWS_ACCESS_KEY_ID: "ASIAFICTIONAL", AWS_SECRET_ACCESS_KEY: "fictional", AWS_SESSION_TOKEN: "fictional" },
  };

  for (const descriptor of PRODUCTION_EMBEDDING_DESCRIPTORS) {
    const model: EmbeddingModelSpec = { id: `m-${descriptor.modelVersion}`, ...embeddingModelRow(descriptor) };

    it(`${descriptor.provider}:${descriptor.model}@${descriptor.modelVersion}: app, worker and evaluation`, async () => {
      const { transport } = recordingTransport();
      // App/server retrieval: through the configuration in service.
      const app = providersForContext(
        { configuration: { embeddingModelId: model.id, rerankerId: "aws-bedrock:cohere.rerank-v3-5:0" }, activeModel: model } as never,
        () => ({ bedrock: transport, retryDeps: noSleep }),
        "production",
      );
      expect(app.embedding?.embedder.descriptor).toEqual(descriptor);
      // Ingestion worker.
      expect(productionFactory(transport)(model).descriptor).toEqual(descriptor);
      // Evaluation runtime.
      expect(createRuntimeEmbedder(model, () => ({ bedrock: transport }), "production").descriptor).toEqual(descriptor);
      // And each runtime's provider transport can be constructed with its own credential path (no network).
      const { VERCEL_CREDENTIAL_SOURCES } = await import("@/lib/knowledge/providers/credentials-vercel");
      expect(providerRuntimeFor("application", productionEnvs.application, VERCEL_CREDENTIAL_SOURCES).credentialSource).toBe("vercel-oidc");
      expect(workerProviderRuntime(productionEnvs.worker).credentialSource).toBe("ecs-task-role");
      expect(providerRuntimeFor("evaluation", productionEnvs.evaluation, ENVIRONMENT_CREDENTIAL_SOURCES).credentialSource).toBe("github-oidc");
    });
  }
});

describe("the worker's task role covers exactly the embedding model it invokes", () => {
  it("bedrock:InvokeModel on the adapter's EU inference profile in its source region — the scanner has no task role", async () => {
    const { readFileSync } = await import("node:fs");
    const policy = JSON.parse(readFileSync("deploy/ingestion-worker/iam/task-role-policy.json", "utf8")) as { Statement: { Action: string; Resource: string }[] };
    const profile = `arn:aws:bedrock:${EU_SOURCE_REGION}:\${AWS_ACCOUNT_ID}:inference-profile/${COHERE_EMBED_V4_EU_PROFILE}`;
    expect(policy.Statement.map((statement) => [statement.Action, statement.Resource])).toEqual([
      ["bedrock:InvokeModel", profile],
      ["bedrock:InvokeModel", `arn:aws:bedrock:eu-*::foundation-model/${COHERE_EMBED_V4_EU_PROFILE.replace(/^eu\./, "")}`],
    ]);
    const scanner = JSON.parse(readFileSync("deploy/clamav/task-definition.json", "utf8")) as Record<string, unknown>;
    expect(scanner).not.toHaveProperty("taskRoleArn");
  });
});
