import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmod, copyFile, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { handleWorkerStorage, supabaseStorageDeps, type StorageClient } from "../../../supabase/functions/worker-storage/handler.ts";
import type { StatusResult, StatusRow } from "../../../workers/import/importer.ts";
import { MANIFEST_FILE } from "../../../workers/import/manifest.ts";
import { buildPdf, termsFixturePages, type PdfPage } from "../fixtures/knowledge-pdfs";
import { eicar, rawPdf } from "../fixtures/security-pdfs";

import { env, integrationConfigured, seedUser, signedInClient } from "./helpers";
import { RUN, runProduct, runWorkerOnce, workerConfigured } from "./knowledge-helpers";

/**
 * Beta L3 — the import in its REAL Docker configuration (deploy/import/compose.yaml, the images
 * built from deploy/ingestion-worker/Dockerfile and deploy/clamav/Dockerfile): the ClamAV
 * container on the internal network, the worker container as its least-privilege login role
 * through the one-time storage tickets, and the import container as the operator's own login.
 * Only the connection to the local stack is overridden (test runtime, the local database port,
 * no TLS) — every container keeps its isolation.
 *
 * Two scanners:
 *   * the real ClamAV 1.4.6 container (IPA_TEST_CLAMAV_IMAGE, default ipa-clamav:import) with the
 *     official signatures it was built with — EICAR, signatures too old, scanner unavailable and,
 *     when the signatures are fresh, a clean file all the way to review;
 *   * a clamd protocol STAND-IN (src/tests/fixtures/clamd-stand-in.mjs) at the same endpoint for
 *     the paths that need fresh signatures where the official mirror cannot be reached — clearly
 *     not a scanner, and labelled as such in every assertion that uses it.
 *
 * Opt-in (needs Docker and the built images): IPA_TEST_IMPORT_DOCKER=1, IPA_TEST_DOCKER_HOST (the
 * host's address as the containers see it), IPA_TEST_DOCKER_API_URL (the local API at that
 * address), plus the local integration settings. Never against a hosted project.
 */

const adminUrl = process.env.IPA_TEST_DB_ADMIN_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const dockerHost = process.env.IPA_TEST_DOCKER_HOST ?? "";
const dockerApiUrl = process.env.IPA_TEST_DOCKER_API_URL ?? "";
const clamavImage = process.env.IPA_TEST_CLAMAV_IMAGE || "ipa-clamav:import";
const configured =
  process.env.IPA_TEST_IMPORT_DOCKER === "1" && integrationConfigured && workerConfigured && /@(127\.0\.0\.1|localhost):/.test(adminUrl) && Boolean(dockerHost && dockerApiUrl);

const ROOT = path.resolve(__dirname, "../../..");
const COMPOSE = path.join(ROOT, "deploy/import/compose.yaml");
const WORKER_IMAGE = "ipa-ingestion-worker:import";
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const HEADER = "fil;produkt_id;dokumenttype;titel;version;gyldig_fra;gyldig_til;sider";

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function run(command: string, args: string[], environment: Record<string, string>, timeout = 600_000): Promise<Run> {
  return new Promise((resolve) => {
    execFile(command, args, { env: environment as NodeJS.ProcessEnv, encoding: "utf8", timeout, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error ? (typeof (error as { code?: unknown }).code === "number" ? ((error as { code: number }).code) : 1) : 0;
      resolve({ code, stdout, stderr });
    });
  });
}

/** A ustar archive — here: the EICAR test file next to a marker that makes this run's file unique. */
function tar(files: Record<string, Uint8Array>): Uint8Array {
  const blocks: Buffer[] = [];
  for (const [name, data] of Object.entries(files)) {
    const header = Buffer.alloc(512);
    const field = (offset: number, length: number, value: string) => header.write(value, offset, length, "latin1");
    field(0, 100, name);
    field(100, 8, "0000644\0");
    field(108, 8, "0000000\0");
    field(116, 8, "0000000\0");
    field(124, 12, `${data.byteLength.toString(8).padStart(11, "0")}\0`);
    field(136, 12, "00000000000\0");
    field(148, 8, "        ");
    field(156, 1, "0");
    field(257, 6, "ustar\0");
    field(263, 2, "00");
    field(148, 8, `${header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0")}\0 `);
    blocks.push(header, Buffer.from(data), Buffer.alloc((512 - (data.byteLength % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return new Uint8Array(Buffer.concat(blocks));
}

async function termsPdf(marker: string): Promise<Uint8Array> {
  const pages: PdfPage[] = termsFixturePages();
  pages[0] = { ...pages[0]!, lines: [{ text: `Testprodukt — fiktive vilkår (${marker} ${RUN})`, size: 9 }, ...pages[0]!.lines] };
  return buildPdf(pages);
}

describe.skipIf(!configured)("the import in its real Docker configuration (beta L3)", () => {
  const project = `ipa-import-test-${RUN}`;
  const workerPassword = randomBytes(24).toString("hex");
  let sql: Sql;
  let admin: SupabaseClient;
  let server: Server;
  let product = "";
  let work = "";
  let standIn = "";
  let importDir = "";
  let reportDir = "";
  let composeEnv: Record<string, string> = {};
  /** The storage function swaps these versions' bytes in quarantine right before their release. */
  const swapBeforeRelease = new Map<string, Uint8Array>();
  let fresh = false;
  /** Files of the real-scanner test that the stand-in test imports again (pdf-lib stamps a time, so they are built once). */
  let clean: Uint8Array;
  let down: Uint8Array;

  const overrides = (scanner: "real" | "stand-in") => path.join(work, `override-${scanner}.yaml`);
  const compose = (scanner: "real" | "stand-in", args: string[], timeout?: number) =>
    run("docker", ["compose", "-p", project, "-f", COMPOSE, "-f", overrides(scanner), ...args], composeEnv, timeout);
  const versionsOf = (checksum: string) =>
    sql`select id, document_id, status, security_state, storage_bucket from knowledge.document_versions where checksum_sha256 = ${checksum} order by uploaded_at`;
  const latestReport = async (prefix: string): Promise<unknown> => {
    // import-<time>.json, not import-journal.json.
    const names = (await readdir(reportDir)).filter((name) => new RegExp(`^${prefix}-\\d{8}T\\d{6}Z\\.json$`).test(name)).sort();
    return JSON.parse(await readFile(path.join(reportDir, names.at(-1)!), "utf8"));
  };
  const writeList = async (files: Record<string, Uint8Array>, rows: string[]) => {
    for (const [name, bytes] of Object.entries(files)) {
      await writeFile(path.join(importDir, name), bytes);
      await chmod(path.join(importDir, name), 0o644);
    }
    await writeFile(path.join(importDir, MANIFEST_FILE), `${HEADER}\n${rows.join("\n")}\n`);
    await chmod(path.join(importDir, MANIFEST_FILE), 0o644);
  };
  const row = (file: string, title: string) => `${file};${product};terms;${title} ${RUN};2026-01;2026-01-01;;`;
  const importer = async (scanner: "real" | "stand-in", command: "upload" | "status") => {
    const result = await compose(scanner, ["run", "--rm", "-T", "import", command]);
    expect(result.stdout + result.stderr).not.toContain(env.password);
    return result;
  };
  const status = async (scanner: "real" | "stand-in"): Promise<Map<string, StatusRow>> => {
    const result = await importer(scanner, "status");
    expect(result.code, result.stderr).toBe(0);
    return new Map((await latestReport("status") as StatusResult).rows.map((entry) => [entry.file, entry]));
  };
  const worker = async (scanner: "real" | "stand-in", extra: string[] = []) => {
    const result = await compose(scanner, ["run", "--rm", "-T", ...extra, "worker"]);
    // Never a credential, never document text in the worker's log.
    expect(result.stdout + result.stderr).not.toContain(workerPassword);
    expect(result.stdout + result.stderr).not.toContain("fiktive vilkår");
    return result;
  };
  /** Makes these versions' queued jobs due now (a retry waits otherwise). */
  const due = (versionIds: string[]) => sql`update knowledge.ingestion_jobs set next_attempt_at = now() where status = 'queued' and document_version_id = any(${versionIds}::uuid[])`;

  beforeAll(async () => {
    sql = postgres(adminUrl, { max: 1, onnotice: () => {} });
    admin = await signedInClient("admin");
    product = await runProduct(admin, "docker");
    // Local test only: a throwaway password for the worker's login role, never stored.
    await sql.unsafe(`alter role ingestion_worker_login_blue password '${workerPassword}'`);
    await sql`select ops.ingestion_worker_prepare('ingestion_worker_login_blue')`;

    // The Edge Function worker-storage, served locally where the containers reach it.
    const service = createClient(env.url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const storageDeps = supabaseStorageDeps(service as unknown as StorageClient, () => {});
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks);
      // A safe verdict waiting for its release: the next request is that release. Someone with
      // Storage's credential replaces the bytes in quarantine first.
      for (const [versionId, bytes] of swapBeforeRelease) {
        const [pending] = await sql`select v.storage_path from knowledge.security_verdicts s join knowledge.document_versions v on v.id = s.document_version_id
                                    where s.document_version_id = ${versionId} and s.final_verdict = 'safe' and s.released_at is null and s.superseded_at is null`;
        if (!pending) continue;
        swapBeforeRelease.delete(versionId);
        await service.storage.from("knowledge-intake").upload(pending.storage_path as string, bytes, { upsert: true, contentType: "application/pdf" });
      }
      const response = await handleWorkerStorage(
        new Request(`http://local${req.url}`, { method: req.method, headers: Object.fromEntries(Object.entries(req.headers).map(([key, value]) => [key, String(value)])), body: req.method === "GET" ? undefined : body }),
        storageDeps,
      );
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(Buffer.from(await response.arrayBuffer()));
    });
    await new Promise<void>((resolve) => server.listen(0, dockerHost, resolve));
    const storagePort = (server.address() as { port: number }).port;

    work = await mkdtemp(path.join(os.tmpdir(), "ipa-import-docker-"));
    standIn = path.join(work, "stand-in");
    importDir = path.join(work, "dokumenter");
    reportDir = path.join(work, "rapporter");
    for (const directory of [standIn, importDir, reportDir]) await run("mkdir", ["-p", directory], { PATH: process.env.PATH ?? "" });
    await copyFile(path.join(ROOT, "src/tests/fixtures/clamd-stand-in.mjs"), path.join(standIn, "clamd-stand-in.mjs"));
    await writeFile(path.join(standIn, "delay-ms"), "0");
    await chmod(work, 0o755);
    await chmod(standIn, 0o755);
    await chmod(importDir, 0o755);
    // The import runs as an unprivileged user and writes only here.
    await chmod(reportDir, 0o777);

    // Only the way to the local stack changes; the isolation stays the repository's.
    const common = `services:
  worker:
    image: ${WORKER_IMAGE}
    build: !reset null
    pull_policy: never
    environment:
      IPA_RUNTIME_ENV: test
      IPA_WORKER_DB_PORT: "54322"
      IPA_WORKER_DB_SSL: disable
      IPA_WORKER_LEASE_SECONDS: "60"
  import:
    environment:
      IPA_RUNTIME_ENV: test
`;
    await writeFile(overrides("real"), `${common}  clamav:
    image: ${clamavImage}
    build: !reset null
    pull_policy: never
`);
    await writeFile(overrides("stand-in"), `${common}  clamav:
    image: ${WORKER_IMAGE}
    build: !reset null
    pull_policy: never
    entrypoint: ["node", "/stand-in/clamd-stand-in.mjs"]
    volumes: ["${standIn}:/stand-in:ro"]
    healthcheck:
      test: ["CMD", "node", "-e", "require('net').connect(3310, '127.0.0.1').on('connect', () => process.exit(0)).on('error', () => process.exit(1))"]
      interval: 2s
      timeout: 2s
      retries: 10
      start_period: 2s
`);
    composeEnv = {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "/root",
      IPA_WORKER_DB_HOST: dockerHost,
      IPA_WORKER_DB_USER: "ingestion_worker_login_blue",
      IPA_WORKER_DB_PASSWORD: workerPassword,
      IPA_WORKER_STORAGE_URL: `http://${dockerHost}:${storagePort}/functions/v1/worker-storage`,
      IPA_IMPORT_SUPABASE_URL: dockerApiUrl,
      IPA_IMPORT_PUBLISHABLE_KEY: env.anonKey,
      IPA_IMPORT_EMAIL: seedUser("admin").email,
      IPA_IMPORT_PASSWORD: env.password,
      IPA_IMPORT_FOLDER: importDir,
      IPA_IMPORT_REPORTS: reportDir,
      IPA_IMPORT_UID: "1000",
      IPA_IMPORT_GID: "1000",
    };
    // Earlier test files may leave ready jobs: drain the shared queue first.
    await runWorkerOnce();
  }, 300_000);

  afterAll(async () => {
    if (composeEnv.PATH) await compose("real", ["down", "--remove-orphans", "--timeout", "5"]).catch(() => {});
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    if (sql) {
      await sql`select ops.ingestion_worker_retire('ingestion_worker_login_blue')`.catch(() => {});
      await sql.end({ timeout: 2 });
    }
    if (work) await rm(work, { recursive: true, force: true });
  }, 120_000);

  it("the containers keep their isolation: no published port, the scanner only on the internal network, no credential in an image", async () => {
    const up = await compose("real", ["up", "-d", "--wait", "clamav"], 300_000);
    expect(up.code, up.stderr).toBe(0);
    const [scanner] = JSON.parse((await run("docker", ["inspect", `${project}-clamav-1`], composeEnv)).stdout) as {
      Config: { User: string; Env: string[] };
      HostConfig: { ReadonlyRootfs: boolean; CapDrop: string[]; PortBindings: Record<string, unknown>; SecurityOpt: string[] };
      NetworkSettings: { Networks: Record<string, unknown>; Ports: Record<string, unknown[] | null> };
    }[];
    expect(scanner!.Config.User).toBe("10001:10001");
    expect(scanner!.HostConfig.ReadonlyRootfs).toBe(true);
    expect(scanner!.HostConfig.CapDrop).toEqual(["ALL"]);
    expect(scanner!.HostConfig.SecurityOpt).toEqual(["no-new-privileges:true"]);
    expect(scanner!.HostConfig.PortBindings ?? {}).toEqual({});
    expect(Object.values(scanner!.NetworkSettings.Ports ?? {}).every((binding) => binding === null)).toBe(true);
    expect(Object.keys(scanner!.NetworkSettings.Networks)).toEqual([`${project}_scan`]);
    expect(scanner!.Config.Env.join(" ")).not.toMatch(/IPA_|PASSWORD|KEY|TOKEN|SUPABASE/);
    const [network] = JSON.parse((await run("docker", ["network", "inspect", `${project}_scan`], composeEnv)).stdout) as { Internal: boolean }[];
    expect(network!.Internal).toBe(true);

    for (const image of [WORKER_IMAGE, clamavImage]) {
      const [inspect] = JSON.parse((await run("docker", ["image", "inspect", image], composeEnv)).stdout) as { Config: { Env: string[]; User: string } }[];
      expect(inspect!.Config.Env.join(" "), image).not.toMatch(/PASSWORD|SECRET|SERVICE_ROLE|TOKEN|_KEY=|NODE_EXTRA_CA_CERTS/);
      expect(inspect!.Config.User, image).toMatch(/^(node|10001:10001)$/);
      const history = (await run("docker", ["history", "--no-trunc", "--format", "{{.CreatedBy}}", image], composeEnv)).stdout;
      expect(history, image).not.toMatch(/PASSWORD|SECRET|SERVICE_ROLE|--mount=type=secret|eyJ[A-Za-z0-9_-]{10,}\./);
      const pdfs = await run("docker", ["run", "--rm", "--network", "none", "--entrypoint", "find", image, "/", "-xdev", "-iname", "*.pdf"], composeEnv);
      expect(pdfs.stdout.trim(), image).toBe("");
    }
  }, 600_000);

  it("the real ClamAV container: the check refuses stale signatures, EICAR is rejected, a clean file waits for fresh signatures, a stopped scanner blocks", async () => {
    // The import's scanner check, from the worker's service (deploy/import/ipa-import.sh).
    const check = await compose("real", ["run", "--rm", "-T", "--entrypoint", "node", "worker", "scripts/verify-clamav-scanner.ts", "--host", "clamav", "--port", "3310"]);
    const verdict = JSON.parse(check.stdout.trim().split("\n").at(-1)!) as { ok: boolean; problems?: string[]; engineVersion?: string };
    fresh = verdict.ok;
    if (fresh) expect(verdict).toMatchObject({ ok: true, engineVersion: "1.4.6" });
    else {
      // The engine is the approved one and EICAR is found — only the age refuses it.
      expect(check.code).toBe(1);
      expect(verdict.problems).toEqual([expect.stringMatching(/^signatures are \d+ h old \(limit 8 h\)$/)]);
    }

    // Malware disguised as a PDF: the EICAR test file inside an archive, unique to this run.
    const eicarBytes = tar({ "eicar.com": new TextEncoder().encode(eicar()), "marker.txt": new TextEncoder().encode(RUN) });
    clean = await termsPdf("ren-clamav");
    down = await termsPdf("scanner-nede");
    await writeList({ "eicar.pdf": eicarBytes, "ren.pdf": clean }, [row("eicar.pdf", "EICAR"), row("ren.pdf", "Ren")]);
    const upload = await importer("real", "upload");
    expect(upload.code, upload.stdout).toBe(0);
    const ran = await worker("real");
    expect(ran.code, ran.stderr).toBe(0);

    const report = await status("real");
    expect(report.get("eicar.pdf")).toMatchObject({ category: "security_rejected", security: "Afvist: malware" });
    const [eicarVerdict] = await sql`select s.malware_result, s.scanner_engine, s.scanner_version, s.malware_name from knowledge.security_verdicts s
                                     join knowledge.document_versions v on v.id = s.document_version_id where v.checksum_sha256 = ${sha(eicarBytes)}
                                     and s.scanner_engine = 'ClamAV' order by s.created_at desc limit 1`;
    expect(eicarVerdict).toMatchObject({ malware_result: "infected", scanner_engine: "ClamAV", scanner_version: "1.4.6" });
    expect(eicarVerdict!.malware_name).toMatch(/eicar/i);

    const [cleanVersion] = await versionsOf(sha(clean));
    if (fresh) {
      expect(report.get("ren.pdf")).toMatchObject({ category: "ready_for_review", completeness: { complete: true } });
    } else {
      // Signatures older than 24 hours: never released, never processed — retried once they are fresh.
      expect(report.get("ren.pdf")).toMatchObject({ category: "scan_failed", messages: [expect.stringMatching(/ældre end 24 timer/), expect.any(String)] });
      expect(cleanVersion).toMatchObject({ security_state: "scan_failed", storage_bucket: "knowledge-intake" });
    }

    // The scanner stops: blocked, never released.
    await writeList({ "nede.pdf": down }, [row("nede.pdf", "Nede")]);
    expect((await importer("real", "upload")).code).toBe(0);
    expect((await compose("real", ["stop", "clamav"])).code).toBe(0);
    expect((await worker("real", ["--no-deps"])).code).toBe(0);
    expect((await status("real")).get("nede.pdf")).toMatchObject({ category: "scan_failed", messages: [expect.stringMatching(/Scanneren svarer ikke/), expect.any(String)] });
    const [blocked] = await versionsOf(sha(down));
    expect(blocked).toMatchObject({ security_state: "scan_failed", storage_bucket: "knowledge-intake" });
    expect(["processed", "under_review", "published"]).not.toContain(blocked!.status);
    const [pages] = await sql`select count(*)::int as n from knowledge.document_pages where document_version_id = any(${[cleanVersion!.id, blocked!.id]}::uuid[])`;
    expect(pages!.n).toBe(fresh ? 4 : 0);
  }, 900_000);

  it("[stand-in scanner with fresh signatures] a blocked file is released on retry; changed bytes, broken and encrypted PDFs are refused", async () => {
    const up = await compose("stand-in", ["up", "-d", "--wait", "clamav"], 120_000);
    expect(up.code, up.stderr).toBe(0);
    const changed = await termsPdf("aendret-docker");
    const whole = await termsPdf("oedelagt-docker");
    const broken = whole.subarray(0, Math.floor(whole.byteLength / 3));
    const encrypted = rawPdf({ trailer: "/Encrypt 5 0 R /ID [<00> <00>]", objects: ["<< /Filter /Standard /V 2 /R 3 /O <00> /U <00> /P -4 >>", `(docker ${RUN})`] });
    await writeList({ "ren.pdf": clean, "nede.pdf": down, "aendret.pdf": changed, "oedelagt.pdf": broken, "krypteret.pdf": encrypted }, [
      row("ren.pdf", "Ren"), row("nede.pdf", "Nede"), row("aendret.pdf", "Ændret"), row("oedelagt.pdf", "Ødelagt"), row("krypteret.pdf", "Krypteret"),
    ]);
    // A repeated import sends nothing for the two files already registered.
    const upload = await importer("stand-in", "upload");
    expect(upload.code, upload.stdout).toBe(0);
    const imported = await latestReport("import") as { rows: { file: string; outcome: string; versionId?: string }[] };
    expect(Object.fromEntries(imported.rows.map((entry) => [entry.file, entry.outcome]))).toEqual({
      "ren.pdf": "exists", "nede.pdf": "exists", "aendret.pdf": "imported", "oedelagt.pdf": "imported", "krypteret.pdf": "imported",
    });
    for (const bytes of [clean, down]) expect(await versionsOf(sha(bytes))).toHaveLength(1);
    const changedId = imported.rows.find((entry) => entry.file === "aendret.pdf")!.versionId!;
    swapBeforeRelease.set(changedId, await termsPdf("manipuleret-docker"));
    await due([(await versionsOf(sha(clean)))[0]!.id, (await versionsOf(sha(down)))[0]!.id]);

    expect((await worker("stand-in")).code).toBe(0);
    // The changed file's verdict is void; its scan is retried — make it due and scan again.
    await due([changedId]);
    expect((await worker("stand-in")).code).toBe(0);

    const report = await status("stand-in");
    for (const file of ["ren.pdf", "nede.pdf"]) expect(report.get(file), file).toMatchObject({ category: "ready_for_review", completeness: { complete: true, pages: 4, originalMatches: true } });
    expect(report.get("aendret.pdf")).toMatchObject({ category: "security_rejected" });
    const [voided] = await sql`select count(*)::int as n from knowledge.security_verdicts where document_version_id = ${changedId} and superseded_reason = 'checksum_changed'`;
    expect(voided!.n).toBe(1);
    const [rejected] = await sql`select failure_code from knowledge.security_verdicts where document_version_id = ${changedId} order by created_at desc limit 1`;
    expect(rejected!.failure_code).toBe("checksum_mismatch");
    expect(report.get("krypteret.pdf")).toMatchObject({ category: "security_rejected", security: "Afvist: ugyldig PDF" });
    expect(["security_rejected", "processing_failed"]).toContain(report.get("oedelagt.pdf")!.category);
    for (const file of ["aendret.pdf", "oedelagt.pdf", "krypteret.pdf"]) {
      const [pages] = await sql`select count(*)::int as n from knowledge.document_pages where document_version_id = ${report.get(file)!.versionId!}`;
      expect(pages!.n, file).toBe(0);
    }
  }, 900_000);

  it("[stand-in scanner] a worker stopped mid-scan resumes safely; a person approves; the whole version is read back — nothing is published by itself", async () => {
    const bytes = await termsPdf("afbrudt-docker");
    await writeList({ "afbrudt.pdf": bytes }, [`afbrudt.pdf;${product};terms;Afbrudt ${RUN};2026-01;2026-01-01;;4`]);
    expect((await importer("stand-in", "upload")).code).toBe(0);
    const [version] = await versionsOf(sha(bytes));

    // The scan hangs; the worker container is killed while it holds the job. Other ready jobs
    // wait meanwhile, so this is the job it takes.
    await sql`update knowledge.ingestion_jobs set next_attempt_at = now() + interval '45 minutes' where status = 'queued' and document_version_id <> ${version!.id}`;
    await writeFile(path.join(standIn, "delay-ms"), "60000");
    const started = await compose("stand-in", ["run", "-d", "--name", `${project}-worker-killed`, "worker"]);
    expect(started.code, started.stderr).toBe(0);
    let claimed = false;
    for (let attempt = 0; attempt < 60 && !claimed; attempt += 1) {
      const [job] = await sql`select status, locked_by from knowledge.ingestion_jobs where document_version_id = ${version!.id} and kind = 'scan' order by created_at desc limit 1`;
      claimed = job?.status === "running" && Boolean(job.locked_by);
      if (!claimed) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(claimed).toBe(true);
    expect((await run("docker", ["kill", `${project}-worker-killed`], composeEnv)).code).toBe(0);
    await run("docker", ["rm", "-f", `${project}-worker-killed`], composeEnv);
    await writeFile(path.join(standIn, "delay-ms"), "0");
    await sql`update knowledge.ingestion_jobs set next_attempt_at = now() where status = 'queued' and next_attempt_at > now() + interval '40 minutes'`;
    expect((await versionsOf(sha(bytes)))[0]).toMatchObject({ security_state: "scanning", storage_bucket: "knowledge-intake" });

    // Its lease runs out (here: at once); the next run takes the job over and finishes it.
    await sql`update knowledge.ingestion_jobs set locked_until = now() - interval '1 second' where document_version_id = ${version!.id} and status = 'running'`;
    expect((await worker("stand-in")).code).toBe(0);
    let report = await status("stand-in");
    expect(report.get("afbrudt.pdf")).toMatchObject({ category: "ready_for_review", completeness: { complete: true, pages: 4 } });
    expect((await versionsOf(sha(bytes)))[0]!.status).toBe("processed");

    // A person approves in Admin; then the status proves the whole published version.
    expect((await admin.schema("knowledge").rpc("start_review", { p_version_id: version!.id })).error).toBeNull();
    expect((await admin.schema("knowledge").rpc("approve_version", { p_version_id: version!.id, p_acknowledged_warnings: ["no_grants"] })).error).toBeNull();
    report = await status("stand-in");
    expect(report.get("afbrudt.pdf")).toMatchObject({ category: "published", completeness: { complete: true, pages: 4, pagesWithText: 4, originalMatches: true } });
    expect((await admin.schema("knowledge").from("document_access_grants").insert({ document_id: version!.document_id, permission_key: "knowledge.document.read", grantee_type: "all_users" })).error).toBeNull();
    const adviser = await signedInClient("advisorA");
    const read = await adviser.schema("knowledge").rpc("product_document_chunks", { p_product_id: product, p_document_ids: [version!.document_id] });
    // The grant served only this read: other tests (pgTAP) expect advisers without grants to see nothing.
    await sql`delete from knowledge.document_access_grants where document_id = ${version!.document_id as string} and grantee_type = 'all_users'`;
    expect(read.error).toBeNull();
    const chunks = read.data as { page_start: number; page_end: number; version_chunk_count: number }[];
    expect(chunks.length).toBe(chunks[0]!.version_chunk_count);
    expect(new Set(chunks.flatMap((chunk) => Array.from({ length: chunk.page_end - chunk.page_start + 1 }, (_, index) => chunk.page_start + index)))).toEqual(new Set([1, 2, 3, 4]));
  }, 900_000);
});
