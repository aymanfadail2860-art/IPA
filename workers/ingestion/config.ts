import { existsSync } from "node:fs";

import { runtimeEnv, type RuntimeEnv } from "../../src/lib/knowledge/core/grade.ts";

/**
 * The worker's runtime configuration (docs/08b §21.5), validated before anything connects.
 *
 *   * Production (IPA_RUNTIME_ENV missing or anything but local/test): the worker connects
 *     directly to Postgres through Supavisor in TRANSACTION mode (port 6543) with TLS
 *     (verify-full against the Supabase CA) as the active blue/green login role. The credential
 *     is injected by ECS from AWS Secrets Manager (IPA_WORKER_DB_USER/IPA_WORKER_DB_PASSWORD).
 *     The service-role key must NOT be present.
 *   * Local/test: either the same Postgres path (TLS optional) or the development-only
 *     service-role path of phase 7 (B-16).
 *
 * Malware scanning (8B-I5, 8B-I5.5): production scans with ClamAV's clamd in its OWN ECS
 * service, reached over the private network at the deployment-controlled endpoint
 * PRODUCTION_SCANNER (clamav.ipa-worker.internal:3310, Cloud Map). Production refuses any other
 * host or port — the endpoint is part of the code and the task definition, not a setting a user
 * or an administrator can change. Local/test use clamd when IPA_CLAMD_HOST is set, otherwise the
 * development-only fixture scanner, whose verdicts the database accepts only where the local
 * seed allows it.
 *
 * Errors name the variable and the rule — never a value.
 */

export class ConfigError extends Error {
  readonly problems: readonly string[];
  constructor(problems: string[]) {
    super(`Workerens konfiguration er ugyldig: ${problems.join(" ")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

export interface PostgresConfig {
  kind: "postgres";
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  /** "verify-full" (production) or "disable" (local/test only). */
  ssl: "verify-full" | "disable";
  caFile: string | null;
  /** Small and explicit: one connection for the job, one for the independent heartbeat. */
  poolMax: number;
  connectTimeoutSeconds: number;
  /** Client-side cancel per query; the role's statement_timeout (60 s, I3) is the server side. */
  queryTimeoutMs: number;
}

export interface ServiceRoleDevConfig {
  kind: "service-role-dev";
  url: string;
  key: string;
}

/** The production scanner: the ipa-clamav ECS service, by private DNS (deploy/clamav/). Fixed. */
export const PRODUCTION_SCANNER = Object.freeze({ host: "clamav.ipa-worker.internal", port: 3310 });

export type ScannerConfig = { kind: "clamd"; host: string; port: number } | { kind: "development-fixture" };

export interface WorkerConfig {
  runtimeEnv: RuntimeEnv;
  workerLabel: string;
  once: boolean;
  db: PostgresConfig | ServiceRoleDevConfig;
  /** URL of the worker-storage Edge Function (ticket redemption); null on the dev path. */
  storageUrl: string | null;
  leaseSeconds: number;
  heartbeatMs: number;
  /** No progress (no database call) for this long while a job runs: stop heartbeating. */
  stallMs: number;
  idle: { initialMs: number; maxMs: number };
  errorBackoff: { initialMs: number; maxMs: number };
  /** After SIGTERM, how long a running job may continue before it is abandoned. */
  shutdownGraceMs: number;
  livenessFile: string | null;
  scanner: ScannerConfig;
}

/** blue/green login role, with the Supavisor tenant suffix (<role>.<project-ref>) in production. */
const PRODUCTION_USER = /^ingestion_worker_login_(blue|green)\.[a-z0-9]{20}$/;
const LOCAL_USER = /^ingestion_worker_login_(blue|green)(\.[a-z0-9]{20})?$/;
const WORKER_LABEL = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

function int(env: Record<string, string | undefined>, name: string, fallback: number, min: number, max: number, problems: string[]): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    problems.push(`${name} skal være et heltal mellem ${min} og ${max}.`);
    return fallback;
  }
  return value;
}

export function loadConfig(env: Record<string, string | undefined>, argv: readonly string[] = [], fileExists: (path: string) => boolean = existsSync): WorkerConfig {
  const problems: string[] = [];
  const environment = runtimeEnv(env.IPA_RUNTIME_ENV);
  const production = environment === "production";
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (production && serviceKey) {
    problems.push("service-rollen må kun bruges lokalt og i test (IPA_RUNTIME_ENV=local/test); SUPABASE_SERVICE_ROLE_KEY må ikke være sat i produktion.");
  }

  const workerLabel = env.IPA_WORKER_ID || `ingestion-${env.HOSTNAME || "worker"}-${process.pid}`;
  if (!WORKER_LABEL.test(workerLabel)) problems.push("IPA_WORKER_ID må kun indeholde bogstaver, tal og _.:- (højst 128 tegn).");

  let db: PostgresConfig | ServiceRoleDevConfig;
  let storageUrl: string | null = null;

  if (!production && serviceKey && !env.IPA_WORKER_DB_HOST) {
    if (!env.NEXT_PUBLIC_SUPABASE_URL) problems.push("NEXT_PUBLIC_SUPABASE_URL skal være sat på udviklingsvejen.");
    db = { kind: "service-role-dev", url: env.NEXT_PUBLIC_SUPABASE_URL ?? "", key: serviceKey };
  } else {
    const ssl = (env.IPA_WORKER_DB_SSL ?? "verify-full") as PostgresConfig["ssl"];
    if (ssl !== "verify-full" && ssl !== "disable") problems.push("IPA_WORKER_DB_SSL skal være verify-full eller disable.");
    if (production && ssl !== "verify-full") problems.push("I produktion kræves TLS med certifikatkontrol (IPA_WORKER_DB_SSL=verify-full).");
    const caFile = env.IPA_WORKER_DB_CA_FILE || null;
    if (ssl === "verify-full" && !caFile) problems.push("IPA_WORKER_DB_CA_FILE (Supabases CA) skal være sat, når TLS kræves.");
    if (ssl === "verify-full" && caFile && !fileExists(caFile)) problems.push("IPA_WORKER_DB_CA_FILE findes ikke (deploy/ingestion-worker/certs).");

    const host = env.IPA_WORKER_DB_HOST ?? "";
    if (!host) problems.push("IPA_WORKER_DB_HOST skal være sat (Supavisor).");
    const port = int(env, "IPA_WORKER_DB_PORT", 6543, 1, 65535, problems);
    if (production && port !== 6543) problems.push("I produktion forbinder workeren til Supavisor i transaktionstilstand (port 6543).");
    const username = env.IPA_WORKER_DB_USER ?? "";
    if (!(production ? PRODUCTION_USER : LOCAL_USER).test(username)) {
      problems.push(
        production
          ? "IPA_WORKER_DB_USER skal være ingestion_worker_login_blue.<projekt-ref> eller ingestion_worker_login_green.<projekt-ref>."
          : "IPA_WORKER_DB_USER skal være ingestion_worker_login_blue eller ingestion_worker_login_green.",
      );
    }
    const password = env.IPA_WORKER_DB_PASSWORD ?? "";
    if (password.length < 16) problems.push("IPA_WORKER_DB_PASSWORD mangler eller er for kort (injiceres fra Secrets Manager).");

    db = {
      kind: "postgres",
      host,
      port,
      database: env.IPA_WORKER_DB_NAME || "postgres",
      username,
      password,
      ssl,
      caFile,
      poolMax: int(env, "IPA_WORKER_DB_POOL_MAX", 2, 2, 3, problems),
      connectTimeoutSeconds: int(env, "IPA_WORKER_DB_CONNECT_TIMEOUT_S", 10, 1, 60, problems),
      queryTimeoutMs: int(env, "IPA_WORKER_DB_QUERY_TIMEOUT_MS", 60_000, 1_000, 120_000, problems),
    };

    storageUrl = env.IPA_WORKER_STORAGE_URL ?? null;
    if (!storageUrl) problems.push("IPA_WORKER_STORAGE_URL (Edge Function worker-storage) skal være sat.");
    else {
      let parsed: URL | null = null;
      try {
        parsed = new URL(storageUrl);
      } catch {
        problems.push("IPA_WORKER_STORAGE_URL er ikke en gyldig URL.");
      }
      if (parsed && production && parsed.protocol !== "https:") problems.push("IPA_WORKER_STORAGE_URL skal bruge https i produktion.");
      if (parsed && (parsed.username || parsed.password || parsed.search)) problems.push("IPA_WORKER_STORAGE_URL må ikke indeholde credentials eller parametre.");
    }
  }

  let scanner: ScannerConfig;
  if (production) {
    const host = env.IPA_CLAMD_HOST || PRODUCTION_SCANNER.host;
    const port = int(env, "IPA_CLAMD_PORT", PRODUCTION_SCANNER.port, 1, 65535, problems);
    if (host !== PRODUCTION_SCANNER.host || port !== PRODUCTION_SCANNER.port) {
      problems.push(`I produktion scanner workeren kun gennem ClamAV-tjenesten ${PRODUCTION_SCANNER.host}:${PRODUCTION_SCANNER.port} (IPA_CLAMD_HOST/IPA_CLAMD_PORT).`);
    }
    scanner = { kind: "clamd", host: PRODUCTION_SCANNER.host, port: PRODUCTION_SCANNER.port };
  } else if (env.IPA_CLAMD_HOST) {
    scanner = { kind: "clamd", host: env.IPA_CLAMD_HOST, port: int(env, "IPA_CLAMD_PORT", 3310, 1, 65535, problems) };
  } else {
    scanner = { kind: "development-fixture" };
  }

  const leaseSeconds = int(env, "IPA_WORKER_LEASE_SECONDS", 300, 60, 900, problems);
  const config: WorkerConfig = {
    runtimeEnv: environment,
    workerLabel,
    once: argv.includes("--once"),
    db,
    storageUrl,
    leaseSeconds,
    // Heartbeat five times per lease: a lease survives several missed heartbeats.
    heartbeatMs: Math.floor((leaseSeconds * 1000) / 5),
    stallMs: int(env, "IPA_WORKER_STALL_MS", 600_000, 60_000, 3_600_000, problems),
    idle: { initialMs: int(env, "IPA_WORKER_POLL_MS", 2_000, 100, 60_000, problems), maxMs: int(env, "IPA_WORKER_POLL_MAX_MS", 30_000, 100, 300_000, problems) },
    errorBackoff: { initialMs: 1_000, maxMs: 60_000 },
    shutdownGraceMs: int(env, "IPA_WORKER_SHUTDOWN_GRACE_MS", 90_000, 0, 110_000, problems),
    livenessFile: env.IPA_WORKER_LIVENESS_FILE || null,
    scanner,
  };
  if (config.idle.maxMs < config.idle.initialMs) problems.push("IPA_WORKER_POLL_MAX_MS må ikke være mindre end IPA_WORKER_POLL_MS.");
  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}

/** What may be logged about the configuration: no credentials, no URLs with secrets. */
export function describeConfig(config: WorkerConfig): Record<string, unknown> {
  const db =
    config.db.kind === "postgres"
      ? {
          kind: "postgres",
          role: config.db.username.split(".")[0],
          host: config.db.host,
          port: config.db.port,
          ssl: config.db.ssl,
          pool_max: config.db.poolMax,
          prepare: false,
        }
      : { kind: "service-role-dev" };
  const scanner = config.scanner.kind === "clamd" ? { kind: "clamd", host: config.scanner.host, port: config.scanner.port } : { kind: "development-fixture" };
  return { runtime_env: config.runtimeEnv, worker: config.workerLabel, db, scanner, lease_seconds: config.leaseSeconds, heartbeat_ms: config.heartbeatMs };
}
