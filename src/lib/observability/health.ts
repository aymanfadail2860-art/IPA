import { createAlert, type Alert, type AlertCode } from "./alerts.ts";

/**
 * The scheduled health check (docs/08b §14; 8B-I7): knowledge.worker_system_health() in, alarms
 * out. Runs in the worker every 5 minutes. Pure — the caller keeps the state between ticks.
 *
 *   * A condition that persists (a stale queue, a suspended configuration, a quality regression)
 *     raises ONE alarm when it starts, not one per tick. It may be raised again after it has
 *     cleared, and once after a worker restart (the state is in memory — an alarm is never lost
 *     for the sake of deduplication).
 *   * A dead-letter job raises an alarm once per job id.
 *
 * The thresholds are those of §14.
 */

export interface SystemHealth {
  queue: { queued: number; running: number; oldestQueuedSeconds: number | null; expiredLeases: number };
  failures: { failedLast24h: number; byCodeLast24h: Record<string, number>; recentFailedJobIds: string[] };
  processing: { stuckOverOneHour: number };
  scanner: { scanFailedLast24h: number; infectedLast24h: number };
  configuration: { id: string; label: string; version: number; status: string; fingerprint: string; suspensionReason: string | null } | null;
  evaluation: {
    runId: string;
    outcome: string;
    regression: boolean;
    hardGatesPassed: boolean;
    qualityGatesPassed: boolean;
    evalSet: { id: string; version: number; checksum: string };
    gateSetChecksum: string;
    runtimeFingerprint: string;
  } | null;
}

export const HEALTH_THRESHOLDS = Object.freeze({
  /** §14: the oldest waiting job > 30 min. */
  queueStaleSeconds: 30 * 60,
});

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : Number(value ?? 0) || 0);
const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** Parses the database's answer. Anything unreadable is an error — the caller logs it. */
export function parseSystemHealth(data: unknown): SystemHealth {
  if (!isRecord(data) || !isRecord(data.queue) || !isRecord(data.failures) || !isRecord(data.processing) || !isRecord(data.scanner)) {
    throw new Error("Systemstatus kunne ikke læses.");
  }
  const { queue, failures, processing, scanner } = data;
  const configuration = isRecord(data.configuration) ? data.configuration : null;
  const evaluation = isRecord(data.evaluation) ? data.evaluation : null;
  const evalSet = evaluation && isRecord(evaluation.evalSet) ? evaluation.evalSet : {};
  return {
    queue: {
      queued: num(queue.queued),
      running: num(queue.running),
      oldestQueuedSeconds: queue.oldestQueuedSeconds === null || queue.oldestQueuedSeconds === undefined ? null : num(queue.oldestQueuedSeconds),
      expiredLeases: num(queue.expiredLeases),
    },
    failures: {
      failedLast24h: num(failures.failedLast24h),
      byCodeLast24h: isRecord(failures.byCodeLast24h) ? Object.fromEntries(Object.entries(failures.byCodeLast24h).map(([code, n]) => [code, num(n)])) : {},
      recentFailedJobIds: Array.isArray(failures.recentFailedJobIds) ? failures.recentFailedJobIds.filter((id): id is string => typeof id === "string") : [],
    },
    processing: { stuckOverOneHour: num(processing.stuckOverOneHour) },
    scanner: { scanFailedLast24h: num(scanner.scanFailedLast24h), infectedLast24h: num(scanner.infectedLast24h) },
    configuration: configuration
      ? {
          id: str(configuration.id),
          label: str(configuration.label),
          version: num(configuration.version),
          status: str(configuration.status),
          fingerprint: str(configuration.fingerprint),
          suspensionReason: typeof configuration.suspensionReason === "string" ? configuration.suspensionReason : null,
        }
      : null,
    evaluation: evaluation
      ? {
          runId: str(evaluation.runId),
          outcome: str(evaluation.outcome),
          regression: evaluation.regression === true,
          hardGatesPassed: evaluation.hardGatesPassed === true,
          qualityGatesPassed: evaluation.qualityGatesPassed === true,
          evalSet: { id: str(evalSet.id), version: num(evalSet.version), checksum: str(evalSet.checksum) },
          gateSetChecksum: str(evaluation.gateSetChecksum),
          runtimeFingerprint: str(evaluation.runtimeFingerprint),
        }
      : null,
  };
}

export interface HealthState {
  /** Conditions currently raised (persisting alarms). */
  active: ReadonlySet<AlertCode>;
  /** Dead-letter jobs already alarmed. */
  seenFailedJobs: ReadonlySet<string>;
}

export const INITIAL_HEALTH_STATE: HealthState = Object.freeze({ active: new Set<AlertCode>(), seenFailedJobs: new Set<string>() });

/** The regression's identity: evaluation set, gate set and runtime fingerprint (§21.10, I7 pkt. 2). */
function regressionDetails(health: SystemHealth): Record<string, unknown> {
  const run = health.evaluation;
  return run
    ? {
        run_id: run.runId,
        outcome: run.outcome,
        eval_set: `${run.evalSet.id}@${run.evalSet.version}`,
        eval_set_checksum: run.evalSet.checksum,
        gate_set_checksum: run.gateSetChecksum,
        runtime_fingerprint: run.runtimeFingerprint,
      }
    : {};
}

export function evaluateHealth(health: SystemHealth, state: HealthState, now: () => Date = () => new Date()): { alerts: Alert[]; state: HealthState; cleared: AlertCode[] } {
  const conditions = new Map<AlertCode, Record<string, unknown>>();
  const cfg = health.configuration;
  const run = health.evaluation;

  if (health.queue.oldestQueuedSeconds !== null && health.queue.oldestQueuedSeconds > HEALTH_THRESHOLDS.queueStaleSeconds) {
    conditions.set("queue_stale", { oldest_queued_seconds: health.queue.oldestQueuedSeconds, queued: health.queue.queued });
  }
  if (health.processing.stuckOverOneHour > 0) conditions.set("processing_stuck", { versions: health.processing.stuckOverOneHour });
  if (health.scanner.scanFailedLast24h > 0) conditions.set("scanner_failures", { scan_failed_last_24h: health.scanner.scanFailedLast24h });
  if (health.scanner.infectedLast24h > 0) conditions.set("malware_found", { infected_last_24h: health.scanner.infectedLast24h });
  if (cfg && cfg.status === "suspended") {
    conditions.set("configuration_suspended", {
      configuration_id: cfg.id,
      configuration: `${cfg.label}@${cfg.version}`,
      fingerprint: cfg.fingerprint,
      reason: cfg.suspensionReason ?? "unknown",
      ...regressionDetails(health),
    });
  }
  if (cfg && cfg.status === "active" && run && run.regression && run.hardGatesPassed && !run.qualityGatesPassed) {
    conditions.set("quality_regression", { configuration_id: cfg.id, ...regressionDetails(health) });
  }

  const alerts: Alert[] = [];
  const active = new Set<AlertCode>();
  for (const [code, details] of conditions) {
    active.add(code);
    if (!state.active.has(code)) alerts.push(createAlert(code, details, now));
  }
  const cleared = [...state.active].filter((code) => !active.has(code));

  const seen = new Set(state.seenFailedJobs);
  const fresh = health.failures.recentFailedJobIds.filter((id) => !seen.has(id));
  if (fresh.length > 0) {
    alerts.push(
      createAlert("dead_letter", {
        new_failed_jobs: fresh.length,
        job_ids: fresh.slice(0, 10).join(","),
        failed_last_24h: health.failures.failedLast24h,
        error_codes: Object.keys(health.failures.byCodeLast24h).sort().join(","),
      }, now),
    );
    for (const id of fresh) seen.add(id);
  }
  // Ids older than the database's 24-hour window are forgotten again.
  const current = new Set(health.failures.recentFailedJobIds);
  for (const id of [...seen]) if (!current.has(id)) seen.delete(id);

  return { alerts, state: { active, seenFailedJobs: seen }, cleared };
}
