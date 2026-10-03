import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 8B-I2.5 — architecture guardrails for the external-AI data boundary. They make it hard to add
 * a way out of the platform that does not pass the central egress policy:
 *
 *   * Only allowlisted transports may use a network client or an AI/cloud SDK, and each of them
 *     must call assertTransmittable before sending.
 *   * Every adapter that invokes a transport must authorize through authorizeEgress first.
 *   * The policy reads no configuration, database, environment or provider descriptor.
 *   * The classification constructors can only be used where their provenance is true.
 *
 * Adding a new provider or transport therefore means editing the allowlists below — a change a
 * reviewer sees.
 */

const REPO = path.resolve(__dirname, "../..");

function files(dir: string, filter: (file: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return ["node_modules", "reports", ".next"].includes(entry.name) ? [] : files(full, filter);
    return filter(full) ? [full] : [];
  });
}

const code = (name: string) => /\.(ts|tsx|mts|mjs|js)$/.test(name);
const rel = (file: string) => path.relative(REPO, file).split(path.sep).join("/");
const read = (file: string) => fs.readFileSync(file, "utf8");

/** Application, worker and evaluation code — not tests. */
const sources = [
  ...files(path.join(REPO, "src"), code).filter((file) => !rel(file).startsWith("src/tests/")),
  ...files(path.join(REPO, "workers"), code),
  ...files(path.join(REPO, "evals"), code),
].map((file) => ({ file: rel(file), text: read(file) }));

/** Anything that can reach an external AI provider over the network. */
const NETWORK = [
  /from ["']@aws-sdk\//,
  /from ["']@anthropic-ai\//,
  /from ["']openai["'/]/,
  /from ["']cohere-ai["'/]/,
  /from ["']@google\//,
  /from ["']@mistralai\//,
  /from ["']@azure\//,
  /from ["'](node:)?https?["']/,
  /from ["'](node:)?(net|tls|http2)["']/,
  /from ["']undici["']/,
  /from ["']axios["']/,
  /\bfetch\s*\(/,
  /\bnew\s+WebSocket\s*\(/,
  /\bXMLHttpRequest\b/,
  /require\(["'](@aws-sdk|openai|@anthropic-ai|https?|undici|axios)/,
];

/** The ONLY modules allowed to talk to an external AI provider. Each must call assertTransmittable. */
const ALLOWED_TRANSPORTS = ["src/lib/knowledge/providers/bedrock/sdk-transport.ts"];

describe("external transports: only allowlisted, and only behind the egress check", () => {
  it("no module outside the allowlist uses a network client or an AI/cloud SDK", () => {
    const offenders = sources.filter(({ file, text }) => !ALLOWED_TRANSPORTS.includes(file) && NETWORK.some((pattern) => pattern.test(text))).map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("every allowlisted transport checks the authorization before any network I/O", () => {
    for (const file of ALLOWED_TRANSPORTS) {
      const text = read(path.join(REPO, file));
      expect(text, file).toMatch(/import \{ assertTransmittable \} from ["'][^"']*egress\/policy\.ts["']/);
      const check = text.indexOf("assertTransmittable(call.egress");
      const send = text.indexOf("client.send(");
      expect(check, file).toBeGreaterThan(-1);
      expect(send, file).toBeGreaterThan(check);
    }
  });

  it("the transport contract requires an authorization on every invocation", () => {
    const transport = read(path.join(REPO, "src/lib/knowledge/providers/bedrock/transport.ts"));
    expect(transport).toMatch(/egress: AuthorizedEgress;/);
  });

  it("the only AI/cloud SDK dependency is the Bedrock runtime client", () => {
    const pkg = JSON.parse(read(path.join(REPO, "package.json")));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter((name) => /^(@aws-sdk\/|@anthropic-ai\/|openai$|cohere-ai$|@google\/|@mistralai\/|@azure\/|undici$|axios$)/.test(name))).toEqual(["@aws-sdk/client-bedrock-runtime"]);
  });
});

describe("adapters authorize before they invoke", () => {
  it("every module that invokes a provider transport calls authorizeEgress first", () => {
    const invokers = sources.filter(({ text }) => /\.transport\.invoke\(|\btransport\.invoke\(/.test(text));
    expect(invokers.map(({ file }) => file).sort()).toEqual([
      "src/lib/knowledge/providers/bedrock/cohere-embed-v4.ts",
      "src/lib/knowledge/providers/bedrock/cohere-rerank-3-5.ts",
    ]);
    for (const { file, text } of invokers) {
      const authorize = text.indexOf("authorizeEgress(");
      expect(authorize, file).toBeGreaterThan(-1);
      expect(text.indexOf("transport.invoke("), file).toBeGreaterThan(authorize);
      // The body is built from the AUTHORIZED texts, never from the caller's input.
      expect(text, file).toMatch(/egress\.texts/);
    }
  });

  it("invokeModel authorizes every part for an external model before generate()", () => {
    const invoke = read(path.join(REPO, "src/lib/ai/core/invoke.ts"));
    const authorize = invoke.indexOf("authorizeEgress(");
    expect(authorize).toBeGreaterThan(-1);
    expect(invoke.indexOf("model.generate(input, egress)")).toBeGreaterThan(authorize);
    // The only unauthorized generate() is the development (in-process) branch.
    expect(invoke).toMatch(/if \(developmentModel\) return model\.generate\(input\);/);
    const generators = sources.filter(({ text }) => /\.generate\(/.test(text)).map(({ file }) => file);
    expect(generators).toEqual(["src/lib/ai/core/invoke.ts"]);
  });
});

describe("the policy cannot be configured", () => {
  it("reads no environment, database, setting or provider descriptor", () => {
    for (const file of ["src/lib/egress/policy.ts", "src/lib/egress/classification.ts"]) {
      const text = read(path.join(REPO, file)).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(text, file).not.toMatch(/process\.env|supabase|\.rpc\(|descriptor|settings|IPA_|import\(/);
    }
  });

  it("has no switch, parameter or flag that turns the check off", () => {
    const policy = read(path.join(REPO, "src/lib/egress/policy.ts")).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(policy).not.toMatch(/bypass|skip|disable|override|allowCustomer|force|unsafe/i);
  });
});

describe("classification constructors are used only where their provenance is true", () => {
  const callers = (pattern: RegExp) => sources.filter(({ text }) => pattern.test(text)).map(({ file }) => file).sort();

  it("synthetic text only in the evaluation engine (and tests)", () => {
    expect(callers(/egress\/synthetic/).filter((file) => !file.startsWith("evals/"))).toEqual([]);
    expect(callers(/\bmakeSyntheticInternal\b/)).toEqual(["src/lib/egress/classification.ts", "src/lib/egress/synthetic.ts"]);
  });

  it("knowledge text only from the retrieval layer, the worker and the gateway's evidence parts", () => {
    expect(callers(/\bknowledgeText\(/)).toEqual([
      "src/lib/ai/core/gateway-core.ts",
      "src/lib/egress/classification.ts",
      "src/lib/knowledge/retrieval-core.ts",
    ]);
    // The worker classifies chunks of Knowledge Engine document versions (passed as a function).
    expect(read(path.join(REPO, "workers/ingestion/pipeline.ts"))).toMatch(/inputs\.map\(knowledgeText\)/);
    expect(callers(/\bknowledgeText\b/)).toEqual([
      "src/lib/ai/core/gateway-core.ts",
      "src/lib/egress/classification.ts",
      "src/lib/knowledge/retrieval-core.ts",
      "workers/ingestion/pipeline.ts",
    ]);
  });

  it("user text only from the gateway and the Admin retrieval tool — and the tool never claims redaction", () => {
    expect(callers(/\buserText\(/)).toEqual(["src/lib/ai/core/gateway-core.ts", "src/lib/egress/classification.ts", "src/lib/knowledge/admin-actions.ts"]);
    expect(read(path.join(REPO, "src/lib/knowledge/admin-actions.ts"))).toMatch(/userText\([^)]*\{ caseBound: false, redacted: false \}\)/);
  });

  it("the gateway marks case-bound text from the case reference, not from a parameter", () => {
    const gateway = read(path.join(REPO, "src/lib/ai/core/gateway-core.ts"));
    expect(gateway).toMatch(/userText\(question, \{ caseBound: caseId !== null, redacted: true \}\)/);
    expect(gateway).toMatch(/userText\(label, \{ caseBound: caseId !== null, redacted: true \}\)/);
  });

  it("the production providers are still not wired into the application registry", () => {
    const registry = read(path.join(REPO, "src/lib/knowledge/core/registry.ts"));
    expect(registry).not.toMatch(/from ["'][^"']*providers\//);
    expect(registry).not.toMatch(/createProduction|createCohere/);
  });
});
