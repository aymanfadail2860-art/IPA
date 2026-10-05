import type { EmbeddingModelSpec, Embedder } from "../../src/lib/knowledge/core/embedding.ts";

import type { WorkerConfig } from "./config.ts";
import type { ProcessingGate } from "./gate.ts";
import { startLeaseKeeper } from "./lease.ts";
import { errorClass, type Logger } from "./log.ts";
import { isIdentityError, JobAborted, processJob, type AbortKind, type ClaimedJob, type JobOutcome, type OriginalStore, type WorkerDb } from "./pipeline.ts";

/**
 * The worker's long-running loop (docs/08b §21.5):
 *
 *   claim → process (independent heartbeat, checkpoints) → complete/fail → next job
 *
 *   * Empty queue: exponential backoff with jitter up to the maximum poll interval — never
 *     busy polling.
 *   * Database/network failure: conservative exponential backoff (1 s → 60 s), never a tight
 *     loop.
 *   * Identity refused or revoked (42501, 28P01, 28000): fatal — the process exits and ECS
 *     replaces the task (which picks up the current credential).
 *   * Shutdown (SIGTERM): stop claiming at once; a running job may continue for the grace
 *     period, after which it is abandoned — never "fake-completed". Its lease runs out and
 *     another worker resumes from the last checkpoint.
 */

export type RuntimeConfig = Pick<WorkerConfig, "once" | "leaseSeconds" | "heartbeatMs" | "stallMs" | "idle" | "errorBackoff" | "shutdownGraceMs">;

export interface RuntimeDeps {
  db: WorkerDb;
  originals: OriginalStore;
  gate: ProcessingGate;
  log: Logger;
  embedderFor?: (model: EmbeddingModelSpec) => Embedder;
  /** Injected in tests. */
  process?: typeof processJob;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
  now?: () => number;
  liveness?: () => void;
}

export type RunResult = { reason: "stopped" | "drained" | "fatal"; jobs: number };

export function backoffMs(attempt: number, range: { initialMs: number; maxMs: number }, random: () => number): number {
  const base = Math.min(range.maxMs, range.initialMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.8 + 0.4 * random()));
}

export function interruptibleSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/** Every database call of a job: refused once the job is aborted, and counted as progress. */
function guardDb(db: WorkerDb, signal: AbortSignal, onProgress: () => void): WorkerDb {
  return new Proxy(db, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function" || property === "forget") return value;
      return async (...args: unknown[]) => {
        if (signal.aborted) throw new JobAborted((signal.reason as { kind?: AbortKind })?.kind ?? "shutdown");
        const result = await value.apply(target, args);
        onProgress();
        return result;
      };
    },
  });
}

export function createWorkerRuntime(config: RuntimeConfig, deps: RuntimeDeps) {
  const sleep = deps.sleep ?? interruptibleSleep;
  const random = deps.random ?? Math.random;
  const now = deps.now ?? Date.now;
  const liveness = deps.liveness ?? (() => {});
  const run = deps.process ?? processJob;
  const wake = new AbortController();
  let stopping = false;
  let current: { job: ClaimedJob; controller: AbortController; graceTimer?: ReturnType<typeof setTimeout> } | null = null;

  async function runJob(job: ClaimedJob): Promise<JobOutcome | "fatal" | "error"> {
    const controller = new AbortController();
    let lastProgress = now();
    current = { job, controller };
    const aborted = new Promise<"aborted">((resolve) => controller.signal.addEventListener("abort", () => resolve("aborted"), { once: true }));
    const keeper = startLeaseKeeper({
      jobId: job.job_id,
      heartbeat: () => deps.db.heartbeat(job.job_id),
      intervalMs: config.heartbeatMs,
      leaseMs: config.leaseSeconds * 1000,
      stallMs: config.stallMs,
      lastProgress: () => lastProgress,
      onLost: (kind) => controller.abort({ kind }),
      onBeat: liveness,
      log: deps.log,
      now,
    });
    try {
      const processing = run(job, {
        db: guardDb(deps.db, controller.signal, () => {
          lastProgress = now();
          liveness();
        }),
        originals: deps.originals,
        gate: deps.gate,
        embedderFor: deps.embedderFor,
        signal: controller.signal,
        log: (event) => deps.log({ event: "job_step", ...event }),
      });
      // A hung call must not hold the loop: once the job is aborted, stop waiting for it.
      const first = await Promise.race([processing, aborted]);
      if (first === "aborted") {
        processing.catch(() => {});
        const kind = (controller.signal.reason as { kind?: AbortKind })?.kind ?? "shutdown";
        const outcome: JobOutcome = kind === "lease_lost" ? "lost" : "abandoned";
        deps.log({ event: "job_finished", job: job.job_id, outcome, reason: kind });
        return outcome;
      }
      deps.log({ event: "job_finished", job: job.job_id, outcome: first });
      return first;
    } catch (error) {
      if (isIdentityError(error)) {
        deps.log({ event: "worker_identity_refused", job: job.job_id, ...errorClass(error) });
        return "fatal";
      }
      // Database or network trouble mid-job: the lease will run out; resume later.
      deps.log({ event: "job_error", job: job.job_id, ...errorClass(error) });
      return "error";
    } finally {
      keeper.stop();
      if (current?.graceTimer) clearTimeout(current.graceTimer);
      deps.db.forget(job.job_id);
      current = null;
    }
  }

  return {
    get stopping() {
      return stopping;
    },
    /** Stop claiming; give a running job the grace period, then abandon it. */
    stop(reason = "signal") {
      if (stopping) return;
      stopping = true;
      deps.log({ event: "shutdown_requested", reason, running_job: current?.job.job_id ?? null });
      wake.abort();
      if (current) {
        const job = current;
        job.graceTimer = setTimeout(() => job.controller.abort({ kind: "shutdown" }), config.shutdownGraceMs);
      }
    },
    async run(): Promise<RunResult> {
      let jobs = 0;
      let idle = 0;
      let errors = 0;
      deps.log({ event: "worker_loop_started", gate: deps.gate.id });
      while (!stopping) {
        liveness();
        let job: ClaimedJob | null;
        try {
          job = await deps.db.claim();
        } catch (error) {
          if (isIdentityError(error)) {
            deps.log({ event: "worker_identity_refused", ...errorClass(error) });
            return { reason: "fatal", jobs };
          }
          errors += 1;
          const wait = backoffMs(errors, config.errorBackoff, random);
          deps.log({ event: "claim_failed", attempt: errors, backoff_ms: wait, ...errorClass(error) });
          await sleep(wait, wake.signal);
          continue;
        }
        errors = 0;
        if (!job) {
          if (config.once) return { reason: "drained", jobs };
          idle += 1;
          const wait = backoffMs(idle, config.idle, random);
          deps.log({ event: "no_job", poll_ms: wait });
          await sleep(wait, wake.signal);
          continue;
        }
        idle = 0;
        jobs += 1;
        deps.log({ event: "job_claimed", job: job.job_id, version: job.version_id, kind: job.kind, attempt: job.attempts, max_attempts: job.max_attempts });
        const outcome = await runJob(job);
        if (outcome === "fatal") return { reason: "fatal", jobs };
        if (outcome === "error") {
          errors += 1;
          await sleep(backoffMs(errors, config.errorBackoff, random), wake.signal);
        }
      }
      deps.log({ event: "worker_loop_stopped", jobs });
      return { reason: "stopped", jobs };
    },
  };
}

/**
 * The production worker while the I5 gate is closed: connected and verified, but it claims
 * nothing. It re-checks its database identity periodically (a revoked or rotated-away role
 * exits, so ECS replaces the task) and keeps its liveness fresh until it is told to stop.
 */
export async function runStandby(deps: {
  db: Pick<WorkerDb, "embeddingModels">;
  log: Logger;
  signal: AbortSignal;
  liveness?: () => void;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  tickMs?: number;
  checkEveryTicks?: number;
}): Promise<RunResult> {
  const sleep = deps.sleep ?? interruptibleSleep;
  const tickMs = deps.tickMs ?? 30_000;
  const every = deps.checkEveryTicks ?? 10;
  deps.log({ event: "worker_standby", reason: "processing_gate_closed_until_8b_i5" });
  for (let tick = 1; !deps.signal.aborted; tick += 1) {
    deps.liveness?.();
    await sleep(tickMs, deps.signal);
    if (deps.signal.aborted || tick % every !== 0) continue;
    try {
      await deps.db.embeddingModels();
    } catch (error) {
      if (isIdentityError(error)) {
        deps.log({ event: "worker_identity_refused", ...errorClass(error) });
        return { reason: "fatal", jobs: 0 };
      }
      deps.log({ event: "standby_check_failed", ...errorClass(error) });
    }
  }
  deps.log({ event: "worker_loop_stopped", jobs: 0 });
  return { reason: "stopped", jobs: 0 };
}
