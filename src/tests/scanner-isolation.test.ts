import { readdirSync, readFileSync } from "node:fs";
import { createServer, type AddressInfo, type Server } from "node:net";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scannerRevision, verifyScanner } from "../../scripts/verify-clamav-scanner.ts";
import { PRODUCTION_SCANNER } from "../../workers/ingestion/config.ts";
import { examineOriginal, type ScanContext } from "../../workers/ingestion/security/scan.ts";
import { clamdScanner } from "../../workers/ingestion/security/scanner.ts";

import { sha256, simplePdf } from "./fixtures/knowledge-pdfs";

/**
 * 8B-I5.5 — scanner isolation and signature supply (docs/08b §21.7, B-027). Static checks of the
 * deployment specification (no AWS account needed) and the behaviour of the worker against a
 * scanner service over TCP: unreachable, stale, ageing past 24 hours during a failed refresh,
 * and replaced by a fresh revision.
 */

const root = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const json = <T>(file: string) => JSON.parse(read(file)) as T;
type Statement = { Sid?: string; Action: string | string[]; Resource: string | string[]; Condition?: unknown };
const list = (value: string | string[]) => (Array.isArray(value) ? value : [value]);
const actions = (file: string) => json<{ Statement: Statement[] }>(file).Statement.flatMap((statement) => list(statement.Action));

interface Container {
  name: string;
  image: string;
  user: string;
  readonlyRootFilesystem: boolean;
  privileged: boolean;
  linuxParameters: unknown;
  environment: unknown[];
  secrets?: unknown;
  portMappings: { containerPort: number; hostPort?: number }[];
  mountPoints: { containerPath: string }[];
}
interface TaskDefinition {
  family: string;
  executionRoleArn: string;
  taskRoleArn?: string;
  containerDefinitions: Container[];
}
interface Rule {
  FromPort: number;
  ToPort: number;
  SourceSecurityGroupId?: string;
  DestinationSecurityGroupId?: string;
  DestinationPrefixListId?: string;
  CidrIp?: string;
  CidrIpv6?: string;
}

describe("ClamAV is its own task and service (deploy/clamav)", () => {
  const scanner = json<TaskDefinition>("deploy/clamav/task-definition.json");
  const worker = json<TaskDefinition>("deploy/ingestion-worker/task-definition.json");
  const container = scanner.containerDefinitions[0]!;

  it("is not part of the worker task", () => {
    expect(scanner.family).toBe("ipa-clamav");
    expect(worker.family).toBe("ipa-ingestion-worker");
    expect(worker.containerDefinitions.map((definition) => definition.name)).toEqual(["ingestion-worker"]);
    expect(scanner.containerDefinitions.map((definition) => definition.name)).toEqual(["clamav"]);
  });

  it("has NO task role — so no AWS credentials at all, and in particular not the worker's Bedrock role", () => {
    expect(scanner.taskRoleArn).toBeUndefined();
    expect(scanner.executionRoleArn).toBe("arn:aws:iam::${AWS_ACCOUNT_ID}:role/ipa-clamav-execution");
    expect(scanner.executionRoleArn).not.toBe(worker.executionRoleArn);
    expect(worker.taskRoleArn).toMatch(/role\/ipa-ingestion-worker-task$/);
    // Nothing about the scanner names the worker's roles or Bedrock.
    for (const file of readdirSync(path.join(root, "deploy/clamav"), { recursive: true }).map(String).filter((name) => name.endsWith(".json"))) {
      expect(read(`deploy/clamav/${file}`), file).not.toMatch(/ipa-ingestion-worker-(task|execution)|bedrock/i);
    }
  });

  it("its execution role (ECS' own) only pulls the scanner image and writes its log group — no secrets, no keys", () => {
    expect(actions("deploy/clamav/iam/execution-role-policy.json").sort()).toEqual([
      "ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:GetAuthorizationToken", "ecr:GetDownloadUrlForLayer", "logs:CreateLogStream", "logs:PutLogEvents",
    ]);
    const policy = read("deploy/clamav/iam/execution-role-policy.json");
    expect(policy).toContain("repository/ipa-clamav\"");
    expect(policy).toContain("log-group:/ipa/clamav:*");
    expect(policy).not.toMatch(/secretsmanager|kms:|ssm:|s3:|bedrock|ingestion-worker/);
  });

  it("runs as a non-root, read-only, capability-less container with no credential and no environment", () => {
    expect(container.user).toBe("10001:10001");
    expect(container.readonlyRootFilesystem).toBe(true);
    expect(container.privileged).toBe(false);
    expect(container.linuxParameters).toEqual({ initProcessEnabled: true, capabilities: { drop: ["ALL"] } });
    expect(container.secrets).toBeUndefined();
    expect(container.environment).toEqual([]);
    expect(container.mountPoints.map((mount) => mount.containerPath)).toEqual(["/tmp"]);
    expect(container.portMappings).toEqual([{ containerPort: 3310, protocol: "tcp", name: "clamd" }]);
    // The exact image a revision ran is pinned by digest (reproducible verdicts).
    expect(container.image).toMatch(/\/ipa-clamav@\$\{CLAMAV_IMAGE_DIGEST\}$/);
  });

  it("runs in private subnets without a public IP and without ECS Exec, replacing a scanner only when the new one is healthy", () => {
    const service = json<{ networkConfiguration: { awsvpcConfiguration: { subnets: string[]; assignPublicIp: string; securityGroups: string[] } }; enableExecuteCommand: boolean; deploymentConfiguration: unknown; serviceRegistries: unknown[] }>("deploy/clamav/service.json");
    expect(service.networkConfiguration.awsvpcConfiguration).toEqual({ subnets: ["${SCANNER_SUBNET_A}", "${SCANNER_SUBNET_B}"], securityGroups: ["${CLAMAV_SECURITY_GROUP_ID}"], assignPublicIp: "DISABLED" });
    expect(service.enableExecuteCommand).toBe(false);
    expect(service.deploymentConfiguration).toEqual({ minimumHealthyPercent: 100, maximumPercent: 200, deploymentCircuitBreaker: { enable: true, rollback: true } });
    expect(service.serviceRegistries).toEqual([{ registryArn: "${CLAMAV_CLOUD_MAP_SERVICE_ARN}" }]);
  });

  it("accepts TCP 3310 from the worker's security group only, and has no internet egress", () => {
    const group = json<{ Ingress: Rule[]; Egress: Rule[] }>("deploy/clamav/security-group.json");
    expect(group.Ingress).toEqual([
      { IpProtocol: "tcp", FromPort: 3310, ToPort: 3310, SourceSecurityGroupId: "${WORKER_SECURITY_GROUP_ID}", Description: expect.any(String) },
    ]);
    for (const rule of [...group.Ingress, ...group.Egress]) {
      expect(rule.CidrIp, JSON.stringify(rule)).toBeUndefined();
      expect(rule.CidrIpv6, JSON.stringify(rule)).toBeUndefined();
    }
    // Only HTTPS to the VPC endpoints ECS needs (image pull, logs) — no 0.0.0.0/0, no NAT.
    expect(group.Egress.map((rule) => [rule.FromPort, rule.DestinationSecurityGroupId ?? rule.DestinationPrefixListId])).toEqual([
      [443, "${VPC_ENDPOINT_SECURITY_GROUP_ID}"],
      [443, "${S3_GATEWAY_PREFIX_LIST_ID}"],
    ]);
    const workerGroup = json<{ Egress: Rule[] }>("deploy/ingestion-worker/security-group.json");
    expect(workerGroup.Egress.filter((rule) => rule.FromPort === 3310)).toEqual([expect.objectContaining({ SourceSecurityGroupId: "${CLAMAV_SECURITY_GROUP_ID}" })]);
  });

  it("is found by private DNS (Cloud Map) at the worker's fixed endpoint; only healthy tasks are registered", () => {
    const discovery = json<{ namespace: { Name: string }; service: { Name: string; DnsConfig: { DnsRecords: { Type: string; TTL: number }[] }; HealthCheckCustomConfig: unknown } }>("deploy/clamav/service-discovery.json");
    expect(`${discovery.service.Name}.${discovery.namespace.Name}`).toBe(PRODUCTION_SCANNER.host);
    expect(discovery.service.DnsConfig.DnsRecords).toEqual([{ Type: "A", TTL: 10 }]);
    expect(discovery.service.HealthCheckCustomConfig).toEqual({ FailureThreshold: 1 });
    expect(read("deploy/clamav/clamd.conf")).toMatch(/^TCPSocket 3310$/m);
  });
});

describe("signature supply (scheduled image build)", () => {
  const workflow = read(".github/workflows/clamav-signatures.yml");
  const dockerfile = read("deploy/clamav/Dockerfile");

  it("builds on a schedule with margin to the 24-hour limit, verifies before pushing, deploys by digest", () => {
    expect(workflow).toMatch(/cron: "17 \*\/6 \* \* \*"/);
    const order = ["docker build", "scripts/verify-clamav-scanner.ts", "docker push", "register-task-definition", "update-service", "services-stable"].map((step) => workflow.indexOf(step));
    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(workflow).toMatch(/--max-age-hours "\$MAX_BUILD_AGE_HOURS"/);
    expect(workflow).toMatch(/MAX_BUILD_AGE_HOURS: "8"/);
    expect(workflow).toMatch(/CLAMAV_IMAGE_DIGEST=\$DIGEST/);
  });

  it("stores no credential and does nothing until the production account is configured", () => {
    expect(workflow).not.toMatch(/secrets\./);
    expect(workflow).toMatch(/if: \$\{\{ vars\.IPA_AWS_ACCOUNT_ID != '' \}\}/);
    expect(workflow).toMatch(/id-token: write/);
    expect(workflow).toMatch(/role-to-assume: arn:aws:iam::\$\{\{ vars\.IPA_AWS_ACCOUNT_ID \}\}:role\/ipa-clamav-publisher/);
  });

  it("the CI role can push this one repository, deploy this one service and pass only the scanner's execution role", () => {
    const policy = read("deploy/clamav/iam/ci-publisher-policy.json");
    expect(policy).toContain("repository/ipa-clamav\"");
    expect(policy).toContain("service/${ECS_CLUSTER}/ipa-clamav\"");
    expect(policy).toContain("role/ipa-clamav-execution\"");
    expect(policy).not.toMatch(/ingestion-worker|bedrock|secretsmanager|iam:\*|ecs:\*|ecr:\*/);
    const trust = read("deploy/clamav/iam/ci-publisher-trust-policy.json");
    expect(trust).toContain("repo:aymanfadail2860-art/IPA:ref:refs/heads/main");
  });

  it("pins the ClamAV release, takes only official signatures at build time and records the build", () => {
    expect(dockerfile.match(/^FROM docker\.io\/clamav\/clamav:1\.4\.3_base/gm)).toHaveLength(2);
    expect(dockerfile).toMatch(/freshclam --foreground --stdout --show-progress=no --config-file=\/etc\/clamav\/freshclam\.conf/);
    expect(dockerfile).not.toMatch(/DatabaseCustomURL|PrivateMirror|ExtraDatabase|curl |wget /);
    expect(dockerfile).toMatch(/clamscan --version > \/usr\/share\/ipa\/scanner-build\.txt/);
    expect(read("deploy/clamav/clamd.conf")).not.toMatch(/^(SelfCheck [1-9]|DatabaseMirror)/m);
  });

  it("alarms on ageing signatures, technical scan failures and a failed scanner deployment", () => {
    const alarms = read("deploy/clamav/alarms.json");
    expect(alarms).toContain("ipa-scanner-signatures-ageing");
    expect(alarms).toContain("ipa-scanner-technical-failures");
    expect(alarms).toContain("SERVICE_DEPLOYMENT_FAILED");
  });

  it("has no switch anywhere to ignore stale signatures", () => {
    const sources = [
      ...readdirSync(path.join(root, "workers/ingestion"), { recursive: true }).map(String).filter((file) => file.endsWith(".ts")).map((file) => `workers/ingestion/${file}`),
      "supabase/migrations/20261005000100_upload_security.sql",
      "supabase/migrations/20261006000100_scanner_revision.sql",
      ".github/workflows/clamav-signatures.yml",
    ];
    for (const file of sources) expect(read(file), file).not.toMatch(/IGNORE_STALE|ALLOW_STALE|SKIP_SIGNATURE|stale_ok|ignoreStale/i);
    // The maximum age lives in the policy row (≤ 7 days by constraint), not in the environment.
    expect(read("workers/ingestion/config.ts")).not.toMatch(/SIGNATURE|max_signature_age/i);
  });
});

// ------------------------------------------------------------------------ fake scanner service

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

/** A scanner "service" over TCP whose signature date can be changed (= a redeployed revision). */
async function scannerService(state: { version: string; detectEicar?: boolean }, port = 0): Promise<{ port: number; server: Server }> {
  const server = createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on("data", (data) => {
      buffer = Buffer.concat([buffer, data]);
      const text = buffer.toString("latin1");
      if (text.startsWith("zVERSION\0")) return void socket.end(`${state.version}\0`);
      if (text.startsWith("zINSTREAM\0") && buffer.subarray(-4).readUInt32BE(0) === 0) {
        const infected = state.detectEicar !== false && text.includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE");
        socket.end(infected ? "stream: Win.Test.EICAR_HDB-1 FOUND\0" : "stream: OK\0");
      }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return { port: (server.address() as AddressInfo).port, server };
}

const clamdDate = (date: Date) => {
  const day = date.toUTCString().slice(0, 3);
  const month = date.toUTCString().slice(8, 11);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${day} ${month} ${String(date.getUTCDate()).padStart(2, " ")} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} ${date.getUTCFullYear()}`;
};
const HOUR = 3_600_000;
const T0 = Date.parse("2026-10-06T06:00:00Z");

describe("the worker against the scanner service", async () => {
  const pdf = await simplePdf("isolation");
  const context: ScanContext = {
    security_state: "scanning", storage_bucket: "knowledge-intake", policy_version: "pdf-v1", max_signature_age_seconds: 86_400, limits: {},
    checksum_sha256: sha256(pdf), byte_size: pdf.byteLength, upload_mime: "application/pdf", original_filename: "fiktiv.pdf",
  };
  const inspector = { inspect: async () => ({ pdfSecurity: { result: "pass" as const }, activeContent: { result: "pass" as const, findings: [] }, pages: 1 }) };

  it("an unresolvable or unreachable service is unavailable — never clean", async () => {
    const unresolvable = clamdScanner({ host: "clamav.ipa-worker.invalid", port: 3310 });
    expect(await unresolvable.info()).toEqual({ error: "scanner_unavailable" });
    expect(await unresolvable.scan(pdf, 2_000)).toEqual({ result: "error", code: "scanner_unavailable" });
    const measured = await examineOriginal(pdf, context, { scanner: unresolvable, inspector });
    expect(measured.malware).toEqual({ result: "error", code: "scanner_unavailable", name: null });
    expect(measured.pdf_security.result).toBe("not_run");
  });

  it("a failed refresh keeps the old scanner, which stops being usable by itself after 24 hours — a fresh revision restores scanning", async () => {
    const state = { version: `ClamAV 1.4.3/27790/${clamdDate(new Date(T0))}` };
    const service = await scannerService(state);
    const scanner = clamdScanner({ host: "127.0.0.1", port: service.port });
    const at = (hours: number) => examineOriginal(pdf, context, { scanner, inspector, now: () => T0 + hours * HOUR });
    // The scheduled refreshes at +6 h, +12 h and +18 h fail: the old revision keeps serving.
    expect((await at(23.5)).malware).toEqual({ result: "clean", code: null, name: null });
    expect((await at(24.5)).malware).toEqual({ result: "error", code: "stale_signatures", name: null });
    expect((await at(24.5)).pdf_security.result).toBe("not_run");
    // A fresh revision replaces it at the same endpoint.
    state.version = `ClamAV 1.4.3/27801/${clamdDate(new Date(T0 + 24 * HOUR))}`;
    const fresh = await at(24.6);
    expect(fresh.malware).toEqual({ result: "clean", code: null, name: null });
    expect(fresh.scanner).toMatchObject({ engine: "ClamAV", engine_version: "1.4.3", signature_version: "27801" });
  });

  it("the build verification accepts only a fresh, pinned, working scanner — and names its revision", async () => {
    const options = { expectedEngineVersion: "1.4.3", maxBuildAgeSeconds: 8 * 3600, now: () => T0 + 2 * HOUR };
    const fresh = await scannerService({ version: `ClamAV 1.4.3/27790/${clamdDate(new Date(T0))}` });
    expect(await verifyScanner(clamdScanner({ host: "127.0.0.1", port: fresh.port }), options)).toMatchObject({
      ok: true, revision: "ipa-clamav:1.4.3-27790", engineVersion: "1.4.3", signatureVersion: "27790", signatureAgeSeconds: 7200,
    });
    expect(scannerRevision("1.4.3", "27790")).toBe("ipa-clamav:1.4.3-27790");

    const cases: [string, { version: string; detectEicar?: boolean }, RegExp][] = [
      ["stale", { version: `ClamAV 1.4.3/27790/${clamdDate(new Date(T0 - 10 * HOUR))}` }, /old/],
      ["unknown date", { version: "ClamAV 1.4.3" }, /signature time unknown/],
      ["future date", { version: `ClamAV 1.4.3/27790/${clamdDate(new Date(T0 + 5 * HOUR))}` }, /future/],
      ["unpinned engine", { version: `ClamAV 1.5.0/27790/${clamdDate(new Date(T0))}` }, /pinned/],
      ["blind scanner", { version: `ClamAV 1.4.3/27790/${clamdDate(new Date(T0))}`, detectEicar: false }, /EICAR not detected/],
    ];
    for (const [name, state, problem] of cases) {
      const service = await scannerService(state);
      const result = await verifyScanner(clamdScanner({ host: "127.0.0.1", port: service.port }), options);
      expect(result.ok, name).toBe(false);
      expect((result as { problems: string[] }).problems.join(" "), name).toMatch(problem);
    }
    const down = await verifyScanner(clamdScanner({ host: "127.0.0.1", port: 1 }), options);
    expect(down).toEqual({ ok: false, problems: ["scanner: scanner_unavailable"] });
  });
});
