import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { handleWorkerStorage, supabaseStorageDeps, type StorageClient } from "../../../supabase/functions/worker-storage/handler.ts";
import { createEmbedder } from "../../lib/knowledge/core/registry";
import { postgresOptions, postgresWorkerDb } from "../../../workers/ingestion/db.ts";
import { databaseSecurityGate } from "../../../workers/ingestion/gate.ts";
import type { LogEvent } from "../../../workers/ingestion/log.ts";
import { ticketOriginals } from "../../../workers/ingestion/originals.ts";
import { processJob, type ClaimedJob, type PipelineDeps, type WorkerDb } from "../../../workers/ingestion/pipeline.ts";
import { createWorkerRuntime } from "../../../workers/ingestion/runtime.ts";
import { runScanJob } from "../../../workers/ingestion/scan-job.ts";
import { childProcessInspector } from "../../../workers/ingestion/security/inspector.ts";
import { developmentFixtureScanner } from "../../../workers/ingestion/security/scanner.ts";
import { buildPdf, termsFixturePages } from "../fixtures/knowledge-pdfs";

import { env, integrationConfigured, signedInClient } from "./helpers";
import { RUN, runWorkerOnce, uploadVersion, workerConfigured } from "./knowledge-helpers";

/**
 * 8B-I4 — the production worker runtime against the real local database (docs/08b §21.5):
 *
 *   * the worker logs in as its blue/green role through the postgres.js adapter (prepare:false)
 *     and reaches only the I3 API;
 *   * originals come through one-time tickets redeemed by the real worker-storage handler
 *     (served locally; in production it is the Supabase Edge Function);
 *   * crash recovery: a worker "dies" at each stage, its lease runs out, another worker takes
 *     over and completes, and the old worker can no longer write;
 *   * lease loss mid-flight, heartbeat, credential and connection failures, and the real
 *     worker process (main.ts) end to end and on SIGTERM.
 *
 * 8B-I5: every version first passes the security examination (scan job, development fixture
 * scanner — local only) and the real release gate in the database.
 *
 * Needs IPA_TEST_DB_ADMIN_URL: a LOCAL admin connection (the local stack's postgres user) to
 * set throwaway passwords on the login roles and to let leases run out. Never a production URL.
 */

const adminUrl = process.env.IPA_TEST_DB_ADMIN_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const configured = integrationConfigured && workerConfigured && Boolean(adminUrl) && /@(127\.0\.0\.1|localhost):/.test(adminUrl);
const ROOT = path.resolve(__dirname, "../../..");

class SimulatedCrash extends Error {
  override name = "SimulatedCrash";
}

/** The worker process dies at `method`: before it, after it, or halfway through embeddings. */
function crashing(db: WorkerDb, method: keyof WorkerDb, mode: "before" | "after" | "partial"): WorkerDb {
  let dead = false;
  return new Proxy(db, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function" || property === "forget") return value;
      return async (...args: unknown[]) => {
        if (dead) throw new SimulatedCrash();
        if (property !== method) return value.apply(target, args);
        dead = true;
        if (mode === "before") throw new SimulatedCrash();
        if (mode === "partial") {
          const rows = args[2] as unknown[];
          await value.apply(target, [args[0], args[1], rows.slice(0, Math.ceil(rows.length / 2))]);
          throw new SimulatedCrash();
        }
        await value.apply(target, args);
        throw new SimulatedCrash();
      };
    },
  });
}

describe.skipIf(!configured)("worker runtime against the local database (8B-I4)", () => {
  let admin: Sql;
  const connections: Sql[] = [];
  const passwords = { blue: randomBytes(24).toString("hex"), green: randomBytes(24).toString("hex") };
  const target = new URL(adminUrl || "postgres://x@127.0.0.1:1/postgres");
  let server: Server;
  let storageUrl = "";
  const storageLog: Record<string, unknown>[] = [];

  const dbConfig = (color: "blue" | "green", password = passwords[color], port = Number(target.port)) => ({
    kind: "postgres" as const,
    host: target.hostname,
    port,
    database: target.pathname.slice(1) || "postgres",
    username: `ingestion_worker_login_${color}`,
    password,
    ssl: "disable" as const,
    caFile: null,
    poolMax: 2,
    connectTimeoutSeconds: 3,
    queryTimeoutMs: 30_000,
  });
  const connect = (color: "blue" | "green", password?: string, port?: number, username?: string) => {
    const sql = postgres(postgresOptions({ ...dbConfig(color, password, port), ...(username ? { username } : {}) }));
    connections.push(sql);
    return sql;
  };
  // One small pool per role (CONNECTION LIMIT 5, I3). Each adapter is its own "worker" with its
  // own process-local leases.
  const pools: Partial<Record<"blue" | "green", Sql>> = {};
  const workerDb = (color: "blue" | "green", label = `${color}-${RUN}`) =>
    postgresWorkerDb((pools[color] ??= connect(color)), label, { leaseSeconds: 60, queryTimeoutMs: 30_000 });
  // ⚠ Development fixture scanner: accepted only because the local seed allows it.
  const scanTools = () => ({ scanner: developmentFixtureScanner("test"), inspector: childProcessInspector() });
  const deps = (db: WorkerDb, log: LogEvent[] = []): PipelineDeps => ({
    db,
    originals: ticketOriginals({ db, url: storageUrl }),
    gate: databaseSecurityGate(db),
    scan: scanTools(),
    log: (event) => void log.push({ event: "job_step", ...event }),
    embedderFor: (model) => createEmbedder(model, "test"),
  });

  const expireLease = (jobId: string) => admin`update knowledge.ingestion_jobs set locked_until = now() - interval '1 second' where id = ${jobId}`;
  const versionState = async (versionId: string) => {
    const [row] = await admin`
      select v.status,
             (select count(*)::int from knowledge.document_pages p where p.document_version_id = v.id) as pages,
             (select count(*)::int from knowledge.document_chunks c where c.document_version_id = v.id) as chunks,
             (select count(*)::int from knowledge.chunk_embeddings e join knowledge.document_chunks c on c.id = e.chunk_id
                join knowledge.embedding_models m on m.id = e.embedding_model_id and m.status = 'active'
               where c.document_version_id = v.id) as embeddings,
             (select md5(coalesce(string_agg(c.content_hash || ':' || c.chunk_index, ',' order by c.chunk_index), '')) from knowledge.document_chunks c where c.document_version_id = v.id) as fingerprint,
             (select j.attempts from knowledge.ingestion_jobs j where j.document_version_id = v.id and j.kind = 'process' order by j.created_at desc limit 1) as attempts
      from knowledge.document_versions v where v.id = ${versionId}`;
    return row as { status: string; pages: number; chunks: number; embeddings: number; fingerprint: string; attempts: number };
  };
  const upload = async (label: string) => {
    const client = await signedInClient("admin");
    const version = await uploadVersion(client, await buildPdf(termsFixturePages()), { title: `Runtime ${label} ${RUN}` });
    // 8B-I5: the security examination releases the file and queues its processing job.
    const scanner = workerDb("blue", `blue-scan-${RUN}`);
    const scan = await claimOwn(scanner, version.versionId);
    expect(scan.kind).toBe("scan");
    expect(await runScanJob(scan, deps(scanner))).toBe("succeeded");
    return version;
  };
  /** Claims this test's job. A leftover job of an earlier test run is put back (retry). */
  const claimOwn = async (db: WorkerDb, versionId: string): Promise<ClaimedJob> => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const job = await db.claim();
      if (job?.version_id === versionId) return job;
      if (job) await db.fail(job.job_id, "test_skip", "Overspringes af integrationstesten.", true);
    }
    throw new Error("This test's job was not claimed.");
  };
  /** The runtime claims only this test's job, then sees an empty queue. */
  const onlyOwn = (db: WorkerDb, versionId: string): WorkerDb => {
    let claimed = false;
    return { ...db, claim: async () => (claimed ? null : ((claimed = true), claimOwn(db, versionId))) };
  };

  beforeAll(async () => {
    admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
    for (const color of ["blue", "green"] as const) {
      // Local test only: a throwaway password, never stored. Production passwords come from
      // AWS Secrets Manager and are set with psql \password (docs/08b §21.4).
      await admin.unsafe(`alter role ingestion_worker_login_${color} password '${passwords[color]}'`);
      await admin`select ops.ingestion_worker_prepare(${`ingestion_worker_login_${color}`})`;
    }
    const service = createClient(env.url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const storageDeps = supabaseStorageDeps(service as unknown as StorageClient, (entry) => void storageLog.push(entry));
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const request = new Request(`http://local${req.url}`, {
        method: req.method,
        headers: Object.fromEntries(Object.entries(req.headers).map(([key, value]) => [key, String(value)])),
        body: req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks),
      });
      const response = await handleWorkerStorage(request, storageDeps);
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(Buffer.from(await response.arrayBuffer()));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    storageUrl = `http://127.0.0.1:${address.port}/functions/v1/worker-storage`;
    // Earlier test files may leave ready jobs: the real worker drains the shared queue first.
    await runWorkerOnce();
  }, 240_000);

  afterAll(async () => {
    for (const sql of connections) await sql.end({ timeout: 2 }).catch(() => {});
    if (admin) {
      for (const color of ["blue", "green"] as const) await admin`select ops.ingestion_worker_retire(${`ingestion_worker_login_${color}`})`.catch(() => {});
      await admin.end({ timeout: 2 });
    }
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  });

  // ------------------------------------------------------------------ database adapter

  it("logs in as the blue role through postgres.js and reaches the worker API", async () => {
    const db = workerDb("blue");
    expect(Array.isArray(await db.embeddingModels())).toBe(true);
    const [row] = await admin`select count(*)::int as n from pg_stat_activity where usename = 'ingestion_worker_login_blue' and application_name = 'ipa-ingestion-worker'`;
    expect(row!.n).toBeGreaterThanOrEqual(1);
    expect(row!.n).toBeLessThanOrEqual(2);
  });

  it("is refused with credentials the database does not accept — the runtime treats it as fatal", async () => {
    // The local stack trusts loopback connections, so a wrong password cannot fail here; a role
    // that cannot log in gives the same authentication failure (28000). In production Supavisor
    // checks the password (SCRAM) and answers 28P01, which the runtime treats the same way.
    const db = postgresWorkerDb(connect("blue", "wrong-password-0000", undefined, "ingestion_worker_login_none"), "bad", { leaseSeconds: 60, queryTimeoutMs: 10_000 });
    await expect(db.claim()).rejects.toMatchObject({ code: "28000" });
    const result = await createWorkerRuntime(
      { once: false, leaseSeconds: 60, heartbeatMs: 12_000, stallMs: 600_000, idle: { initialMs: 10, maxMs: 10 }, errorBackoff: { initialMs: 10, maxMs: 10 }, shutdownGraceMs: 0 },
      { db, originals: ticketOriginals({ db, url: storageUrl }), gate: databaseSecurityGate(db), scan: scanTools(), log: () => {}, sleep: async () => {} },
    ).run();
    expect(result.reason).toBe("fatal");
  });

  it("backs off on a connection failure instead of looping", async () => {
    const db = postgresWorkerDb(connect("blue", passwords.blue, 1), "down", { leaseSeconds: 60, queryTimeoutMs: 10_000 });
    const waits: number[] = [];
    const events: LogEvent[] = [];
    const runtime = createWorkerRuntime(
      { once: false, leaseSeconds: 60, heartbeatMs: 12_000, stallMs: 600_000, idle: { initialMs: 10, maxMs: 10 }, errorBackoff: { initialMs: 1_000, maxMs: 60_000 }, shutdownGraceMs: 0 },
      {
        db,
        originals: ticketOriginals({ db, url: storageUrl }),
        gate: databaseSecurityGate(db),
        scan: scanTools(),
        log: (event) => void events.push(event),
        random: () => 0.5,
        sleep: async (ms) => {
          waits.push(ms);
          if (waits.length === 3) runtime.stop("test");
        },
      },
    );
    expect((await runtime.run()).reason).toBe("stopped");
    expect(waits).toEqual([1_000, 2_000, 4_000]);
    expect(events.filter((event) => event.event === "claim_failed").every((event) => event.code === "ECONNREFUSED")).toBe(true);
  });

  // ------------------------------------------------------------------ storage tickets

  it("downloads exactly the job's original with a one-time ticket; replay, forgery, extra fields, expiry and stale leases are refused", async () => {
    const version = await upload("tickets");
    const blue = workerDb("blue");
    const job = await claimOwn(blue, version.versionId);
    const post = (body: unknown) => fetch(storageUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

    const { ticket } = await blue.issueStorageTicket(job.job_id, "download_original");
    const ok = await post({ ticket });
    expect(ok.status).toBe(200);
    const bytes = new Uint8Array(await ok.arrayBuffer());
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(job.checksum_sha256);
    expect(ok.headers.get("x-ipa-checksum-sha256")).toBe(job.checksum_sha256);

    expect((await post({ ticket })).status).toBe(403); // replay
    expect((await post({ ticket: randomBytes(32).toString("hex") })).status).toBe(403); // forged
    const second = await blue.issueStorageTicket(job.job_id, "download_original");
    expect((await post({ ticket: second.ticket, path: "other/document.pdf" })).status).toBe(400); // arbitrary object attempt
    await admin`update knowledge.worker_storage_tickets set issued_at = now() - interval '2 minutes', expires_at = now() - interval '61 seconds'
                where token_hash = sha256(convert_to(${second.ticket}, 'UTF8'))`;
    expect((await post({ ticket: second.ticket })).status).toBe(403); // expired

    const third = await blue.issueStorageTicket(job.job_id, "download_original");
    await expireLease(job.job_id);
    const green = workerDb("green");
    const takeover = await claimOwn(green, version.versionId);
    expect((await post({ ticket: third.ticket })).status).toBe(403); // stale lease (taken over)

    expect(JSON.stringify(storageLog)).not.toContain(ticket);
    expect(JSON.stringify(storageLog)).not.toContain(third.ticket);
    expect(await green.fail(takeover.job_id, "test_cleanup", "Integrationstest af billetter.", false)).toBe("failed");
  }, 60_000);

  // ------------------------------------------------------------------ crash recovery

  const crashCases: { name: string; crash: (db: WorkerDb) => WorkerDb | null }[] = [
    { name: "after claim", crash: () => null },
    { name: "after pages", crash: (db) => crashing(db, "storePages", "after") },
    { name: "after chunks", crash: (db) => crashing(db, "storeChunks", "after") },
    { name: "mid-embedding", crash: (db) => crashing(db, "storeEmbeddings", "partial") },
    { name: "after embeddings, before complete", crash: (db) => crashing(db, "complete", "before") },
  ];

  it.each(crashCases)("recovers from a crash $name: the lease runs out, another worker completes, the old one cannot write", async ({ name, crash }) => {
    const version = await upload(`crash ${name}`);
    const blue = workerDb("blue", `blue-crash-${RUN}`);
    const job = await claimOwn(blue, version.versionId);
    const dying = crash(blue);
    if (dying) await expect(processJob(job, deps(dying))).rejects.toBeInstanceOf(SimulatedCrash);

    await expireLease(job.job_id);
    const green = workerDb("green", `green-recovery-${RUN}`);
    const resumed = await claimOwn(green, version.versionId);
    expect(resumed.job_id).toBe(job.job_id);
    expect(resumed.attempts).toBe(job.attempts + 1);
    expect(await processJob(resumed, deps(green))).toBe("succeeded");

    const after = await versionState(version.versionId);
    expect(after.status).toBe("processed");
    expect(after.chunks).toBeGreaterThan(1);
    expect(after.embeddings).toBe(after.chunks);
    expect(after.pages).toBeGreaterThan(0);

    // The old worker comes back with its old lease: every write is refused, nothing changes.
    await expect(blue.storeChunks(job.job_id, [], "x")).rejects.toMatchObject({ code: "55P03" });
    await expect(blue.complete(job.job_id, {} as never)).rejects.toMatchObject({ code: "55P03" });
    await expect(blue.fail(job.job_id, "late", "Sen fejl.", false)).rejects.toMatchObject({ code: "55P03" });
    expect(await versionState(version.versionId)).toEqual(after);
  }, 90_000);

  it("handles duplicate delivery: the job runs twice at once after a takeover — only the current lease's results count", async () => {
    const version = await upload("duplicate");
    const blue = workerDb("blue", `blue-dup-${RUN}`);
    const first = await claimOwn(blue, version.versionId);
    await expireLease(first.job_id);
    const green = workerDb("green", `green-dup-${RUN}`);
    const second = await claimOwn(green, version.versionId);
    const [old, current] = await Promise.all([processJob(first, deps(blue)), processJob(second, deps(green))]);
    expect(old).toBe("lost");
    expect(current).toBe("succeeded");
    const state = await versionState(version.versionId);
    expect(state).toMatchObject({ status: "processed", attempts: 2 });
    expect(state.embeddings).toBe(state.chunks);
  }, 90_000);

  // ------------------------------------------------------------------ heartbeat and lease loss

  it("keeps the lease alive with real heartbeats during a slow step", async () => {
    const version = await upload("heartbeat");
    const blue = workerDb("blue", `blue-hb-${RUN}`);
    let beats = 0;
    const counted: WorkerDb = { ...onlyOwn(blue, version.versionId), heartbeat: async (jobId) => (beats++, blue.heartbeat(jobId)) };
    const events: LogEvent[] = [];
    const runtime = createWorkerRuntime(
      { once: true, leaseSeconds: 60, heartbeatMs: 250, stallMs: 60_000, idle: { initialMs: 10, maxMs: 10 }, errorBackoff: { initialMs: 10, maxMs: 10 }, shutdownGraceMs: 0 },
      {
        db: counted,
        originals: ticketOriginals({ db: counted, url: storageUrl }),
        gate: databaseSecurityGate(counted),
        scan: scanTools(),
        log: (event) => void events.push(event),
        embedderFor: (model) => {
          const embedder = createEmbedder(model, "test");
          return { ...embedder, embed: async (...args: Parameters<typeof embedder.embed>) => (await new Promise((resolve) => setTimeout(resolve, 1_500)), embedder.embed(...args)) };
        },
      },
    );
    expect(await runtime.run()).toEqual({ reason: "drained", jobs: 1 });
    expect(beats).toBeGreaterThanOrEqual(4);
    expect(events.find((event) => event.event === "job_finished")).toMatchObject({ outcome: "succeeded" });
    expect((await versionState(version.versionId)).status).toBe("processed");
  }, 60_000);

  it("loses the lease mid-flight to a takeover: the old worker stops, the new worker's results stand", async () => {
    const version = await upload("lease loss");
    const blue = workerDb("blue", `blue-loss-${RUN}`);
    const green = workerDb("green", `green-loss-${RUN}`);
    const events: LogEvent[] = [];
    let takenOver = false;
    const runtime = createWorkerRuntime(
      { once: true, leaseSeconds: 60, heartbeatMs: 250, stallMs: 60_000, idle: { initialMs: 10, maxMs: 10 }, errorBackoff: { initialMs: 10, maxMs: 10 }, shutdownGraceMs: 0 },
      {
        db: onlyOwn(blue, version.versionId),
        originals: ticketOriginals({ db: blue, url: storageUrl }),
        gate: databaseSecurityGate(blue),
        scan: scanTools(),
        log: (event) => void events.push(event),
        embedderFor: (model) => {
          const embedder = createEmbedder(model, "test");
          return {
            ...embedder,
            embed: async (...args: Parameters<typeof embedder.embed>) => {
              if (!takenOver) {
                takenOver = true;
                const [row] = await admin`select id from knowledge.ingestion_jobs where document_version_id = ${version.versionId} and status = 'running'`;
                await expireLease(row!.id as string);
                const job = await claimOwn(green, version.versionId);
                expect(await processJob(job, deps(green))).toBe("succeeded");
                await new Promise((resolve) => setTimeout(resolve, 1_000));
              }
              return embedder.embed(...args);
            },
          };
        },
      },
    );
    expect((await runtime.run()).reason).toBe("drained");
    expect(events.map((event) => event.event)).toContain("lease_lost");
    expect(events.find((event) => event.event === "job_finished")).toMatchObject({ outcome: "lost" });
    const state = await versionState(version.versionId);
    expect(state).toMatchObject({ status: "processed", attempts: 2 });
    expect(state.embeddings).toBe(state.chunks);
  }, 60_000);

  // ------------------------------------------------------------------ the real process

  const workerEnv = (color: "blue" | "green", password = passwords[color]) => ({
    PATH: process.env.PATH ?? "",
    NODE_ENV: "test" as const,
    IPA_RUNTIME_ENV: "test",
    IPA_WORKER_ID: `process-${color}-${RUN}`,
    IPA_WORKER_DB_HOST: target.hostname,
    IPA_WORKER_DB_PORT: target.port,
    IPA_WORKER_DB_NAME: target.pathname.slice(1) || "postgres",
    IPA_WORKER_DB_SSL: "disable",
    IPA_WORKER_DB_USER: `ingestion_worker_login_${color}`,
    IPA_WORKER_DB_PASSWORD: password,
    IPA_WORKER_STORAGE_URL: storageUrl,
    IPA_WORKER_POLL_MS: "200",
    IPA_WORKER_POLL_MAX_MS: "400",
  });

  it("runs the real worker process (main.ts) as the green role: ticket download, pipeline, complete — logs without secrets", async () => {
    const version = await upload("process");
    const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      execFile(process.execPath, ["workers/ingestion/main.ts", "--once"], { cwd: ROOT, env: workerEnv("green"), timeout: 120_000 }, (error, stdout, stderr) =>
        resolve({ code: error ? Number((error as { code?: number }).code ?? 1) : 0, stdout, stderr }),
      );
    });
    expect(result.code, result.stderr).toBe(0);
    expect((await versionState(version.versionId)).status).toBe("processed");
    const lines = result.stdout.trim().split("\n").map((line) => JSON.parse(line) as LogEvent);
    const names = lines.map((line) => line.event);
    for (const event of ["worker_start", "worker_loop_started", "job_claimed", "job_finished", "worker_stop"]) expect(names).toContain(event);
    expect(lines.find((line) => line.event === "worker_start")).toMatchObject({ db: { kind: "postgres", role: "ingestion_worker_login_green", prepare: false } });
    expect(result.stdout).not.toContain(passwords.green);
    expect(result.stdout).not.toMatch(/\b[0-9a-f]{64}\b/);
    expect(result.stdout).not.toContain("Testprodukt");
  }, 150_000);


  it("shuts down gracefully on SIGTERM while waiting for work", async () => {
    const child = spawn(process.execPath, ["workers/ingestion/main.ts"], { cwd: ROOT, env: workerEnv("blue") });
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no idle poll: ${stdout}`)), 30_000);
      child.stdout.on("data", () => {
        if (stdout.includes("\"event\":\"no_job\"")) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    child.kill("SIGTERM");
    const code = await new Promise<number | null>((resolve) => child.on("exit", resolve));
    expect(code).toBe(0);
    const names = stdout.trim().split("\n").map((line) => (JSON.parse(line) as LogEvent).event);
    expect(names.slice(-3)).toEqual(["shutdown_requested", "worker_loop_stopped", "worker_stop"]);
  }, 60_000);

  it("after an emergency revoke the real worker refuses to run: exit code 2, nothing claimed (runs last)", async () => {
    await admin`select ops.ingestion_worker_emergency_revoke('ingestion_worker_login_blue')`;
    const result = await new Promise<{ code: number; stdout: string }>((resolve) => {
      execFile(process.execPath, ["workers/ingestion/main.ts"], { cwd: ROOT, env: workerEnv("blue"), timeout: 60_000 }, (error, stdout) =>
        resolve({ code: error ? Number((error as { code?: number }).code ?? 1) : 0, stdout }),
      );
    });
    expect(result.code).toBe(2);
    expect(result.stdout).toContain("\"event\":\"worker_startup_failed\"");
    expect(result.stdout).toContain("\"code\":\"28000\"");
    expect(result.stdout).not.toContain(passwords.blue);
    expect(result.stdout).not.toContain("job_claimed");
  }, 90_000);
});
