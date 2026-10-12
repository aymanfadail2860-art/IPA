import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ProviderError } from "@/lib/knowledge/core/provider";
import { knowledgeText } from "@/lib/egress/classification";
import { credentialPlanFor, DEFAULT_VERCEL_OIDC_AUDIENCE } from "@/lib/knowledge/providers/aws-credentials";
import { EMBED_V4_EU_1024_DESCRIPTOR, EU_SOURCE_REGION } from "@/lib/knowledge/providers/bedrock/cohere-embed-v4";
import { createSdkBedrockTransport } from "@/lib/knowledge/providers/bedrock/sdk-transport";
import { CONTAINER_CREDENTIAL_SOURCES } from "@/lib/knowledge/providers/credentials-container";
import { ENVIRONMENT_CREDENTIAL_SOURCES } from "@/lib/knowledge/providers/credentials-environment";
import { VERCEL_CREDENTIAL_SOURCES } from "@/lib/knowledge/providers/credentials-vercel";
import { embeddingModelRow } from "@/lib/knowledge/providers/catalog";
import { createRuntimeEmbedder, providerRuntimeFor } from "@/lib/knowledge/providers/runtime";

import { embedResponse, noSleep } from "./fixtures/bedrock-fake";

/**
 * 8B-I8 C1 — the application's AWS credentials on Vercel: Vercel OIDC → AWS STS
 * (AssumeRoleWithWebIdentity) → short-lived credentials. Never a static key, a credentials file
 * or an implicit fallback in production; the role ARN and the audience are configuration only.
 * The Vercel package is replaced here so the test sees exactly what the app hands it.
 */

const vercel = vi.hoisted(() => ({ inits: [] as Record<string, unknown>[], providers: [] as unknown[] }));

vi.mock("@vercel/oidc-aws-credentials-provider", () => ({
  awsCredentialsProvider: (init: Record<string, unknown>) => {
    vercel.inits.push(init);
    const provider = async () => ({ accessKeyId: "ASIA-FROM-STS", secretAccessKey: "from-sts", sessionToken: "from-sts" });
    vercel.providers.push(provider);
    return provider;
  },
}));

const ROLE = "arn:aws:iam::000000000000:role/ipa-application";
const VERCEL_PRODUCTION = { VERCEL: "1", VERCEL_ENV: "production", IPA_AWS_ROLE_ARN: ROLE };

afterEach(() => {
  vercel.inits.length = 0;
  vercel.providers.length = 0;
});

describe("Vercel production: the OIDC federation is the only credential path", () => {
  it("uses the Vercel OIDC provider with the configured role, the AWS audience and STS in the EU region", () => {
    const runtime = providerRuntimeFor("application", VERCEL_PRODUCTION, VERCEL_CREDENTIAL_SOURCES);
    expect(runtime.credentialSource).toBe("vercel-oidc");
    expect(vercel.inits).toEqual([{ roleArn: ROLE, audience: DEFAULT_VERCEL_OIDC_AUDIENCE, roleSessionName: "ipa-application", clientConfig: { region: EU_SOURCE_REGION } }]);
    expect(DEFAULT_VERCEL_OIDC_AUDIENCE).toBe("sts.amazonaws.com");
  });

  it("takes another audience only from configuration, when the trust policy needs it", () => {
    credentialPlanFor("application", { ...VERCEL_PRODUCTION, IPA_AWS_OIDC_AUDIENCE: "https://oidc.vercel.com/ipa" }, VERCEL_CREDENTIAL_SOURCES);
    expect(vercel.inits[0]).toMatchObject({ audience: "https://oidc.vercel.com/ipa" });
  });

  it("the Bedrock client gets exactly that provider", async () => {
    const plan = credentialPlanFor("application", VERCEL_PRODUCTION, VERCEL_CREDENTIAL_SOURCES);
    expect(plan.credentials).toBe(vercel.providers[0]);
    let config: Record<string, unknown> | null = null;
    const transport = createSdkBedrockTransport({
      region: EU_SOURCE_REGION,
      credentials: plan.credentials,
      env: VERCEL_PRODUCTION,
      createClient: (given) =>
        ((config = given as Record<string, unknown>), { send: async () => ({ contentType: "application/json", body: new TextEncoder().encode(JSON.stringify(embedResponse(["x"]))) }) }) as never,
    });
    const model = { id: "c1000000-0000-4000-8000-000000000001", ...embeddingModelRow(EMBED_V4_EU_1024_DESCRIPTOR) };
    const embedder = createRuntimeEmbedder(model, () => ({ bedrock: transport, retryDeps: noSleep }), "production");
    await embedder.embed([knowledgeText("Selvrisiko")], { inputType: "document" });
    expect(config).not.toBeNull();
    expect(config!.credentials).toBe(vercel.providers[0]);
    expect(config!.region).toBe(EU_SOURCE_REGION);
  });

  it("constructing the path makes no network call and reads no token", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    providerRuntimeFor("application", VERCEL_PRODUCTION, VERCEL_CREDENTIAL_SOURCES);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("fail closed", () => {
  const refuses = (env: Record<string, string | undefined>, pattern: RegExp) => {
    expect(() => credentialPlanFor("application", env, VERCEL_CREDENTIAL_SOURCES)).toThrow(ProviderError);
    expect(() => credentialPlanFor("application", env, VERCEL_CREDENTIAL_SOURCES)).toThrow(pattern);
    expect(vercel.inits).toEqual([]);
  };

  it("without the role ARN, or with something that is not an IAM role ARN", () => {
    refuses({ VERCEL: "1" }, /IPA_AWS_ROLE_ARN/);
    refuses({ VERCEL: "1", IPA_AWS_ROLE_ARN: "ipa-application" }, /IPA_AWS_ROLE_ARN/);
    refuses({ VERCEL: "1", IPA_AWS_ROLE_ARN: "arn:aws:iam::000000000000:user/someone" }, /IPA_AWS_ROLE_ARN/);
  });

  it("in production outside Vercel (no OIDC token source)", () => {
    refuses({ IPA_AWS_ROLE_ARN: ROLE }, /uden for Vercel/);
    refuses({ IPA_RUNTIME_ENV: "staging", IPA_AWS_ROLE_ARN: ROLE }, /uden for Vercel/);
  });

  it("when the runtime does not ship the Vercel source", () => {
    expect(() => credentialPlanFor("application", VERCEL_PRODUCTION, {})).toThrow(/OIDC-provideren/);
    expect(() => credentialPlanFor("application", VERCEL_PRODUCTION, CONTAINER_CREDENTIAL_SOURCES)).toThrow(ProviderError);
    expect(() => credentialPlanFor("application", VERCEL_PRODUCTION, ENVIRONMENT_CREDENTIAL_SOURCES)).toThrow(ProviderError);
  });

  it("static AWS credentials are never a fallback on Vercel — not long-lived, not temporary, not a profile or a file", () => {
    for (const extra of [
      { AWS_ACCESS_KEY_ID: "AKIAFICTIONAL", AWS_SECRET_ACCESS_KEY: "fictional" },
      { AWS_ACCESS_KEY_ID: "ASIAFICTIONAL", AWS_SECRET_ACCESS_KEY: "fictional", AWS_SESSION_TOKEN: "fictional" },
      { AWS_SECRET_ACCESS_KEY: "fictional" },
      { AWS_PROFILE: "default" },
      { AWS_SHARED_CREDENTIALS_FILE: "/var/task/.aws/credentials" },
      { AWS_CONFIG_FILE: "/var/task/.aws/config" },
      { AWS_WEB_IDENTITY_TOKEN_FILE: "/tmp/token" },
      { AWS_ROLE_ARN: ROLE },
    ]) {
      refuses({ ...VERCEL_PRODUCTION, ...extra }, /må ikke være sat/);
    }
  });

  it("errors name variables, never values", () => {
    let message = "";
    try {
      credentialPlanFor("application", { ...VERCEL_PRODUCTION, AWS_SECRET_ACCESS_KEY: "do-not-log-me" }, VERCEL_CREDENTIAL_SOURCES);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("AWS_SECRET_ACCESS_KEY");
    expect(message).not.toContain("do-not-log-me");
  });

  it("the app's retrieval becomes unavailable instead of falling back", async () => {
    const { assessRetrieval } = await import("@/lib/knowledge/retrieval-availability");
    const { fixtureContext } = await import("./fixtures/production-config");
    const { parseRetrievalContext } = await import("@/lib/knowledge/core/retrieval-context");
    const context = parseRetrievalContext(fixtureContext());
    const availability = assessRetrieval({
      demo: false,
      databaseConfigured: true,
      activeModel: context?.activeModel,
      context,
      environment: "production",
      runtime: () => providerRuntimeFor("application", { ...VERCEL_PRODUCTION, AWS_ACCESS_KEY_ID: "AKIAFICTIONAL", AWS_SECRET_ACCESS_KEY: "fictional" }, VERCEL_CREDENTIAL_SOURCES),
    });
    expect(availability).toMatchObject({ state: "unavailable" });
    expect(JSON.stringify(availability)).not.toContain("fictional");
  });
});

describe("the other runtimes are unaffected", () => {
  it("local and test keep the development chain — no OIDC, no role needed", () => {
    for (const environment of ["local", "test"]) {
      expect(credentialPlanFor("application", { IPA_RUNTIME_ENV: environment }, VERCEL_CREDENTIAL_SOURCES)).toEqual({ source: "development-default-chain", credentials: undefined });
    }
    expect(vercel.inits).toEqual([]);
  });

  it("the ECS worker keeps its task role, also when Vercel variables are present", () => {
    const ecs = { AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/credentials/fictional" };
    expect(credentialPlanFor("worker", ecs, CONTAINER_CREDENTIAL_SOURCES).source).toBe("ecs-task-role");
    expect(credentialPlanFor("worker", { ...ecs, ...VERCEL_PRODUCTION }, CONTAINER_CREDENTIAL_SOURCES).source).toBe("ecs-task-role");
    expect(() => credentialPlanFor("worker", ecs, VERCEL_CREDENTIAL_SOURCES)).toThrow(ProviderError);
    expect(vercel.inits).toEqual([]);
  });

  it("the evaluation job keeps its GitHub OIDC credentials", () => {
    const ci = { GITHUB_ACTIONS: "true", AWS_ACCESS_KEY_ID: "ASIAFICTIONAL", AWS_SECRET_ACCESS_KEY: "fictional", AWS_SESSION_TOKEN: "fictional" };
    expect(credentialPlanFor("evaluation", ci, ENVIRONMENT_CREDENTIAL_SOURCES).source).toBe("github-oidc");
    // A long-lived key without a session token is not a federated credential.
    expect(() => credentialPlanFor("evaluation", { ...ci, AWS_SESSION_TOKEN: "" }, ENVIRONMENT_CREDENTIAL_SOURCES)).toThrow(/AWS_SESSION_TOKEN/);
    expect(() => credentialPlanFor("evaluation", { ...ci, GITHUB_ACTIONS: undefined }, ENVIRONMENT_CREDENTIAL_SOURCES)).toThrow(ProviderError);
  });
});

describe("credentials stay on the server", () => {
  const root = path.resolve(__dirname, "../..");
  const SRC = path.join(root, "src");

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

  it("no client component reaches the provider, credential or Bedrock code", () => {
    const { files, packages } = clientGraph();
    expect(files.size).toBeGreaterThan(20);
    const reached = [...files].map((file) => path.relative(root, file).split(path.sep).join("/"));
    expect(reached.filter((file) => /lib\/knowledge\/(providers|core\/registry|retrieval)|lib\/egress\//.test(file))).toEqual([]);
    expect([...packages].filter((name) => /^@aws-sdk\/|^@smithy\/|^@vercel\/oidc/.test(name))).toEqual([]);
  });

  it("only the app's provider wiring imports the Vercel credential source, and only on the server", () => {
    const users = fs
      .readdirSync(SRC, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.parentPath.includes(`${path.sep}tests`))
      .map((entry) => path.join(entry.parentPath, entry.name))
      .filter((file) => /from ["'][^"']*credentials-vercel(\.ts)?["']/.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(root, file).split(path.sep).join("/"));
    expect(users).toEqual(["src/lib/knowledge/providers/configured.ts"]);
    // No NEXT_PUBLIC_ variable can carry AWS configuration into the browser.
    const text = ["aws-credentials.ts", "credentials-vercel.ts", "configured.ts"].map((file) => fs.readFileSync(path.join(SRC, "lib/knowledge/providers", file), "utf8")).join("\n");
    expect(text).not.toMatch(/NEXT_PUBLIC_[A-Z_]*AWS|NEXT_PUBLIC_IPA_AWS/);
  });

  it("the credential plan never logs", () => {
    const text = fs.readFileSync(path.join(SRC, "lib/knowledge/providers/aws-credentials.ts"), "utf8");
    expect(text).not.toMatch(/console\.|log\(/);
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
    try {
      credentialPlanFor("application", VERCEL_PRODUCTION, VERCEL_CREDENTIAL_SOURCES);
      try {
        credentialPlanFor("application", { ...VERCEL_PRODUCTION, AWS_SECRET_ACCESS_KEY: "do-not-log-me" }, VERCEL_CREDENTIAL_SOURCES);
      } catch {
        // refused, as above
      }
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe("the application role (deploy/application/iam)", () => {
  const read = (file: string) => JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../deploy/application/iam", file), "utf8")) as { Statement: Record<string, unknown>[] };

  it("only the Vercel project's production environment can assume it, with the AWS audience", () => {
    const [statement, ...rest] = read("vercel-oidc-trust-policy.json").Statement;
    expect(rest).toEqual([]);
    expect(statement).toMatchObject({ Effect: "Allow", Action: "sts:AssumeRoleWithWebIdentity" });
    expect(statement!.Condition).toEqual({
      StringEquals: {
        "oidc.vercel.com/${VERCEL_TEAM_SLUG}:aud": DEFAULT_VERCEL_OIDC_AUDIENCE,
        "oidc.vercel.com/${VERCEL_TEAM_SLUG}:sub": "owner:${VERCEL_TEAM_SLUG}:project:${VERCEL_PROJECT_NAME}:environment:production",
      },
    });
  });

  it("can only invoke the catalogue's Embed v4 profile and Rerank 3.5 in the EU source region", async () => {
    const { COHERE_EMBED_V4_EU_PROFILE } = await import("@/lib/knowledge/providers/bedrock/cohere-embed-v4");
    const { COHERE_RERANK_35_MODEL } = await import("@/lib/knowledge/providers/bedrock/cohere-rerank-3-5");
    const statements = read("bedrock-policy.json").Statement;
    expect(statements.map((statement) => statement.Action)).toEqual(["bedrock:InvokeModel", "bedrock:InvokeModel", "bedrock:InvokeModel"]);
    expect(statements.map((statement) => statement.Resource)).toEqual([
      `arn:aws:bedrock:${EU_SOURCE_REGION}:\${AWS_ACCOUNT_ID}:inference-profile/${COHERE_EMBED_V4_EU_PROFILE}`,
      "arn:aws:bedrock:eu-*::foundation-model/cohere.embed-v4:0",
      `arn:aws:bedrock:${EU_SOURCE_REGION}::foundation-model/${COHERE_RERANK_35_MODEL}`,
    ]);
    expect(JSON.stringify(statements)).not.toMatch(/"\*"|bedrock:\*|secretsmanager|s3:|InvokeModelWithResponseStream/);
  });
});
