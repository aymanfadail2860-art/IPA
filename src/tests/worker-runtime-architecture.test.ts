import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 8B-I4 — static guardrails for the production worker runtime and its deployment
 * specification (docs/08b §21.5). They enforce, as far as a static check can:
 *
 *   * the production worker's code graph contains no service-role client and no Supabase SDK;
 *   * the production database adapter uses only the locked knowledge.worker_* API;
 *   * no credential is baked into the image, the build or the deployment files;
 *   * IAM is split (execution vs task role) and narrow; Bedrock stays out of the app registry.
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
    expect([...graph.packages].filter((name) => !name.startsWith("node:")).sort()).toEqual(["pdfjs-dist", "postgres"]);
    expect(graph.files.has("workers/ingestion/dev-service-role.ts")).toBe(false);
    for (const file of graph.files) {
      expect(
        file.startsWith("workers/ingestion/") || file.startsWith("src/lib/egress/") || file.startsWith("src/lib/knowledge/core/") || file.startsWith("src/lib/observability/"),
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
    expect(config).toMatch(/export const PRODUCTION_SCANNER = Object\.freeze\(\{ host: "clamav\.ipa-worker\.internal", port: 3310 \}\);/);
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
    expect(instructions).toMatch(/rm -f workers\/ingestion\/dev-service-role\.ts/);
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
    expect(imageLock).not.toMatch(/@supabase|"next"|"react"/);
  });

  it("contains no credential, certificate key or connection string in any deployment file", () => {
    const files = [".dockerignore", ...readdirSync(path.join(root, DEPLOY), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)))];
    for (const file of files) {
      const text = read(file);
      expect(text, file).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{16}|aws_secret_access_key|eyJ[A-Za-z0-9_-]{10,}\.|postgres(ql)?:\/\/[^\s"]*:[^\s"]*@|"password"\s*:\s*"[A-Za-z0-9+/=_-]{8,}"/i);
      expect(text, file).not.toMatch(/\b\d{12}\b/);
    }
  });
});

describe("ECS/Fargate specification (8B-I4)", () => {
  const taskDefinition = json(`${DEPLOY}/task-definition.json`) as {
    executionRoleArn: string; taskRoleArn: string; networkMode: string; requiresCompatibilities: string[];
    containerDefinitions: { name: string; image: string; user: string; readonlyRootFilesystem: boolean; privileged: boolean; linuxParameters: { initProcessEnabled: boolean; capabilities: { drop: string[] } }; environment: { name: string; value: string }[]; secrets?: { name: string; valueFrom: string }[]; healthCheck: { command: string[] }; logConfiguration: { logDriver: string }; stopTimeout: number; mountPoints: { containerPath: string }[]; dependsOn?: unknown; portMappings?: unknown }[];
  };
  const container = taskDefinition.containerDefinitions[0]!;

  it("runs on Fargate as a non-root, read-only, capability-less container with a /tmp volume only", () => {
    expect(taskDefinition.requiresCompatibilities).toEqual(["FARGATE"]);
    expect(taskDefinition.networkMode).toBe("awsvpc");
    // 8B-I5.5: the worker task holds the worker only — ClamAV is its own service.
    expect(taskDefinition.containerDefinitions.map((definition) => definition.name)).toEqual(["ingestion-worker"]);
    expect(container.user).toBe("1000:1000");
    expect(container.readonlyRootFilesystem).toBe(true);
    expect(container.privileged).toBe(false);
    expect(container.linuxParameters).toEqual({ initProcessEnabled: true, capabilities: { drop: ["ALL"] } });
    expect(container.mountPoints.map((mount) => mount.containerPath)).toEqual(["/tmp"]);
    expect(container.healthCheck.command).toEqual(["CMD", "node", "workers/ingestion/healthcheck.ts"]);
    expect(container.logConfiguration.logDriver).toBe("awslogs");
    // ECS waits longer than the worker's shutdown grace before it kills the process.
    const grace = Number(container.environment.find((entry) => entry.name === "IPA_WORKER_SHUTDOWN_GRACE_MS")!.value);
    expect(container.stopTimeout * 1000).toBeGreaterThan(grace);
  });

  it("talks to the scanner only at the fixed private service endpoint (8B-I5.5)", () => {
    expect(container.environment).toContainEqual({ name: "IPA_CLAMD_HOST", value: "clamav.ipa-worker.internal" });
    expect(container.environment).toContainEqual({ name: "IPA_CLAMD_PORT", value: "3310" });
    expect(container.dependsOn).toBeUndefined();
    expect(JSON.stringify(taskDefinition)).not.toMatch(/clamav\/|ipa-clamav|127\.0\.0\.1/);
  });

  it("injects the database credential only from Secrets Manager — never as a plain environment value", () => {
    expect(container.secrets).toEqual([
      { name: "IPA_WORKER_DB_USER", valueFrom: "${WORKER_DB_SECRET_ARN}:username::" },
      { name: "IPA_WORKER_DB_PASSWORD", valueFrom: "${WORKER_DB_SECRET_ARN}:password::" },
    ]);
    for (const entry of container.environment) {
      expect(entry.name, entry.name).not.toMatch(/PASSWORD|SECRET|KEY|TOKEN|USER/);
    }
    expect(container.environment.map((entry) => entry.name)).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(container.environment).toContainEqual({ name: "IPA_RUNTIME_ENV", value: "production" });
    expect(container.environment).toContainEqual({ name: "IPA_WORKER_DB_PORT", value: "6543" });
    expect(container.environment).toContainEqual({ name: "IPA_WORKER_DB_SSL", value: "verify-full" });
  });

  it("separates the execution role from the task role", () => {
    expect(taskDefinition.executionRoleArn).not.toBe(taskDefinition.taskRoleArn);
    expect(taskDefinition.executionRoleArn).toMatch(/role\/ipa-ingestion-worker-execution$/);
    expect(taskDefinition.taskRoleArn).toMatch(/role\/ipa-ingestion-worker-task$/);
  });

  it("runs in private subnets without a public IP, without inbound traffic and without ECS Exec", () => {
    const service = json(`${DEPLOY}/service.json`) as { networkConfiguration: { awsvpcConfiguration: { assignPublicIp: string } }; enableExecuteCommand: boolean; desiredCount: number; deploymentConfiguration: { minimumHealthyPercent: number; maximumPercent: number; deploymentCircuitBreaker: { enable: boolean } } };
    expect(service.networkConfiguration.awsvpcConfiguration.assignPublicIp).toBe("DISABLED");
    expect(service.enableExecuteCommand).toBe(false);
    expect(service.desiredCount).toBe(1);
    expect(service.deploymentConfiguration).toMatchObject({ minimumHealthyPercent: 100, maximumPercent: 200, deploymentCircuitBreaker: { enable: true } });
    const group = json(`${DEPLOY}/security-group.json`) as { Ingress: unknown[]; Egress: ({ FromPort: number } & Record<string, unknown>)[] };
    expect(group.Ingress).toEqual([]);
    expect(group.Egress.map((rule) => rule.FromPort).sort((a, b) => a - b)).toEqual([443, 3310, 6543]);
    // clamd only towards the ClamAV security group — never a CIDR.
    expect(group.Egress.find((rule) => rule.FromPort === 3310)).toMatchObject({ ToPort: 3310, SourceSecurityGroupId: "${CLAMAV_SECURITY_GROUP_ID}" });
    expect(group.Egress.find((rule) => rule.FromPort === 3310)).not.toHaveProperty("CidrIp");
  });
});

describe("IAM (8B-I4)", () => {
  type Statement = { Sid: string; Effect: string; Action: string | string[]; Resource: string | string[]; Condition?: unknown };
  const statements = (file: string) => (json(`${DEPLOY}/iam/${file}`) as { Statement: Statement[] }).Statement;
  const list = (value: string | string[]) => (Array.isArray(value) ? value : [value]);

  it("has no administrator, wildcard action or service-wide resource", () => {
    for (const file of ["execution-role-policy.json", "task-role-policy.json"]) {
      for (const statement of statements(file)) {
        expect(statement.Effect).toBe("Allow");
        for (const action of list(statement.Action)) expect(action, `${file} ${statement.Sid}`).not.toMatch(/\*/);
        for (const resource of list(statement.Resource)) {
          // ecr:GetAuthorizationToken cannot be scoped (AWS); every other resource is named.
          if (resource === "*") expect(list(statement.Action)).toEqual(["ecr:GetAuthorizationToken"]);
        }
      }
    }
  });

  it("the execution role only pulls the image, writes the log group and reads the one secret", () => {
    const actions = statements("execution-role-policy.json").flatMap((statement) => list(statement.Action)).sort();
    expect(actions).toEqual([
      "ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:GetAuthorizationToken", "ecr:GetDownloadUrlForLayer",
      "kms:Decrypt", "logs:CreateLogStream", "logs:PutLogEvents", "secretsmanager:GetSecretValue",
    ]);
    const secret = statements("execution-role-policy.json").find((statement) => list(statement.Action).includes("secretsmanager:GetSecretValue"))!;
    expect(secret.Resource).toBe("${WORKER_DB_SECRET_ARN}");
  });

  it("the task role can only invoke Embed v4 through the EU inference profile — no secrets, no rerank, nothing else", () => {
    const task = statements("task-role-policy.json");
    expect(task.flatMap((statement) => list(statement.Action))).toEqual(["bedrock:InvokeModel", "bedrock:InvokeModel"]);
    expect(task.flatMap((statement) => list(statement.Resource))).toEqual([
      "arn:aws:bedrock:eu-central-1:${AWS_ACCOUNT_ID}:inference-profile/eu.cohere.embed-v4:0",
      "arn:aws:bedrock:eu-*::foundation-model/cohere.embed-v4:0",
    ]);
    expect(task[1]!.Condition).toEqual({ StringEquals: { "bedrock:InferenceProfileArn": "arn:aws:bedrock:eu-central-1:${AWS_ACCOUNT_ID}:inference-profile/eu.cohere.embed-v4:0" } });
    expect(read(`${DEPLOY}/iam/task-role-policy.json`)).not.toMatch(/rerank|secretsmanager|s3:|ssm:/);
  });

  it("only ECS tasks of this account can assume the roles", () => {
    const trust = (json(`${DEPLOY}/iam/ecs-tasks-trust-policy.json`) as { Statement: { Principal: unknown; Condition: unknown }[] }).Statement;
    expect(trust).toHaveLength(1);
    expect(trust[0]!.Principal).toEqual({ Service: "ecs-tasks.amazonaws.com" });
    expect(trust[0]!.Condition).toMatchObject({ StringEquals: { "aws:SourceAccount": "${AWS_ACCOUNT_ID}" } });
  });
});

describe("boundaries that I4 must not move", () => {
  it("Bedrock is not in the fail-closed registry; the application reaches it only through the configuration in service (8B-I6)", () => {
    const registry = stripComments(read("src/lib/knowledge/core/registry.ts"));
    expect(registry).not.toMatch(/bedrock|catalog|cohere/i);
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
