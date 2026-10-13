import { readdirSync, readFileSync } from "node:fs";
import { createServer, type AddressInfo, type Server } from "node:net";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { approvedEngine, scannerRevision, verifyScanner } from "../../scripts/verify-clamav-scanner.ts";
import { PRODUCTION_SCANNER } from "../../workers/ingestion/config.ts";
import { examineOriginal, type ScanContext } from "../../workers/ingestion/security/scan.ts";
import { clamdScanner } from "../../workers/ingestion/security/scanner.ts";

import { parseComposeYaml, type YamlValue } from "./fixtures/compose-yaml";
import { sha256, simplePdf } from "./fixtures/knowledge-pdfs";

/**
 * 8B-I5.5 — scanner isolation and signature supply (docs/08b §21.7, B-027). Static checks of the
 * deployment specification and the behaviour of the worker against a scanner service over TCP:
 * unreachable, stale, ageing past 24 hours during a failed refresh, and replaced by a fresh
 * revision.
 *
 * Beta L2 (docs/beta.md §14): the ECS task, service, security groups, Cloud Map, IAM, alarms and
 * the scheduled signature workflow are removed with AWS. Their vendor-neutral requirements are
 * checked against the import specification deploy/import/compose.yaml: ClamAV in its own
 * container, without environment, credential or internet; reachable only from the worker on an
 * internal network at the worker's fixed endpoint; built on the approved engine by digest with
 * fresh official signatures.
 */

const root = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const json = <T>(file: string) => JSON.parse(read(file)) as T;
type Service = { [key: string]: YamlValue };
const compose = parseComposeYaml(read("deploy/import/compose.yaml")) as { services: Record<string, Service>; networks: Record<string, { internal?: boolean } | null> };

describe("ClamAV is its own container (deploy/import/compose.yaml)", () => {
  const scanner = compose.services.clamav!;
  const worker = compose.services.worker!;

  it("is not part of the worker's container or image", () => {
    expect(Object.keys(compose.services).sort()).toEqual(["clamav", "worker"]);
    expect(scanner.build).toMatchObject({ context: "../..", dockerfile: "deploy/clamav/Dockerfile" });
    expect(worker.build).toMatchObject({ context: "../..", dockerfile: "deploy/ingestion-worker/Dockerfile" });
    expect(read("deploy/ingestion-worker/Dockerfile")).not.toMatch(/clamav|clamd|freshclam/i);
  });

  it("has NO environment and NO credential — in particular none of the worker's", () => {
    expect(scanner.environment).toEqual({});
    for (const key of ["env_file", "secrets", "configs", "volumes", "devices", "privileged", "cap_add", "pid", "ipc", "network_mode"]) {
      expect(scanner, key).not.toHaveProperty(key);
    }
    for (const file of readdirSync(path.join(root, "deploy/clamav"), { recursive: true }).map(String)) {
      expect(read(`deploy/clamav/${file}`), file).not.toMatch(/IPA_WORKER_DB|PASSWORD|SERVICE_ROLE|ingestion_worker_login|bedrock|anthropic/i);
    }
  });

  it("runs as a non-root, read-only, capability-less container with a /tmp tmpfs only", () => {
    expect(scanner.user).toBe("10001:10001");
    expect(scanner.read_only).toBe(true);
    expect(scanner.cap_drop).toEqual(["ALL"]);
    expect(scanner.security_opt).toEqual(["no-new-privileges:true"]);
    expect(scanner.tmpfs).toEqual(["/tmp"]);
    expect(read("deploy/clamav/Dockerfile")).toMatch(/^USER 10001:10001$/m);
  });

  it("is reachable only by the worker, on an internal network without a route out, and publishes no port", () => {
    expect(scanner.networks).toEqual(["scan"]);
    expect(compose.networks.scan).toEqual({ internal: true });
    const onScan = Object.entries(compose.services).filter(([, service]) => (service.networks as string[]).includes("scan")).map(([name]) => name).sort();
    expect(onScan).toEqual(["clamav", "worker"]);
    expect(scanner).not.toHaveProperty("ports");
    expect(scanner).not.toHaveProperty("expose");
    // The worker's way out is a different network, which the scanner does not join.
    expect(compose.networks.egress).toEqual({});
    expect(scanner.networks).not.toContain("egress");
  });

  it("is found at the worker's fixed endpoint, and only a healthy scanner is used", () => {
    expect(PRODUCTION_SCANNER.host).toBe("clamav");
    expect(Object.keys(compose.services)).toContain(PRODUCTION_SCANNER.host);
    expect(read("deploy/clamav/clamd.conf")).toMatch(new RegExp(`^TCPSocket ${PRODUCTION_SCANNER.port}$`, "m"));
    expect(scanner.healthcheck).toMatchObject({ test: ["CMD", "clamdscan", "--config-file=/etc/clamav/clamd.conf", "--ping", "1"] });
    expect(worker.depends_on).toEqual({ clamav: { condition: "service_healthy" } });
  });
});

describe("the approved ClamAV engine (8B-I5.6)", () => {
  const engine = json<{ lts_line: string; production: string; approved: string[]; base_image: string; base_image_digest: string | null }>("deploy/clamav/engine.json");
  const candidate = read(".github/workflows/clamav-engine-candidate.yml");
  const migration = read("supabase/migrations/20261006000200_approved_scanner_engines.sql");

  it("production is ClamAV 1.4.6 in the approved 1.4 LTS line — one versioned source of truth", () => {
    expect(engine).toMatchObject({ lts_line: "1.4", production: "1.4.6", base_image: "docker.io/clamav/clamav:1.4.6_base" });
    expect(engine.approved).toContain(engine.production);
    for (const version of engine.approved) expect(version.startsWith(`${engine.lts_line}.`), version).toBe(true);
    expect(engine.base_image_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(approvedEngine().production).toBe(engine.production);
  });

  it("the image, the database and the verification all name the same approved engine", () => {
    expect(read("deploy/clamav/Dockerfile")).toContain(`ARG CLAMAV_BASE=${engine.base_image}\n`);
    expect(migration).toMatch(new RegExp(`values \\('ClamAV', '${engine.production.replaceAll(".", "\\.")}'`));
    expect(migration).not.toMatch(/'1\.4\.3'/);
    expect(read("scripts/verify-clamav-scanner.ts")).toMatch(/arg\("engine", approvedEngine\(\)\.production\)/);
  });

  it("the import builds the approved engine by digest — fresh signatures never change the engine (beta L2)", () => {
    const scanner = compose.services.clamav!;
    expect((scanner.build as { args: Record<string, string> }).args).toEqual({ CLAMAV_BASE: `${engine.base_image}@${engine.base_image_digest}` });
  });

  it("an engine upgrade is a manual candidate that is tested and never deployed by itself", () => {
    expect(candidate).toMatch(/workflow_dispatch:/);
    expect(candidate).not.toMatch(/schedule:/);
    expect(candidate).not.toMatch(/update-service|register-task-definition|docker push|aws-actions|id-token/);
    expect(candidate).toMatch(/not in the approved LTS line/);
    for (const step of ["scripts/verify-clamav-scanner.ts", "src/tests/clamav-candidate.test.ts", "src/tests/worker-security-pdf.test.ts", "ipa-clamav:engine-candidate"]) {
      expect(candidate, step).toContain(step);
    }
  });

  it("the scanner revision binds engine and signature version", () => {
    expect(scannerRevision("1.4.6", "27790")).toBe("ipa-clamav:1.4.6-27790");
    expect(read("supabase/migrations/20261006000100_scanner_revision.sql")).toContain("'ipa-clamav:' || scanner_version || '-' || signature_version");
  });
});

describe("signature supply (image built right before each import)", () => {
  const dockerfile = read("deploy/clamav/Dockerfile");

  it("takes only official signatures at build time and records the build", () => {
    expect(dockerfile).toMatch(/freshclam --foreground --stdout --show-progress=no --config-file=\/etc\/clamav\/freshclam\.conf/);
    expect(dockerfile).not.toMatch(/DatabaseCustomURL|PrivateMirror|ExtraDatabase|curl |wget /);
    expect(dockerfile).toMatch(/clamscan --version > \/usr\/share\/ipa\/scanner-build\.txt/);
    expect(read("deploy/clamav/clamd.conf")).not.toMatch(/^(SelfCheck [1-9]|DatabaseMirror)/m);
  });

  it("stores no credential and downloads nothing at run time", () => {
    const instructions = dockerfile.replace(/^#.*$/gm, "");
    expect(instructions).not.toMatch(/^\s*ENV\s|secret|PASSWORD|TOKEN/im);
    // freshclam runs only in the build stage; the running container starts clamd.
    expect(dockerfile).toMatch(/^ENTRYPOINT \["clamd", "--foreground", "--config-file=\/etc\/clamav\/clamd\.conf"\]$/m);
    expect(dockerfile.slice(dockerfile.lastIndexOf("FROM "))).not.toMatch(/freshclam/);
  });

  it("technical scan failures and found infections are alarms and visible in Systemstatus (vendor-neutral, 8B-I7)", () => {
    expect(read("src/lib/observability/health.ts")).toMatch(/conditions\.set\("scanner_failures"/);
    expect(read("src/lib/observability/health.ts")).toMatch(/conditions\.set\("malware_found"/);
    expect(read("src/lib/observability/system-status.ts")).toContain("Virusscanning (24 t)");
  });

  it("has no switch anywhere to ignore stale signatures", () => {
    const sources = [
      ...readdirSync(path.join(root, "workers/ingestion"), { recursive: true }).map(String).filter((file) => file.endsWith(".ts")).map((file) => `workers/ingestion/${file}`),
      "supabase/migrations/20261005000100_upload_security.sql",
      "supabase/migrations/20261006000100_scanner_revision.sql",
      "deploy/import/compose.yaml",
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
    const state = { version: `ClamAV 1.4.6/27790/${clamdDate(new Date(T0))}` };
    const service = await scannerService(state);
    const scanner = clamdScanner({ host: "127.0.0.1", port: service.port });
    const at = (hours: number) => examineOriginal(pdf, context, { scanner, inspector, now: () => T0 + hours * HOUR });
    // The scheduled refreshes at +6 h, +12 h and +18 h fail: the old revision keeps serving.
    expect((await at(23.5)).malware).toEqual({ result: "clean", code: null, name: null });
    expect((await at(24.5)).malware).toEqual({ result: "error", code: "stale_signatures", name: null });
    expect((await at(24.5)).pdf_security.result).toBe("not_run");
    // A fresh revision replaces it at the same endpoint.
    state.version = `ClamAV 1.4.6/27801/${clamdDate(new Date(T0 + 24 * HOUR))}`;
    const fresh = await at(24.6);
    expect(fresh.malware).toEqual({ result: "clean", code: null, name: null });
    expect(fresh.scanner).toMatchObject({ engine: "ClamAV", engine_version: "1.4.6", signature_version: "27801" });
  });

  it("the build verification accepts only a fresh, pinned, working scanner — and names its revision", async () => {
    const options = { expectedEngineVersion: "1.4.6", maxBuildAgeSeconds: 8 * 3600, now: () => T0 + 2 * HOUR };
    const fresh = await scannerService({ version: `ClamAV 1.4.6/27790/${clamdDate(new Date(T0))}` });
    expect(await verifyScanner(clamdScanner({ host: "127.0.0.1", port: fresh.port }), options)).toMatchObject({
      ok: true, revision: "ipa-clamav:1.4.6-27790", engineVersion: "1.4.6", signatureVersion: "27790", signatureAgeSeconds: 7200,
    });
    expect(scannerRevision("1.4.6", "27790")).toBe("ipa-clamav:1.4.6-27790");

    const cases: [string, { version: string; detectEicar?: boolean }, RegExp][] = [
      ["stale", { version: `ClamAV 1.4.6/27790/${clamdDate(new Date(T0 - 10 * HOUR))}` }, /old/],
      ["unknown date", { version: "ClamAV 1.4.6" }, /signature time unknown/],
      ["future date", { version: `ClamAV 1.4.6/27790/${clamdDate(new Date(T0 + 5 * HOUR))}` }, /future/],
      ["unpinned engine", { version: `ClamAV 1.5.0/27790/${clamdDate(new Date(T0))}` }, /pinned/],
      ["older, unapproved patch", { version: `ClamAV 1.4.3/27790/${clamdDate(new Date(T0))}` }, /pinned/],
      ["blind scanner", { version: `ClamAV 1.4.6/27790/${clamdDate(new Date(T0))}`, detectEicar: false }, /EICAR not detected/],
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
