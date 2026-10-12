import type { ProviderRuntime } from "../../src/lib/knowledge/providers/catalog.ts";
import { createAlertSink } from "../../src/lib/observability/alerts.ts";

import { ConfigError, describeConfig, loadConfig, type WorkerConfig } from "./config.ts";
import { connectWorkerDatabase, postgresHealthSource, postgresWorkerDb } from "./db.ts";
import { databaseSecurityGate } from "./gate.ts";
import { createHealthMonitor, type HealthSource } from "./health-monitor.ts";
import { createLiveness } from "./liveness.ts";
import { createLogger, errorClass } from "./log.ts";
import { ticketOriginals } from "./originals.ts";
import { isIdentityError, type OriginalStore, type WorkerDb } from "./pipeline.ts";
import { checkEmbeddingModels, observedRuntime, workerEmbedderFactory, workerProviderRuntime } from "./providers.ts";
import { checkEmbeddingControl, createControlGate, createControlMonitor, guardedEmbedderFor } from "./control-check.ts";
import { CONTROL_REFERENCES } from "../../src/lib/knowledge/core/control-references.ts";
import { backoffMs, createWorkerRuntime, interruptibleSleep } from "./runtime.ts";
import { childProcessInspector } from "./security/inspector.ts";
import { signatureAgeProblem } from "./security/scan.ts";
import { clamdScanner, developmentFixtureScanner, type MalwareScanner } from "./security/scanner.ts";

/**
 * Ingestion worker — standalone Node process outside the Next.js app (docs/03 §8, §14;
 * docs/08b §6.1, §21.5). Runs as a long-lived ECS Fargate task in production.
 *
 *   npm run worker:ingestion            # polls the queue
 *   npm run worker:ingestion -- --once  # processes available jobs and exits
 *
 * Production: postgres.js through Supavisor (transaction mode, TLS) as the active blue/green
 * login role, originals through one-time storage tickets. The service-role key is refused.
 * Every upload is examined in quarantine first (scan jobs: structure, the ClamAV service,
 * PDF security); processing passes the database's release gate (8B-I5).
 *
 * Local/test: the same path against the local database, or the development-only service-role
 * path of phase 7 (dev-service-role.ts). Configuration: config.ts and .env.example.
 *
 * Exit codes: 0 stopped/drained, 1 invalid configuration or startup failure, 2 identity refused.
 */

let config: WorkerConfig;
try {
  config = loadConfig(process.env, process.argv);
} catch (error) {
  const problems = error instanceof ConfigError ? error.problems : ["Ukendt fejl i konfigurationen."];
  process.stderr.write(`${JSON.stringify({ event: "worker_config_invalid", problems })}\n`);
  process.exit(1);
}

const log = createLogger({ service: "ingestion-worker", worker: config.workerLabel });
const liveness = createLiveness(config.livenessFile);
// ⚠ The development fixture scanner exists only for local/test (it throws otherwise); the
// database accepts its verdicts only where the local seed allows it.
const scanner: MalwareScanner =
  config.scanner.kind === "clamd" ? clamdScanner({ host: config.scanner.host, port: config.scanner.port }) : developmentFixtureScanner(config.runtimeEnv);
const inspector = childProcessInspector();

let db: WorkerDb;
let health: HealthSource;
let originals: OriginalStore;
let close: () => Promise<void>;
if (config.db.kind === "postgres") {
  const sql = connectWorkerDatabase(config.db);
  db = postgresWorkerDb(sql, config.workerLabel, { leaseSeconds: config.leaseSeconds, queryTimeoutMs: config.db.queryTimeoutMs });
  health = postgresHealthSource(sql, config.db.queryTimeoutMs);
  originals = ticketOriginals({ db, url: config.storageUrl! });
  close = () => sql.end({ timeout: 5 });
} else {
  // ⚠ Development-only (local/test, B-16): never loaded in production — loadConfig refuses the
  // service-role key there, and the production image does not contain this file.
  const dev = await import("./dev-service-role.ts");
  const client = dev.createDevServiceRoleClient(config.db.url, config.db.key);
  db = dev.devServiceRoleWorkerDb(client, config.workerLabel);
  health = dev.devServiceRoleHealthSource(client);
  originals = dev.devServiceRoleOriginals(client, db);
  close = async () => {};
}

const gate = databaseSecurityGate(db);
log({ event: "worker_start", gate: gate.id, ...describeConfig(config) });

// Startup: verify the database identity (the API checks it) — a few conservative retries for
// network trouble, none for a refused identity.
let models: Awaited<ReturnType<WorkerDb["embeddingModels"]>> = [];
for (let attempt = 1; ; attempt += 1) {
  try {
    models = await db.embeddingModels();
    break;
  } catch (error) {
    if (isIdentityError(error) || attempt >= 5) {
      log({ event: "worker_startup_failed", attempt, ...errorClass(error) });
      await close().catch(() => {});
      process.exit(isIdentityError(error) ? 2 : 1);
    }
    await interruptibleSleep(backoffMs(attempt, config.errorBackoff, Math.random), new AbortController().signal);
  }
}

// The embedders (8B-I8 C7): every active/candidate model resolves through the shared path —
// the production catalogue on this runtime's provider transport (the ECS task role in
// production), or the fail-closed development registry. ⚠ The fake Bedrock transport is
// development-only (local/test, refused by loadConfig in production; not in the image).
let providerRuntime: () => ProviderRuntime;
if (config.providers === "development-fake") {
  const fake = await import("./dev-fake-bedrock.ts");
  providerRuntime = () => fake.devFakeBedrockRuntime(config.runtimeEnv);
} else {
  providerRuntime = () => workerProviderRuntime(process.env);
}
// Every Bedrock call is logged as a provider_call line (kind, throttled, timeout — 8B-I8 C3).
const resolveEmbedder = workerEmbedderFactory({ environment: config.runtimeEnv, runtime: () => observedRuntime(providerRuntime(), { runtime: "worker" }, log) });
// A model the control check has stopped is refused (8B-I8 C6).
const controlGate = createControlGate();
const embedderFor = guardedEmbedderFor(resolveEmbedder, controlGate);
const alertSink = createAlertSink(process.env, "ingestion-worker");

// Fail fast (docs/07 §9.1): every active/candidate model must resolve, with its credential path
// constructible, before the job loop starts. No provider call is made here.
const embedderProblems = checkEmbeddingModels(models, embedderFor);
if (embedderProblems.length > 0) {
  log({ event: "worker_startup_failed", reason: "embedder_unavailable", models: embedderProblems });
  process.stderr.write(`worker: ${embedderProblems.map((problem) => `${problem.model} (${problem.code})`).join(", ")} kan ikke bruges i denne runtime.\n`);
  await close().catch(() => {});
  process.exit(1);
}

// The embedding control set (docs/08b §2.5, 8B-I8 C6): a deliberate provider call at startup and
// on a schedule. Does each model still answer as its approved reference? Fail → that model is
// not used, critical alarm. No approved reference yet → logged as unverified.
const controlDeps = { embedderFor: resolveEmbedder, references: CONTROL_REFERENCES, gate: controlGate, sink: alertSink, log };
await checkEmbeddingControl(models, controlDeps).catch((error: unknown) => log({ event: "embedding_control_error", ...errorClass(error) }));
const controlMonitor = config.once || config.controlCheckMs === 0
  ? null
  : createControlMonitor({ intervalMs: config.controlCheckMs, run: async () => checkEmbeddingControl(await db.embeddingModels(), controlDeps), log });

// The scanner's state at startup (not fatal: the scanner service may be redeploying —
// every scan checks again and fails closed).
const info = await scanner.info();
log(
  "error" in info
    ? { event: "scanner_status", available: false, code: info.error }
    : {
        event: "scanner_status",
        available: true,
        engine: info.engine,
        engine_version: info.engineVersion,
        signature_version: info.signatureVersion,
        signature_time: info.signatureTime?.toISOString() ?? null,
        signature_age_s: info.signatureTime ? Math.round((Date.now() - info.signatureTime.getTime()) / 1000) : null,
        signatures_current_for_24h: signatureAgeProblem(info.signatureTime, 24 * 3600, Date.now()) === null,
      },
);

// The scheduled health check (docs/08b §14, 8B-I7) beside the job loop; not in --once runs.
const monitor = config.once || config.healthCheckMs === 0
  ? null
  : createHealthMonitor({ source: health, sink: alertSink, log, intervalMs: config.healthCheckMs });
void monitor?.tick();

const runtime = createWorkerRuntime(config, { db, originals, gate, scan: { scanner, inspector }, log, liveness, embedderFor });
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => runtime.stop(signal));
const result = await runtime.run();
monitor?.stop();
controlMonitor?.stop();

await close().catch(() => {});
log({ event: "worker_stop", reason: result.reason, jobs: result.jobs });
process.exit(result.reason === "fatal" ? 2 : 0);
