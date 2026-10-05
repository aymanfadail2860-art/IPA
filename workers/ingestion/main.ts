import { createEmbedder } from "../../src/lib/knowledge/core/registry.ts";

import { ConfigError, describeConfig, loadConfig, type WorkerConfig } from "./config.ts";
import { connectWorkerDatabase, postgresWorkerDb } from "./db.ts";
import { processingGateFor } from "./gate.ts";
import { createLiveness } from "./liveness.ts";
import { createLogger, errorClass } from "./log.ts";
import { ticketOriginals } from "./originals.ts";
import { isIdentityError, type OriginalStore, type WorkerDb } from "./pipeline.ts";
import { backoffMs, createWorkerRuntime, interruptibleSleep, runStandby, type RunResult } from "./runtime.ts";

/**
 * Ingestion worker — standalone Node process outside the Next.js app (docs/03 §8, §14;
 * docs/08b §6.1, §21.5). Runs as a long-lived ECS Fargate task in production.
 *
 *   npm run worker:ingestion            # polls the queue
 *   npm run worker:ingestion -- --once  # processes available jobs and exits
 *
 * Production: postgres.js through Supavisor (transaction mode, TLS) as the active blue/green
 * login role, originals through one-time storage tickets. The service-role key is refused.
 * While the I5 gate is closed the production worker stands by and claims nothing.
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
const gate = processingGateFor(config.runtimeEnv);

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
  originals = dev.devServiceRoleOriginals(client);
  close = async () => {};
}

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
if (gate.open) {
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
}

const shutdown = new AbortController();
let result: RunResult;
if (!gate.open) {
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => shutdown.abort());
  result = config.once ? { reason: "drained", jobs: 0 } : await runStandby({ db, log, signal: shutdown.signal, liveness });
} else {
  const runtime = createWorkerRuntime(config, { db, originals, gate, log, liveness });
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => runtime.stop(signal));
  result = await runtime.run();
}

await close().catch(() => {});
log({ event: "worker_stop", reason: result.reason, jobs: result.jobs });
process.exit(result.reason === "fatal" ? 2 : 0);
