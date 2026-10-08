import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigError, describeConfig, loadConfig, PRODUCTION_SCANNER, type PostgresConfig } from "../../workers/ingestion/config.ts";
import { postgresOptions } from "../../workers/ingestion/db.ts";
import { startLeaseKeeper } from "../../workers/ingestion/lease.ts";
import { createLogger, redactLogEvent, type LogEvent } from "../../workers/ingestion/log.ts";
import { OriginalTooLarge, OriginalUnavailable, ticketOriginals } from "../../workers/ingestion/originals.ts";
import { JobAborted, processJob, type ClaimedJob, type PipelineDeps, type WorkerDb } from "../../workers/ingestion/pipeline.ts";
import { backoffMs, createWorkerRuntime, type RuntimeConfig } from "../../workers/ingestion/runtime.ts";
import { createEmbedder } from "../lib/knowledge/core/registry";

import { buildPdf, sha256, termsFixturePages } from "./fixtures/knowledge-pdfs";
import { blockedGate, releasedGate, securityDbDefaults, staticOriginals, unusedScanTools } from "./fixtures/worker-fakes";

/**
 * 8B-I4 — the production worker runtime (docs/08b §21.5): configuration, postgres.js options,
 * the release gate at the door (8B-I5), the job loop, the independent heartbeat, lease loss,
 * stalls, graceful shutdown and logging. No AWS account, no database.
 */

const REF = "abcdefghijklmnopqrst";
const PASSWORD = "x".repeat(32);
const production = (overrides: Record<string, string | undefined> = {}) => ({
  IPA_RUNTIME_ENV: "production",
  IPA_WORKER_DB_HOST: "aws-0-eu-central-1.pooler.supabase.com",
  IPA_WORKER_DB_PORT: "6543",
  IPA_WORKER_DB_USER: `ingestion_worker_login_green.${REF}`,
  IPA_WORKER_DB_PASSWORD: PASSWORD,
  IPA_WORKER_DB_CA_FILE: "/app/certs/supabase-ca.crt",
  IPA_WORKER_STORAGE_URL: `https://${REF}.supabase.co/functions/v1/worker-storage`,
  ...overrides,
});
const exists = () => true;
const problems = (env: Record<string, string | undefined>, fileExists = exists): string[] => {
  try {
    loadConfig(env, [], fileExists);
    return [];
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return [...(error as ConfigError).problems];
  }
};

describe("runtime configuration", () => {
  it("accepts the production configuration: Supavisor transaction mode, TLS, blue/green role, small pool", () => {
    const config = loadConfig(production(), [], exists);
    expect(config.runtimeEnv).toBe("production");
    expect(config.db).toMatchObject({ kind: "postgres", port: 6543, ssl: "verify-full", poolMax: 2, username: `ingestion_worker_login_green.${REF}` });
    expect(config.heartbeatMs).toBe(60_000);
    expect(config.leaseSeconds).toBe(300);
  });

  it("refuses the service-role key in production — the worker never runs as service_role", () => {
    expect(problems(production({ SUPABASE_SERVICE_ROLE_KEY: "eyJ.not.real" })).join(" ")).toContain("service-rollen må kun bruges lokalt og i test");
  });

  it.each([
    ["no TLS", { IPA_WORKER_DB_SSL: "disable" }, "TLS"],
    ["session mode / direct port", { IPA_WORKER_DB_PORT: "5432" }, "6543"],
    ["database owner", { IPA_WORKER_DB_USER: `postgres.${REF}` }, "IPA_WORKER_DB_USER"],
    ["service_role as user", { IPA_WORKER_DB_USER: "service_role" }, "IPA_WORKER_DB_USER"],
    ["login role without tenant suffix", { IPA_WORKER_DB_USER: "ingestion_worker_login_blue" }, "IPA_WORKER_DB_USER"],
    ["the group role", { IPA_WORKER_DB_USER: `ingestion_worker.${REF}` }, "IPA_WORKER_DB_USER"],
    ["missing password", { IPA_WORKER_DB_PASSWORD: undefined }, "IPA_WORKER_DB_PASSWORD"],
    ["missing CA", { IPA_WORKER_DB_CA_FILE: undefined }, "IPA_WORKER_DB_CA_FILE"],
    ["plain-HTTP storage endpoint", { IPA_WORKER_STORAGE_URL: "http://example.test/functions/v1/worker-storage" }, "https"],
    ["credentials in the storage URL", { IPA_WORKER_STORAGE_URL: "https://user:pw@example.test/x" }, "credentials"],
    ["a large pool", { IPA_WORKER_DB_POOL_MAX: "5" }, "IPA_WORKER_DB_POOL_MAX"],
  ])("refuses %s in production", (_name, overrides, expected) => {
    expect(problems(production(overrides)).join(" ")).toContain(expected);
  });

  it("refuses a CA file that does not exist", () => {
    expect(problems(production(), () => false).join(" ")).toContain("findes ikke");
  });

  it("never puts a value in an error or in the logged description", () => {
    const all = problems(production({ IPA_WORKER_DB_PORT: "5432", IPA_WORKER_DB_USER: "postgres" })).join(" ");
    expect(all).not.toContain(PASSWORD);
    const described = JSON.stringify(describeConfig(loadConfig(production(), [], exists)));
    expect(described).not.toContain(PASSWORD);
    expect(described).not.toContain(REF.repeat(1) + "\"");
    expect(described).toContain("\"prepare\":false");
  });

  it("allows the local/test database path without TLS, and the development service-role path only there", () => {
    const local = loadConfig(
      { IPA_RUNTIME_ENV: "test", IPA_WORKER_DB_HOST: "127.0.0.1", IPA_WORKER_DB_PORT: "54322", IPA_WORKER_DB_SSL: "disable", IPA_WORKER_DB_USER: "ingestion_worker_login_blue", IPA_WORKER_DB_PASSWORD: PASSWORD, IPA_WORKER_STORAGE_URL: "http://127.0.0.1:9/x" },
      [],
      exists,
    );
    expect(local.db.kind).toBe("postgres");
    const dev = loadConfig({ IPA_RUNTIME_ENV: "local", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "local-key" }, ["--once"], exists);
    expect(dev.db.kind).toBe("service-role-dev");
    expect(dev.once).toBe(true);
    // 8B-I5: without a clamd, local/test use the development fixture scanner.
    expect(dev.scanner).toEqual({ kind: "development-fixture" });
  });

  it("scans only through the deployment-controlled ClamAV service in production — never any other host (8B-I5.5)", () => {
    expect(loadConfig(production(), [], exists).scanner).toEqual({ kind: "clamd", host: "clamav.ipa-worker.internal", port: 3310 });
    expect(loadConfig(production({ IPA_CLAMD_HOST: "clamav.ipa-worker.internal", IPA_CLAMD_PORT: "3310" }), [], exists).scanner).toEqual({ kind: "clamd", host: "clamav.ipa-worker.internal", port: 3310 });
    for (const overrides of [{ IPA_CLAMD_HOST: "127.0.0.1" }, { IPA_CLAMD_HOST: "evil.example.com" }, { IPA_CLAMD_HOST: "10.0.0.5" }, { IPA_CLAMD_PORT: "3311" }]) {
      expect(problems(production(overrides)).join(" "), JSON.stringify(overrides)).toContain("clamav.ipa-worker.internal:3310");
    }
    expect(PRODUCTION_SCANNER).toEqual({ host: "clamav.ipa-worker.internal", port: 3310 });
    expect(Object.isFrozen(PRODUCTION_SCANNER)).toBe(true);
    expect(JSON.stringify(describeConfig(loadConfig(production(), [], exists)))).toContain("\"scanner\":{\"kind\":\"clamd\"");
    // Local/test may point at a local clamd.
    const local = loadConfig({ IPA_RUNTIME_ENV: "test", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "k", IPA_CLAMD_HOST: "127.0.0.1", IPA_CLAMD_PORT: "3310" }, [], exists);
    expect(local.scanner).toEqual({ kind: "clamd", host: "127.0.0.1", port: 3310 });
  });
});

describe("the scheduled health check and the alarm channel (8B-I7)", () => {
  it("checks every 5 minutes and alarms to the log by default", () => {
    const config = loadConfig(production(), [], exists);
    expect(config.healthCheckMs).toBe(300_000);
    expect(config.alerts).toEqual({ sink: "log" });
    expect(describeConfig(config)).toMatchObject({ health_check_ms: 300_000, alert_sink: "log" });
  });

  it("cannot be switched off in production, and never runs more often than every 30 seconds", () => {
    expect(problems(production({ IPA_HEALTH_CHECK_INTERVAL_MS: "0" }))).toContain("Den planlagte sundhedskontrol kan ikke slås fra i produktion (docs/08b §14).");
    expect(problems(production({ IPA_HEALTH_CHECK_INTERVAL_MS: "1000" }))).toContain("IPA_HEALTH_CHECK_INTERVAL_MS skal være 0 (slået fra) eller mindst 30000.");
    expect(loadConfig({ IPA_RUNTIME_ENV: "local", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "k", IPA_HEALTH_CHECK_INTERVAL_MS: "0" }, [], exists).healthCheckMs).toBe(0);
  });

  it("a webhook channel needs an HTTPS URL; an unknown channel is a configuration error at start", () => {
    expect(loadConfig(production({ IPA_ALERT_SINK: "webhook", IPA_ALERT_WEBHOOK_URL: "https://alerts.example.invalid/x" }), [], exists).alerts).toEqual({ sink: "webhook" });
    expect(problems(production({ IPA_ALERT_SINK: "webhook" }))).toContain("IPA_ALERT_SINK=webhook kræver IPA_ALERT_WEBHOOK_URL.");
    expect(problems(production({ IPA_ALERT_SINK: "webhook", IPA_ALERT_WEBHOOK_URL: "http://alerts.example.invalid/x" }))).toContain("IPA_ALERT_WEBHOOK_URL skal bruge HTTPS.");
    expect(problems(production({ IPA_ALERT_SINK: "pager" })).join(" ")).toMatch(/IPA_ALERT_SINK="pager" er ukendt/);
    // The URL is never logged.
    expect(JSON.stringify(describeConfig(loadConfig(production({ IPA_ALERT_SINK: "webhook", IPA_ALERT_WEBHOOK_URL: "https://alerts.example.invalid/secret-path" }), [], exists)))).not.toContain("secret-path");
  });
});

describe("postgres.js configuration", () => {
  const db: PostgresConfig = {
    kind: "postgres", host: "pooler.example", port: 6543, database: "postgres", username: `ingestion_worker_login_blue.${REF}`, password: PASSWORD,
    ssl: "verify-full", caFile: "/ca.crt", poolMax: 2, connectTimeoutSeconds: 10, queryTimeoutMs: 60_000,
  };

  it("disables prepared statements and type fetching, uses TLS with verification and a small pool", () => {
    const options = postgresOptions(db, () => "CA-PEM");
    expect(options.prepare).toBe(false);
    expect(options.fetch_types).toBe(false);
    expect(options.max).toBe(2);
    expect(options.connect_timeout).toBe(10);
    expect(options.ssl).toEqual({ ca: "CA-PEM", rejectUnauthorized: true, servername: "pooler.example" });
    expect(options.connection).toEqual({ application_name: "ipa-ingestion-worker" });
    expect(options.username).toMatch(/^ingestion_worker_login_(blue|green)\./);
  });

  it("only turns TLS off when the (local/test) configuration says so", () => {
    expect(postgresOptions({ ...db, ssl: "disable", caFile: null }).ssl).toBe(false);
  });
});

describe("the release gate at the door (8B-I5)", () => {
  it("stops a job whose version is not released: nothing is downloaded, parsed or embedded", async () => {
    const calls: string[] = [];
    const db = fakeDb(calls);
    let downloaded = false;
    const outcome = await processJob(job(), {
      db,
      gate: blockedGate(),
      originals: staticOriginals(() => ((downloaded = true), new Uint8Array())),
      log: () => {},
      embedderFor: () => {
        throw new Error("no embedder may be created");
      },
    });
    expect(outcome).toBe("failed");
    expect(downloaded).toBe(false);
    expect(calls).toEqual(["fail:security_not_released:false"]);
  });
});

// ------------------------------------------------------------------------------- helpers

function job(overrides: Partial<ClaimedJob> = {}): ClaimedJob {
  return { job_id: "job-1", version_id: "v-1", kind: "process", attempts: 1, max_attempts: 3, step_state: {}, storage_path: "a/b.pdf", checksum_sha256: "0".repeat(64), ...overrides };
}

function fakeDb(calls: string[], overrides: Partial<WorkerDb> = {}): WorkerDb {
  return {
    claim: async () => null,
    embeddingModels: async () => [],
    chunksToEmbed: async () => [],
    storeEmbeddings: async () => 0,
    verifyIndex: async () => [],
    heartbeat: async () => void calls.push("heartbeat"),
    checkpoint: async (_job, step) => void calls.push(`checkpoint:${step}`),
    storePages: async () => void calls.push("storePages"),
    storeChunks: async () => 0,
    complete: async () => void calls.push("complete"),
    fail: async (_job, code, _message, retryable) => {
      calls.push(`fail:${code}:${retryable}`);
      return retryable ? "retry" : "failed";
    },
    issueStorageTicket: async () => ({ ticket: "t".repeat(64), expiresAt: new Date() }),
    forget: () => void calls.push("forget"),
    ...securityDbDefaults(),
    ...overrides,
  };
}

const CONFIG: RuntimeConfig = {
  once: false,
  leaseSeconds: 300,
  heartbeatMs: 60_000,
  stallMs: 600_000,
  idle: { initialMs: 2_000, maxMs: 30_000 },
  errorBackoff: { initialMs: 1_000, maxMs: 60_000 },
  shutdownGraceMs: 90_000,
};

function events(): { log: (event: LogEvent) => void; list: LogEvent[]; names: () => string[] } {
  const list: LogEvent[] = [];
  return { log: (event) => void list.push(event), list, names: () => list.map((event) => event.event) };
}

/** A process function that waits for `release` (and makes no database call meanwhile). */
function blockingProcess() {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  const process = vi.fn(async (_job: ClaimedJob, deps: PipelineDeps) => {
    await released;
    await deps.db.complete(_job.job_id, {} as never);
    return "succeeded" as const;
  });
  return { process, release: () => release() };
}

describe("the pipeline never completes or fails after losing its job", () => {
  it("does not complete when the job is aborted mid-flight, even without the runtime's guard", async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    const db = fakeDb(calls, {
      verifyIndex: async () => {
        controller.abort({ kind: "lease_lost" });
        return [];
      },
    });
    const outcome = await processJob(job({ kind: "reembed" }), { db, gate: releasedGate(), originals: staticOriginals(), log: () => {}, signal: controller.signal });
    expect(outcome).toBe("lost");
    expect(calls).not.toContain("complete");
    expect(calls.some((call) => call.startsWith("fail:"))).toBe(false);
  });

  it("does not complete a processing job aborted after its last step", async () => {
    const bytes = await buildPdf(termsFixturePages());
    const calls: string[] = [];
    const controller = new AbortController();
    const db = fakeDb(calls, {
      embeddingModels: async () => [{ id: "m", provider: "test", model_name: "test-hash-embedder", model_version: "1", dimensions: 256, status: "active" }],
      verifyIndex: async () => {
        controller.abort({ kind: "stalled" });
        return [];
      },
    });
    const outcome = await processJob(job({ checksum_sha256: sha256(bytes) }), {
      db, gate: releasedGate(), originals: staticOriginals(bytes), log: () => {}, signal: controller.signal, embedderFor: (model) => createEmbedder(model, "test"),
    });
    expect(outcome).toBe("abandoned");
    expect(calls).toContain("storePages");
    expect(calls).not.toContain("complete");
  });

  it("reports a job as lost when its lease is gone by the time it would be failed", async () => {
    const db = fakeDb([], {
      embeddingModels: async () => Promise.reject(Object.assign(new Error("reset"), { code: "ECONNRESET" })),
      fail: async () => Promise.reject(Object.assign(new Error("lease"), { code: "55P03" })),
    });
    expect(await processJob(job({ kind: "reembed" }), { db, gate: releasedGate(), originals: staticOriginals(), log: () => {} })).toBe("lost");
  });
});

describe("job loop", () => {
  it("backs off exponentially with jitter on an empty queue — no busy polling", async () => {
    const waits: number[] = [];
    const sleep = async (ms: number) => {
      waits.push(ms);
      if (waits.length === 7) runtime.stop("test");
    };
    const log = events();
    const runtime = createWorkerRuntime(CONFIG, { db: fakeDb([]), originals: staticOriginals(), gate: releasedGate(), scan: unusedScanTools(), log: log.log, sleep, random: () => 0.5 });
    const result = await runtime.run();
    expect(result.reason).toBe("stopped");
    expect(waits).toEqual([2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
    expect(log.names().filter((name) => name === "no_job")).toHaveLength(7);
  });

  it("jitters the backoff within ±20 %", () => {
    expect(backoffMs(1, CONFIG.idle, () => 0)).toBe(1_600);
    expect(backoffMs(1, CONFIG.idle, () => 1)).toBe(2_400);
    expect(backoffMs(20, CONFIG.errorBackoff, () => 1)).toBe(72_000);
  });

  it("retries a database/network failure conservatively and recovers", async () => {
    const waits: number[] = [];
    let claims = 0;
    const db = fakeDb([], {
      claim: async () => {
        claims += 1;
        if (claims <= 3) throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
        runtime.stop("test");
        return null;
      },
    });
    const log = events();
    const runtime = createWorkerRuntime(CONFIG, { db, originals: staticOriginals(), gate: releasedGate(), scan: unusedScanTools(), log: log.log, sleep: async (ms) => void waits.push(ms), random: () => 0.5 });
    expect((await runtime.run()).reason).toBe("stopped");
    expect(waits.slice(0, 3)).toEqual([1_000, 2_000, 4_000]);
    expect(log.list.filter((event) => event.event === "claim_failed").map((event) => event.code)).toEqual(["ECONNREFUSED", "ECONNREFUSED", "ECONNREFUSED"]);
  });

  it.each(["28P01", "28000", "42501"])("stops at once when the identity is refused (%s) — ECS replaces the task", async (code) => {
    let claims = 0;
    const db = fakeDb([], {
      claim: async () => {
        claims += 1;
        throw Object.assign(new Error("refused"), { code });
      },
    });
    const result = await createWorkerRuntime(CONFIG, { db, originals: staticOriginals(), gate: releasedGate(), scan: unusedScanTools(), log: () => {}, sleep: async () => {} }).run();
    expect(result.reason).toBe("fatal");
    expect(claims).toBe(1);
  });

  it("drains the queue and stops with --once", async () => {
    const queue = [job({ job_id: "a" }), job({ job_id: "b" })];
    const calls: string[] = [];
    const db = fakeDb(calls, { claim: async () => queue.shift() ?? null });
    const process = vi.fn(async (claimed: ClaimedJob, deps: PipelineDeps) => {
      await deps.db.complete(claimed.job_id, {} as never);
      return "succeeded" as const;
    });
    const result = await createWorkerRuntime({ ...CONFIG, once: true }, { db, originals: staticOriginals(), gate: releasedGate(), scan: unusedScanTools(), log: () => {}, process }).run();
    expect(result).toEqual({ reason: "drained", jobs: 2 });
    expect(calls.filter((call) => call === "complete")).toHaveLength(2);
    expect(calls.filter((call) => call === "forget")).toHaveLength(2);
  });
});

describe("heartbeat, lease loss, stall and shutdown", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function runtimeWith(db: WorkerDb, process: ReturnType<typeof blockingProcess>["process"], config: Partial<RuntimeConfig> = {}) {
    let claimed = false;
    const log = events();
    const wrapped = { ...db, claim: async () => (claimed ? null : ((claimed = true), job())) } as WorkerDb;
    const liveness = vi.fn();
    const runtime = createWorkerRuntime({ ...CONFIG, once: true, ...config }, { db: wrapped, originals: staticOriginals(), gate: releasedGate(), scan: unusedScanTools(), log: log.log, process, liveness });
    return { runtime, log, liveness };
  }

  it("keeps the lease alive on its own timer during a long step, then completes", async () => {
    const calls: string[] = [];
    const blocking = blockingProcess();
    const { runtime } = runtimeWith(fakeDb(calls), blocking.process);
    const done = runtime.run();
    await vi.advanceTimersByTimeAsync(4.5 * 60_000);
    expect(calls.filter((call) => call === "heartbeat")).toHaveLength(4);
    blocking.release();
    expect(await done).toEqual({ reason: "drained", jobs: 1 });
    expect(calls).toContain("complete");
  });

  it("aborts at once when the database refuses a heartbeat (lease lost) — nothing is completed afterwards", async () => {
    const calls: string[] = [];
    const blocking = blockingProcess();
    const db = fakeDb(calls, { heartbeat: async () => Promise.reject(Object.assign(new Error("lease"), { code: "55P03" })) });
    const { runtime, log } = runtimeWith(db, blocking.process);
    const done = runtime.run();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await done).toEqual({ reason: "drained", jobs: 1 });
    expect(log.names()).toContain("lease_lost");
    expect(log.list.find((event) => event.event === "job_finished")).toMatchObject({ outcome: "lost" });
    // The old worker comes back after the step: the guarded database refuses its writes.
    blocking.release();
    await vi.advanceTimersByTimeAsync(0);
    await expect(blocking.process.mock.results[0]!.value).rejects.toBeInstanceOf(JobAborted);
    expect(calls).not.toContain("complete");
  });

  it("tolerates transient heartbeat failures, but gives up the lease before it would expire", async () => {
    const calls: string[] = [];
    const blocking = blockingProcess();
    const db = fakeDb(calls, { heartbeat: async () => Promise.reject(Object.assign(new Error("reset"), { code: "ECONNRESET" })) });
    const { runtime, log } = runtimeWith(db, blocking.process);
    const done = runtime.run();
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(log.names().filter((name) => name === "heartbeat_failed")).toHaveLength(3);
    expect(log.names()).not.toContain("lease_lost");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(log.list.find((event) => event.event === "lease_lost")).toMatchObject({ reason: "no_heartbeat" });
    expect((await done).reason).toBe("drained");
    expect(calls).not.toContain("complete");
  });

  it("stops heartbeating a stalled job (a hung call) so the lease can expire, and stops reporting liveness for it", async () => {
    const calls: string[] = [];
    const hung = vi.fn(() => new Promise<never>(() => {}));
    const { runtime, log, liveness } = runtimeWith(fakeDb(calls), hung as never, { stallMs: 120_000 });
    const done = runtime.run();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(log.names()).toContain("job_stalled");
    expect(log.list.find((event) => event.event === "job_finished")).toMatchObject({ outcome: "abandoned", reason: "stalled" });
    const beats = calls.filter((call) => call === "heartbeat").length;
    await vi.advanceTimersByTimeAsync(600_000);
    expect(calls.filter((call) => call === "heartbeat").length).toBe(beats);
    expect((await done).reason).toBe("drained");
    expect(liveness).toHaveBeenCalled();
  });

  it("stops claiming on shutdown and lets a running job finish within the grace period", async () => {
    const calls: string[] = [];
    const blocking = blockingProcess();
    const { runtime, log } = runtimeWith(fakeDb(calls), blocking.process, { once: false });
    const done = runtime.run();
    await vi.advanceTimersByTimeAsync(10);
    runtime.stop("SIGTERM");
    await vi.advanceTimersByTimeAsync(30_000);
    blocking.release();
    expect(await done).toEqual({ reason: "stopped", jobs: 1 });
    expect(calls).toContain("complete");
    expect(log.names()).toContain("shutdown_requested");
  });

  it("abandons a job that outlives the grace period — never a fake completion or a failure", async () => {
    const calls: string[] = [];
    const blocking = blockingProcess();
    const { runtime, log } = runtimeWith(fakeDb(calls), blocking.process, { once: false });
    const done = runtime.run();
    await vi.advanceTimersByTimeAsync(10);
    runtime.stop("SIGTERM");
    await vi.advanceTimersByTimeAsync(CONFIG.shutdownGraceMs + 1);
    expect(await done).toEqual({ reason: "stopped", jobs: 1 });
    expect(log.list.find((event) => event.event === "job_finished")).toMatchObject({ outcome: "abandoned", reason: "shutdown" });
    blocking.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.some((call) => call === "complete" || call.startsWith("fail:"))).toBe(false);
  });

  it("stops promptly on shutdown while waiting for work", async () => {
    const runtime = createWorkerRuntime(CONFIG, { db: fakeDb([]), originals: staticOriginals(), gate: releasedGate(), scan: unusedScanTools(), log: () => {} });
    const done = runtime.run();
    await vi.advanceTimersByTimeAsync(5);
    runtime.stop("SIGTERM");
    await vi.advanceTimersByTimeAsync(0);
    expect(await done).toEqual({ reason: "stopped", jobs: 0 });
  });

  it("the lease keeper never runs two heartbeats at once", async () => {
    let active = 0;
    let max = 0;
    const keeper = startLeaseKeeper({
      jobId: "j",
      heartbeat: async () => {
        active += 1;
        max = Math.max(max, active);
        await new Promise((resolve) => setTimeout(resolve, 2_500));
        active -= 1;
      },
      intervalMs: 1_000,
      leaseMs: 300_000,
      stallMs: 600_000,
      lastProgress: () => Date.now(),
      onLost: () => {},
      log: () => {},
    });
    await vi.advanceTimersByTimeAsync(10_000);
    keeper.stop();
    expect(max).toBe(1);
  });
});

describe("structured logs", () => {
  it("never writes tokens, tickets, passwords or content", () => {
    const lines: string[] = [];
    const log = createLogger({ service: "ingestion-worker" }, (line) => lines.push(line));
    const token = "ab".repeat(32);
    log({ event: "x", lease_token: token, ticket: token, password: "hunter2hunter2", text: "Forsikringen dækker", note: `token ${token} here`, nested: { query: "kunde", job: "j" } });
    const out = lines.join("\n");
    expect(out).not.toContain(token);
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("Forsikringen");
    expect(out).not.toContain("kunde");
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: "x", service: "ingestion-worker", nested: { job: "j" } });
  });

  it("redacts nested secrets and token-shaped values", () => {
    expect(redactLogEvent({ a: { password: "p", list: ["f".repeat(64)] } })).toEqual({ a: { password: "[redacted]", list: ["[redacted]"] } });
  });
});

describe("originals through a storage ticket", () => {
  const ticket = "c".repeat(64);
  const db = { issueStorageTicket: vi.fn(async () => ({ ticket, expiresAt: new Date() })) };

  it("sends only the ticket and receives the bytes of the one object", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init!.body))).toEqual({ ticket });
      expect(init!.redirect).toBe("error");
      expect(new Headers(init!.headers).get("authorization")).toBeNull();
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    });
    const store = ticketOriginals({ db, url: "https://x.test/functions/v1/worker-storage", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await store.download({ job_id: "j", storage_path: "ignored/by/the/worker.pdf" }, "download_original")).toEqual(new Uint8Array([1, 2, 3]));
    expect(db.issueStorageTicket).toHaveBeenCalledWith("j", "download_original");
    expect(String(fetchImpl.mock.calls[0]![0])).not.toContain("ignored");
  });

  it("refuses a rejected ticket and an oversized object", async () => {
    const rejected = ticketOriginals({ db, url: "https://x.test", fetchImpl: (async () => new Response("{}", { status: 403 })) as unknown as typeof fetch });
    await expect(rejected.download({ job_id: "j", storage_path: "p" }, "download_original")).rejects.toBeInstanceOf(OriginalUnavailable);
    const big = ticketOriginals({ db, url: "https://x.test", maxBytes: 2, fetchImpl: (async () => new Response(new Uint8Array([1, 2, 3]))) as unknown as typeof fetch });
    await expect(big.download({ job_id: "j", storage_path: "p" }, "download_original")).rejects.toMatchObject({ status: 413 });
  });

  it("a scan download stops one byte past the policy's limit and keeps what it read (8B-I5)", async () => {
    const store = ticketOriginals({ db, url: "https://x.test", fetchImpl: (async () => new Response(new Uint8Array(10).fill(7))) as unknown as typeof fetch });
    const error = await store.download({ job_id: "j", storage_path: "p" }, "scan_original", 4).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OriginalTooLarge);
    expect((error as OriginalTooLarge).received).toEqual(new Uint8Array(5).fill(7));
    expect(db.issueStorageTicket).toHaveBeenLastCalledWith("j", "scan_original");
  });

  it("a move returns only an outcome the database confirmed; anything else is an error", async () => {
    const respond = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    expect(await ticketOriginals({ db, url: "https://x.test", fetchImpl: respond({ outcome: "released" }) }).move({ job_id: "j", storage_path: "p" }, "release_original")).toBe("released");
    expect(db.issueStorageTicket).toHaveBeenLastCalledWith("j", "release_original");
    expect(await ticketOriginals({ db, url: "https://x.test", fetchImpl: respond({ outcome: "invalidated" }) }).move({ job_id: "j", storage_path: "p" }, "release_original")).toBe("invalidated");
    await expect(ticketOriginals({ db, url: "https://x.test", fetchImpl: respond({ outcome: "safe" }) }).move({ job_id: "j", storage_path: "p" }, "release_original")).rejects.toBeInstanceOf(OriginalUnavailable);
    await expect(ticketOriginals({ db, url: "https://x.test", fetchImpl: respond({ error: "x" }, 502) }).move({ job_id: "j", storage_path: "p" }, "quarantine_original")).rejects.toBeInstanceOf(OriginalUnavailable);
  });
});
