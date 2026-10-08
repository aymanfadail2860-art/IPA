import type { AlertSink } from "../../src/lib/observability/alerts.ts";
import { evaluateHealth, INITIAL_HEALTH_STATE, parseSystemHealth, type HealthState } from "../../src/lib/observability/health.ts";

import { errorClass, type Logger } from "./log.ts";

/**
 * The worker's scheduled health check (docs/08b §14; 8B-I7): every 5 minutes it reads
 * knowledge.worker_system_health() — counts and ids only — and raises alarms through the
 * AlertSink (dead-letter, stale queue, stuck processing, scanner failures, a found infection,
 * a suspended configuration, a quality regression).
 *
 * It runs beside the job loop on its own timer and never touches a job: a failing check is
 * logged and tried again at the next tick; it can never stop or slow processing.
 */

/** The one database call the check needs (part of the worker API). */
export interface HealthSource {
  systemHealth(): Promise<unknown>;
}

export interface HealthMonitorOptions {
  source: HealthSource;
  sink: AlertSink;
  log: Logger;
  intervalMs: number;
  now?: () => Date;
}

export interface HealthMonitor {
  /** One check now (also used by tests). Never throws. */
  tick(): Promise<void>;
  stop(): void;
}

export function createHealthMonitor(options: HealthMonitorOptions): HealthMonitor {
  let state: HealthState = INITIAL_HEALTH_STATE;
  let running: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function check(): Promise<void> {
    try {
      const health = parseSystemHealth(await options.source.systemHealth());
      const result = evaluateHealth(health, state, options.now);
      state = result.state;
      for (const alert of result.alerts) await options.sink.send(alert);
      for (const code of result.cleared) options.log({ event: "alert_cleared", code });
      options.log({
        event: "health_check",
        queued: health.queue.queued,
        running: health.queue.running,
        oldest_queued_s: health.queue.oldestQueuedSeconds,
        failed_last_24h: health.failures.failedLast24h,
        configuration_status: health.configuration?.status ?? null,
        alerts: result.alerts.length,
      });
    } catch (error) {
      options.log({ event: "health_check_failed", ...errorClass(error) });
    }
  }

  const tick = (): Promise<void> => {
    // Never two checks at once.
    running ??= check().finally(() => {
      running = null;
    });
    return running;
  };

  if (options.intervalMs > 0) {
    timer = setInterval(() => void tick(), options.intervalMs);
    timer.unref?.();
  }
  return {
    tick,
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
