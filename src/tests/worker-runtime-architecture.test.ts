import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseComposeYaml, type YamlValue } from "./fixtures/compose-yaml";

/**
 * 8B-I4 — static guardrails for the production worker runtime and its deployment
 * specification (docs/08b §21.5). They enforce, as far as a static check can:
 *
 *   * the production worker's code graph contains no service-role client and no Supabase SDK;
 *   * the production database adapter uses only the locked knowledge.worker_* API;
 *   * no credential is baked into the image, the build or the deployment files;
 *   * no external AI or cloud provider is reachable from the worker.
 *
 * Beta L2 (docs/beta.md §14): the ECS/Fargate task, service, security group and IAM files are
 * removed with AWS. Their vendor-neutral requirements — non-root, read-only, no capabilities, a
 * /tmp tmpfs only, no inbound traffic, the credential only from the operator's secret store, the
 * fixed scanner endpoint, a stop grace longer than the worker's — are checked against the import
 * specification deploy/import/compose.yaml instead.
 */

const root = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const json = (file: string) => JSON.parse(read(file)) as Record<string, unknown>;
const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
const DEPLOY = "deploy/ingestion-worker";

/**
 * Static imports reachable from an entry file (relative files followed, packages collected).
 * With `runtimeOnly`, type-only imports (erased by Node's type stripping) are not followed.
 */
function importGraph(entry: string, runtimeOnly = false): { files: Set<string>; packages: Set<string>; dynamic: { from: string; spec: string }[] } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const dynamic: { from: string; spec: string }[] = [];
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    const code = stripComments(read(file));
    for (const match of code.matchAll(/(?:^|\n)\s*((?:import|export)\s[^;]*?)from\s+"([^"]+)"/g)) {
      if (runtimeOnly && /^(?:import|export) type\s/.test(match[1]!)) continue;
      const spec = match[2]!;
      if (spec.startsWith(".")) visit(path.relative(root, path.resolve(root, path.dirname(file), spec)));
      else packages.add(spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]!);
    }
    for (const match of code.matchAll(/import\(\s*"([^"]+)"\s*\)/g)) dynamic.push({ from: file, spec: match[1]! });
  };
  visit(entry);
  return { files, packages, dynamic };
}

describe("production worker code (8B-I4)", () => {
  const graph = importGraph("workers/ingestion/main.ts");

  it("contains no service-role client, no Supabase SDK and no app-only code", () => {
    // Beta L2: no cloud or AI provider SDK and no credential provider — only the database client
    // and the PDF parser.
    expect([...graph.packages].filter((name) => !name.startsWith("node:")).sort()).toEqual(["pdfjs-dist", "postgres"]);
    expect(graph.files.has("workers/ingestion/dev-service-role.ts")).toBe(false);
    for (const file of graph.files) {
      expect(
        file.startsWith("workers/ingestion/") || file.startsWith("src/lib/egress/") || file.startsWith("src/lib/knowledge/core/") ||
          file.startsWith("src/lib/observability/"),
        file,
      ).toBe(true);
      // config.ts names the key only to refuse it in production (next test).
      if (file !== "workers/ingestion/config.ts") expect(read(file), file).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|service_role/);
    }
  });

  it("loads the development service-role adapter only behind the validated local/test configuration", () => {
    expect(graph.dynamic).toEqual([{ from: "workers/ingestion/main.ts", spec: "./dev-service-role.ts" }]);
    const main = stripComments(read("workers/ingestion/main.ts"));
    expect(main).toMatch(/if \(config\.db\.kind === "postgres"\) \{[\s\S]*?\} else \{[\s\S]*?await import\("\.\/dev-service-role\.ts"\)/);
    const config = stripComments(read("workers/ingestion/config.ts"));
    expect(config).toMatch(/if \(production && serviceKey\)/);
    expect(config).toMatch(/if \(!production && serviceKey && !env\.IPA_WORKER_DB_HOST\)/);
  });

  it("embeds only through the fail-closed registry, with the embedders checked before the job loop (8B-I8 C7; beta L2)", () => {
    const main = stripComments(read("workers/ingestion/main.ts"));
    expect(main).not.toMatch(/createEmbedder\(|createProductionEmbedder\(/);
    expect(main).toMatch(/const embedderProblems = checkEmbeddingModels\(models, embedderFor\);[\s\S]*process\.exit\(1\)[\s\S]*createWorkerRuntime\(config, \{[^\n]*\bembedderFor \}\)/);
    const providers = stripComments(read("workers/ingestion/providers.ts"));
    expect(providers).toMatch(/return \(model\) => createEmbedder\(model, options\.environment\);/);
    expect(providers).toMatch(/from "\.\.\/\.\.\/src\/lib\/knowledge\/core\/registry\.ts"/);
  });

  it("the database adapter calls only the locked knowledge.worker_* API — no tables, admin or ops functions", () => {
    const code = stripComments(read("workers/ingestion/db.ts"));
    const statements = [...code.matchAll(/sql(?:<[^`]*?>)?`([^`]*)`/g)].map((match) => match[1]!.replace(/\$\{[^}]*\}/g, "$").replace(/\s+/g, " ").trim());
    expect(statements).toHaveLength(16);
    const api = new Set<string>();
    for (const statement of statements) {
      const match = /^select (?:(?:\*|[a-z_, ()]+) from )?knowledge\.(worker_[a-z_]+)\([^;]*\)(?: as [a-z_]+)?$/.exec(statement);
      expect(match, statement).not.toBeNull();
      api.add(match![1]!);
      expect(statement, statement).not.toMatch(/\b(insert|update|delete|from knowledge\.(?!worker_)|ops\.|auth\.|storage\.)/i);
    }
    expect([...api].sort()).toEqual([
      "worker_checkpoint", "worker_chunks_to_embed", "worker_claim_job", "worker_complete_job", "worker_embedding_models", "worker_fail_job",
      "worker_heartbeat", "worker_issue_storage_ticket", "worker_record_security_verdict", "worker_security_clearance", "worker_security_scan_context",
      "worker_store_chunks", "worker_store_embeddings", "worker_store_pages", "worker_system_health", "worker_verify_index",
    ]);
    // No unsafe/raw SQL and no session state.
    expect(code).not.toMatch(/\.unsafe\(|\.begin\(|\.reserve\(|\blisten\(|set_config|SET (ROLE|SESSION)/i);
  });

  it("names no admin or ops function anywhere in the worker", () => {
    const files = readdirSync(path.join(root, "workers/ingestion"), { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
    expect(files.length).toBeGreaterThan(20);
    for (const entry of files) {
      const file = path.relative(root, path.join(entry.parentPath, entry.name));
      const code = stripComments(read(file));
      expect(code, file).not.toMatch(
        /ops\.ingestion_worker|approve_version|withdraw_version|activate_embedding_model|request_reembedding|redeem_worker_storage_ticket|confirm_worker_storage_operation|register_upload|request_security_rescan|security_block_reason|security_verdicts|security_development_scanners/,
      );
    }
  });

  it("the release gate is the database's answer — no switch, flag, environment variable or development bypass (8B-I5)", () => {
    const gate = stripComments(read("workers/ingestion/gate.ts"));
    expect(gate).not.toMatch(/process\.env|RuntimeEnv|local|development|open\b/);
    expect([...gate.matchAll(/^export function (\w+)/gm)].map((match) => match[1])).toEqual(["databaseSecurityGate"]);
    // Only an explicit true with a verdict and no reason passes.
    expect(gate).toMatch(/clearance\.cleared === true && clearance\.reason === null && typeof clearance\.verdict_id === "string"/);
    // The checksum is computed from the downloaded bytes, never taken from the job.
    expect(gate).toMatch(/createHash\("sha256"\)\.update\(bytes\)/);
    const main = stripComments(read("workers/ingestion/main.ts"));
    expect(main).toMatch(/const gate = databaseSecurityGate\(db\);/);
    expect(main).not.toMatch(/runStandby|processingGateFor|releasedGate/);
    for (const file of ["workers/ingestion/main.ts", "workers/ingestion/runtime.ts", "workers/ingestion/pipeline.ts"]) {
      expect(read(file), file).not.toMatch(/worker-fakes|releasedGate/);
    }
    const pipeline = stripComments(read("workers/ingestion/pipeline.ts"));
    // The gate is asked before the download and again with the bytes before the first parser call.
    const order = ["deps.gate.admit(job.job_id)", 'deps.originals.download(job, "download_original")', "deps.gate.inspect(", "extractPdf(bytes)"].map((needle) => pipeline.indexOf(needle));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("the security examination cannot reach the parser, the chunker or an embedder (8B-I5)", () => {
    for (const entry of ["workers/ingestion/scan-job.ts", "workers/ingestion/security/inspect-child.ts"]) {
      const scan = importGraph(entry, true);
      expect([...scan.packages].filter((name) => !name.startsWith("node:")), entry).toEqual([]);
      for (const file of scan.files) {
        expect(file, entry).not.toMatch(/^workers\/ingestion\/(extract|chunker|normalize|structure|pipeline|quality)\.ts$|^src\/lib\/knowledge\/core\/(embedding|registry)\.ts$/);
      }
      expect(scan.dynamic, entry).toEqual([]);
    }
    // Not vacuous: the scan job's graph holds the examination itself.
    expect([...importGraph("workers/ingestion/scan-job.ts", true).files]).toEqual(
      expect.arrayContaining(["workers/ingestion/security/scan.ts", "workers/ingestion/security/file-checks.ts", "workers/ingestion/originals.ts", "workers/ingestion/job-control.ts"]),
    );
    for (const file of readdirSync(path.join(root, "workers/ingestion/security"))) {
      expect(read(`workers/ingestion/security/${file}`), file).not.toMatch(/pdfjs-dist|getDocument\(/);
    }
    // The inspection child gets no environment and writes no file.
    const inspector = stripComments(read("workers/ingestion/security/inspector.ts"));
    expect(inspector).toMatch(/env: \{\} as NodeJS\.ProcessEnv/);
    expect(inspector).toMatch(/--max-old-space-size=/);
    expect(inspector).toMatch(/child\.kill\("SIGKILL"\)/);
    for (const file of readdirSync(path.join(root, "workers/ingestion/security"))) {
      expect(stripComments(read(`workers/ingestion/security/${file}`)), file).not.toMatch(/writeFile|createWriteStream|mkdtemp|tmpdir|openSync/);
    }
  });

  it("the development fixture scanner exists only for local/test and is chosen only by configuration (8B-I5)", () => {
    const scanner = stripComments(read("workers/ingestion/security/scanner.ts"));
    expect(scanner).toMatch(/if \(env !== "local" && env !== "test"\) throw/);
    const config = stripComments(read("workers/ingestion/config.ts"));
    // Production: only the fixed service endpoint; the development scanner only off production.
    expect(config).toMatch(/export const PRODUCTION_SCANNER = Object\.freeze\(\{ host: "clamav", port: 3310 \}\);/);
    expect(config).toMatch(/if \(production\) \{[\s\S]*?scanner = \{ kind: "clamd", host: PRODUCTION_SCANNER\.host, port: PRODUCTION_SCANNER\.port \};[\s\S]*?\} else if \(env\.IPA_CLAMD_HOST\) \{[\s\S]*?\} else \{\s*scanner = \{ kind: "development-fixture" \};/);
  });
});

describe("production image (8B-I4)", () => {
  const dockerfile = read(`${DEPLOY}/Dockerfile`);
  const instructions = stripComments(dockerfile.replace(/^#.*$/gm, ""));

  it("builds without arguments or secrets and runs as an unprivileged user", () => {
    expect(instructions).not.toMatch(/^\s*ARG\b/m);
    expect(instructions).not.toMatch(/--mount=type=secret|PASSWORD|SECRET|SERVICE_ROLE|ACCESS_KEY|TOKEN/i);
    expect(instructions).toMatch(/^USER node$/m);
    expect(instructions.indexOf("USER node")).toBeGreaterThan(instructions.lastIndexOf("RUN "));
    expect(instructions).toMatch(/^ENTRYPOINT \["node", "workers\/ingestion\/main\.ts"\]$/m);
    expect(instructions).toMatch(/^STOPSIGNAL SIGTERM$/m);
  });

  it("copies only the worker, its shared core and its runtime dependencies — never .env or the dev adapter", () => {
    const copies = [...instructions.matchAll(/^COPY (?:--from=deps )?(\S+)/gm)].map((match) => match[1]);
    expect(copies).toEqual([
      "deploy/ingestion-worker/package.json",
      "/app/node_modules",
      "deploy/ingestion-worker/package.json",
      "workers/ingestion/",
      "src/lib/egress/",
      "src/lib/knowledge/core/",
      // 8B-I7: the alarm sink and the health evaluation (no dependencies).
      "src/lib/observability/",
      "deploy/ingestion-worker/certs/",
    ]);
    expect(instructions).toMatch(/npm ci --omit=dev --omit=optional --ignore-scripts/);
    expect(instructions).toMatch(/^RUN rm -f workers\/ingestion\/dev-service-role\.ts$/m);
    expect(instructions).not.toMatch(/src\/lib\/knowledge\/providers/);
    const ignore = read(".dockerignore");
    for (const entry of ["**/.env", "**/.env.*", "workers/ingestion/dev-service-role.ts", "node_modules", ".git"]) expect(ignore).toContain(entry);
  });

  it("the image's dependency manifest is minimal and matches the root lockfile", () => {
    const manifest = json(`${DEPLOY}/package.json`) as { dependencies: Record<string, string>; devDependencies?: unknown };
    expect(Object.keys(manifest.dependencies).sort()).toEqual(["pdfjs-dist", "postgres"]);
    expect(manifest.devDependencies).toBeUndefined();
    const lock = json("package-lock.json") as { packages: Record<string, { version: string }> };
    for (const [name, version] of Object.entries(manifest.dependencies)) expect(lock.packages[`node_modules/${name}`]!.version, name).toBe(version);
    const imageLock = read(`${DEPLOY}/package-lock.json`);
    expect(imageLock).not.toMatch(/@supabase|"next"|"react"|@vercel|@aws-sdk|@smithy|bedrock/);
    // Every package of the image is the version of the root lockfile (8B-I8).
    const imagePackages = (JSON.parse(imageLock) as { packages: Record<string, { version?: string }> }).packages;
    for (const [name, entry] of Object.entries(imagePackages)) if (name) expect(entry.version, name).toBe(lock.packages[name]?.version);
  });

  it("contains no credential, certificate key or connection string in any deployment file", () => {
    const files = [".dockerignore", ...["deploy/ingestion-worker", "deploy/clamav", "deploy/import"].flatMap((directory) => readdirSync(path.join(root, directory), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name))))];
    expect(files).toContain("deploy/import/compose.yaml");
    for (const file of files) {
      const text = read(file);
      expect(text, file).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{16}|aws_secret_access_key|eyJ[A-Za-z0-9_-]{10,}\.|postgres(ql)?:\/\/[^\s"]*:[^\s"]*@|"password"\s*:\s*"[A-Za-z0-9+/=_-]{8,}"/i);
      expect(text, file).not.toMatch(/\b\d{12}\b/);
    }
  });
});

describe("import specification (beta L2, deploy/import/compose.yaml)", () => {
  type Service = { [key: string]: YamlValue };
  const compose = parseComposeYaml(read("deploy/import/compose.yaml")) as { services: Record<string, Service>; networks: Record<string, YamlValue> };
  const worker = compose.services.worker!;
  const environment = worker.environment as Record<string, YamlValue>;

  it("runs the worker once as a non-root, read-only, capability-less container with a /tmp tmpfs only", () => {
    expect(worker.build).toEqual({ context: "../..", dockerfile: "deploy/ingestion-worker/Dockerfile" });
    expect(worker.command).toEqual(["--once"]);
    expect(worker.user).toBe("1000:1000");
    expect(worker.read_only).toBe(true);
    expect(worker.cap_drop).toEqual(["ALL"]);
    expect(worker.security_opt).toEqual(["no-new-privileges:true"]);
    expect(worker.tmpfs).toEqual(["/tmp"]);
    for (const key of ["privileged", "volumes", "devices", "pid", "ipc", "network_mode", "cap_add", "env_file", "secrets", "configs"]) expect(worker, key).not.toHaveProperty(key);
    // The stop waits longer than the worker's shutdown grace before the process is killed.
    const grace = Number(/IPA_WORKER_SHUTDOWN_GRACE_MS", (\d[\d_]*)/.exec(read("workers/ingestion/config.ts"))![1]!.replaceAll("_", ""));
    expect(worker.stop_grace_period).toBe("100s");
    expect(100_000).toBeGreaterThan(grace);
  });

  it("accepts no inbound traffic: no published port, no host network", () => {
    for (const service of Object.values(compose.services)) {
      expect(service).not.toHaveProperty("ports");
      expect(service).not.toHaveProperty("expose");
      expect(service).not.toHaveProperty("network_mode");
    }
  });

  it("talks to the scanner only at the fixed endpoint and waits for a healthy scanner", () => {
    expect(environment.IPA_CLAMD_HOST).toBe("clamav");
    expect(environment.IPA_CLAMD_PORT).toBe("3310");
    expect(worker.depends_on).toEqual({ clamav: { condition: "service_healthy" } });
    expect(worker.networks).toEqual(["scan", "egress"]);
  });

  it("takes the database credential only from the operator's environment — never a value in the file", () => {
    expect(environment.IPA_WORKER_DB_USER).toBe("${IPA_WORKER_DB_USER:?}");
    expect(environment.IPA_WORKER_DB_PASSWORD).toBe("${IPA_WORKER_DB_PASSWORD:?}");
    for (const [name, value] of Object.entries(environment)) {
      if (/PASSWORD|SECRET|KEY|TOKEN|USER/.test(name)) expect(value, name).toBe(`\${${name}:?}`);
    }
    expect(Object.keys(environment)).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(read("deploy/import/compose.yaml")).not.toMatch(/SERVICE_ROLE|AWS_|ANTHROPIC|sk-ant/i);
    expect(environment.IPA_RUNTIME_ENV).toBe("production");
    expect(environment.IPA_WORKER_DB_PORT).toBe("6543");
    expect(environment.IPA_WORKER_DB_SSL).toBe("verify-full");
  });
});

describe("boundaries that I4 must not move", () => {
  it("no cloud provider is in the fail-closed registry; the application chooses providers only through the configuration in service (8B-I6; beta L2)", () => {
    const registry = stripComments(read("src/lib/knowledge/core/registry.ts"));
    expect(registry).not.toMatch(/bedrock|catalog|cohere/i);
    // L2: the provider directory holds only the selection from the configuration in service.
    expect(readdirSync(path.join(root, "src/lib/knowledge/providers"), { recursive: true }).map(String)).toEqual(["configured.ts"]);
    const appFiles = readdirSync(path.join(root, "src"), { recursive: true }).map(String).filter((file) => /\.(ts|tsx)$/.test(file) && !file.startsWith("tests"));
    const users: string[] = [];
    for (const file of appFiles) {
      if (file.startsWith(path.join("lib", "knowledge", "providers"))) continue;
      const text = stripComments(read(path.join("src", file)));
      expect(text, file).not.toMatch(/providers\/catalog|providers\/bedrock/);
      if (/providers\/configured/.test(text)) users.push(file.split(path.sep).join("/"));
    }
    expect(users.sort()).toEqual(["lib/knowledge/retrieval-availability.ts", "lib/knowledge/retrieval.ts"]);
  });

  it("the Edge Function receives only the ticket and returns no credential", () => {
    const handler = stripComments(read("supabase/functions/worker-storage/handler.ts"));
    expect(handler).not.toMatch(/createSignedUrl|SERVICE_ROLE|apikey|authorization/i);
    const entry = read("supabase/functions/worker-storage/index.ts");
    expect(entry).toMatch(/Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/);
    expect(read("supabase/config.toml")).toMatch(/\[functions\.worker-storage\]\nverify_jwt = false/);
    expect(existsSync(path.join(root, "supabase/functions/worker-storage/handler.ts"))).toBe(true);
  });
});
