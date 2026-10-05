import { errorClass, type Logger } from "./log.ts";

/**
 * Keeps a job's lease alive independently of the pipeline (docs/08b §21.5).
 *
 *   * Heartbeats run on their own timer and their own pool connection, so a legitimately long
 *     step does not lose the lease.
 *   * If no progress has been made for `stallMs` (a hung provider call, a stuck step), the
 *     keeper STOPS heartbeating and aborts the job: the lease then runs out in the database and
 *     another worker takes over. Results after that are refused by the database (I3).
 *   * The database refusing a heartbeat (55P03) or the lease running out locally without a
 *     successful heartbeat means the lease is lost: the job is aborted at once.
 */

export type LeaseLossKind = "lease_lost" | "stalled";

export interface LeaseKeeperOptions {
  jobId: string;
  heartbeat: () => Promise<void>;
  intervalMs: number;
  leaseMs: number;
  stallMs: number;
  lastProgress: () => number;
  onLost: (kind: LeaseLossKind) => void;
  onBeat?: () => void;
  log: Logger;
  now?: () => number;
}

export interface LeaseKeeper {
  stop(): void;
}

export function startLeaseKeeper(options: LeaseKeeperOptions): LeaseKeeper {
  const now = options.now ?? Date.now;
  let lastSuccess = now();
  let inFlight = false;
  let stopped = false;

  const lose = (kind: LeaseLossKind, extra: Record<string, unknown> = {}) => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    options.log({ event: kind === "stalled" ? "job_stalled" : "lease_lost", job: options.jobId, ...extra });
    options.onLost(kind);
  };

  const tick = async () => {
    if (stopped || inFlight) return;
    if (now() - options.lastProgress() > options.stallMs) {
      lose("stalled", { idle_ms: now() - options.lastProgress() });
      return;
    }
    inFlight = true;
    try {
      await options.heartbeat();
      lastSuccess = now();
      options.onBeat?.();
    } catch (error) {
      const failure = errorClass(error);
      if (failure.code === "55P03" || failure.code === "42501") {
        lose("lease_lost", failure);
        return;
      }
      options.log({ event: "heartbeat_failed", job: options.jobId, ...failure });
      // Without a successful heartbeat the lease is gone once it has run its course.
      if (now() - lastSuccess >= options.leaseMs - options.intervalMs) lose("lease_lost", { reason: "no_heartbeat" });
    } finally {
      inFlight = false;
    }
  };

  const timer = setInterval(() => void tick(), options.intervalMs);
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
