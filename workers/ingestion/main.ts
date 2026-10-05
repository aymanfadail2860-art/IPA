import { createEmbedder } from "../../src/lib/knowledge/core/registry.ts";

import { ConfigError, describeConfig, loadConfig, type WorkerConfig } from "./config.ts";
import { connectWorkerDatabase, postgresWorkerDb } from "./db.ts";
import { databaseSecurityGate } from "./gate.ts";
import { createLiveness } from "./liveness.ts";
import { createLogger, errorClass } from "./log.ts";
import { ticketOriginals } from "./originals.ts";
import { isIdentityError, type OriginalStore, type WorkerDb } from "./pipeline.ts";
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
let originals: OriginalStore;
let close: () => Promise<void>;
if (config.db.kind === "postgres") {
  const sql = connectWorkerDatabase(config.db);
  db = postgresWorkerDb(sql, config.workerLabel, { leaseSeconds: config.leaseSeconds, queryTimeoutMs: config.db.queryTimeoutMs });
  originals = ticketOriginals({ db, url: config.storageUrl! });
  close = () => sql.end({ timeout: 5 });
} else {
  // ⚠ Development-only (local/test, B-16): never loaded in production — loadConfig refuses the
  // service-role key there, and the production image does not contain this file.
  const dev = await import("./dev-service-role.ts");
  const client = dev.createDevServiceRoleClient(config.db.url, config.db.key);
  db = dev.devServiceRoleWorkerDb(client, config.workerLabel);
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

// Fail fast (docs/07 §9.1): every active/candidate model needs an allowed implementation here.
for (const model of models) {
  try {
    createEmbedder(model);
  } catch (error) {
    log({ event: "worker_startup_failed", reason: "embedder_unavailable", ...errorClass(error) });
    process.stderr.write(`worker: ${(error as Error).message}\n`);
    await close().catch(() => {});
    process.exit(1);
  }
}

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

const runtime = createWorkerRuntime(config, { db, originals, gate, scan: { scanner, inspector }, log, liveness });
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => runtime.stop(signal));
const result = await runtime.run();

await close().catch(() => {});
log({ event: "worker_stop", reason: result.reason, jobs: result.jobs });
process.exit(result.reason === "fatal" ? 2 : 0);
