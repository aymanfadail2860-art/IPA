import { describe, expect, it } from "vitest";

import { createHealthMonitor } from "../../workers/ingestion/health-monitor.ts";
import type { Alert } from "@/lib/observability/alerts";
import { evaluateHealth, INITIAL_HEALTH_STATE, parseSystemHealth, type SystemHealth } from "@/lib/observability/health";
import { systemStatusView } from "@/lib/observability/system-status";

/**
 * 8B-I7 — the scheduled health check (docs/08b §14): the system status in, alarms out. A
 * persisting condition raises one alarm when it starts; a dead-letter job one alarm per job.
 */

const now = () => new Date("2026-10-08T08:00:00.000Z");
const RUN = { runId: "run-7", outcome: "fail", classification: "quality_regression", requestedMode: "baseline", regression: true, hardGatesPassed: true, qualityGatesPassed: false, evalSet: { id: "pilot-v1", version: 1, checksum: "a".repeat(64) }, gateSetChecksum: "b".repeat(64), runtimeFingerprint: "c".repeat(64), registeredAt: "2026-10-08T07:00:00Z" };
const CONFIG = { id: "c0ffee00-0000-4000-8000-000000000001", label: "pilot", version: 3, status: "active", fingerprint: "c".repeat(64), suspensionReason: null };

function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    environment: "production",
    queue: { queued: 0, running: 0, oldestQueuedSeconds: null, expiredLeases: 0 },
    failures: { failedLast24h: 0, byCodeLast24h: {}, recentFailedJobIds: [] },
    processing: { stuckOverOneHour: 0 },
    scanner: { scanFailedLast24h: 0, infectedLast24h: 0 },
    configuration: CONFIG,
    evaluation: { ...RUN, classification: "baseline", regression: false, outcome: "pass", qualityGatesPassed: true },
    performance: null,
    ...overrides,
  };
}
const health = (overrides: Record<string, unknown> = {}): SystemHealth => parseSystemHealth(raw(overrides));
const codes = (alerts: Alert[]) => alerts.map((alert) => alert.code).sort();

describe("the alarms of §14", () => {
  it("a healthy system raises nothing", () => {
    expect(evaluateHealth(health(), INITIAL_HEALTH_STATE, now).alerts).toEqual([]);
  });

  it("the oldest waiting job over 30 minutes (not at exactly 30)", () => {
    expect(evaluateHealth(health({ queue: { queued: 2, running: 0, oldestQueuedSeconds: 1800, expiredLeases: 0 } }), INITIAL_HEALTH_STATE, now).alerts).toEqual([]);
    expect(codes(evaluateHealth(health({ queue: { queued: 2, running: 0, oldestQueuedSeconds: 1801, expiredLeases: 0 } }), INITIAL_HEALTH_STATE, now).alerts)).toEqual(["queue_stale"]);
  });

  it("stuck processing, scanner failures and a found infection", () => {
    const result = evaluateHealth(health({ processing: { stuckOverOneHour: 2 }, scanner: { scanFailedLast24h: 1, infectedLast24h: 1 } }), INITIAL_HEALTH_STATE, now);
    expect(codes(result.alerts)).toEqual(["malware_found", "processing_stuck", "scanner_failures"]);
  });

  it("a suspended configuration is critical and names the regression that suspended it", () => {
    const result = evaluateHealth(health({ configuration: { ...CONFIG, status: "suspended", suspensionReason: "hard_gate_failed" }, evaluation: { ...RUN, hardGatesPassed: false } }), INITIAL_HEALTH_STATE, now);
    const alert = result.alerts.find((entry) => entry.code === "configuration_suspended")!;
    expect(alert.severity).toBe("critical");
    expect(alert.details).toMatchObject({ reason: "hard_gate_failed", run_id: "run-7", eval_set: "pilot-v1@1", eval_set_checksum: "a".repeat(64), gate_set_checksum: "b".repeat(64), runtime_fingerprint: "c".repeat(64) });
  });

  it("a quality regression of the active configuration — by the database's classification only (8B-I7.1)", () => {
    const quality = evaluateHealth(health({ evaluation: RUN }), INITIAL_HEALTH_STATE, now).alerts;
    expect(codes(quality)).toEqual(["quality_regression"]);
    expect(quality[0]!.details).toMatchObject({ classification: "quality_regression", requested_mode: "baseline" });
    // The approving run (a baseline) and a hard-gate regression (its alarm is the suspension) are not.
    expect(evaluateHealth(health({ evaluation: { ...RUN, classification: "baseline" } }), INITIAL_HEALTH_STATE, now).alerts).toEqual([]);
    expect(evaluateHealth(health({ evaluation: { ...RUN, classification: "hard_gate_regression", hardGatesPassed: false } }), INITIAL_HEALTH_STATE, now).alerts).toEqual([]);
    // The gate flags or a stale "regression" flag do not decide; the classification does.
    expect(evaluateHealth(health({ evaluation: { ...RUN, classification: "regression" } }), INITIAL_HEALTH_STATE, now).alerts).toEqual([]);
    expect(codes(evaluateHealth(health({ evaluation: { ...RUN, regression: false } }), INITIAL_HEALTH_STATE, now).alerts)).toEqual(["quality_regression"]);
    // Nor does a missing or unknown classification raise one.
    expect(evaluateHealth(health({ evaluation: { ...RUN, classification: "something-else" } }), INITIAL_HEALTH_STATE, now).alerts).toEqual([]);
    expect(health({ evaluation: { ...RUN, classification: "something-else" } }).evaluation!.regression).toBe(false);
  });
});

describe("deduplication without losing an alarm", () => {
  it("a persisting condition raises once, clears, and can be raised again", () => {
    const stale = health({ queue: { queued: 1, running: 0, oldestQueuedSeconds: 4000, expiredLeases: 0 } });
    const first = evaluateHealth(stale, INITIAL_HEALTH_STATE, now);
    const second = evaluateHealth(stale, first.state, now);
    expect(codes(first.alerts)).toEqual(["queue_stale"]);
    expect(second.alerts).toEqual([]);
    const cleared = evaluateHealth(health(), second.state, now);
    expect(cleared.cleared).toEqual(["queue_stale"]);
    expect(codes(evaluateHealth(stale, cleared.state, now).alerts)).toEqual(["queue_stale"]);
  });

  it("dead-letter: one alarm per new job id, and ids that leave the 24-hour window are forgotten", () => {
    const failures = (ids: string[]) => health({ failures: { failedLast24h: ids.length, byCodeLast24h: { no_text: ids.length }, recentFailedJobIds: ids } });
    const first = evaluateHealth(failures(["j1", "j2"]), INITIAL_HEALTH_STATE, now);
    expect(first.alerts.map((alert) => alert.details)).toEqual([{ new_failed_jobs: 2, job_ids: "j1,j2", failed_last_24h: 2, error_codes: "no_text" }]);
    expect(evaluateHealth(failures(["j1", "j2"]), first.state, now).alerts).toEqual([]);
    const third = evaluateHealth(failures(["j3", "j1", "j2"]), first.state, now);
    expect(third.alerts[0]!.details).toMatchObject({ new_failed_jobs: 1, job_ids: "j3" });
    expect([...evaluateHealth(failures(["j3"]), third.state, now).state.seenFailedJobs]).toEqual(["j3"]);
  });

  it("an unreadable status is an error, never 'healthy'", () => {
    expect(() => parseSystemHealth(null)).toThrow("Systemstatus kunne ikke læses.");
    expect(() => parseSystemHealth({ queue: {} })).toThrow("Systemstatus kunne ikke læses.");
    // A section of the wrong shape is not read as zeros.
    expect(() => parseSystemHealth(raw({ queue: "broken" }))).toThrow("Systemstatus kunne ikke læses.");
    expect(() => parseSystemHealth(raw({ scanner: [] }))).toThrow("Systemstatus kunne ikke læses.");
  });
});

describe("the worker's scheduled check", () => {
  it("sends the alarms, logs the check, and survives a failing source", async () => {
    const sent: string[] = [];
    const logged: string[] = [];
    let fail = false;
    const monitor = createHealthMonitor({
      source: { systemHealth: async () => { if (fail) throw Object.assign(new Error("db"), { code: "57014" }); return raw({ processing: { stuckOverOneHour: 1 } }); } },
      sink: { send: async (alert) => void sent.push(alert.code) },
      log: (event) => logged.push(event.event),
      intervalMs: 0,
      now,
    });
    await monitor.tick();
    await monitor.tick();
    expect(sent).toEqual(["processing_stuck"]);
    fail = true;
    await expect(monitor.tick()).resolves.toBeUndefined();
    expect(logged).toEqual(["health_check", "health_check", "health_check_failed"]);
    monitor.stop();
  });

  it("never runs two checks at once", async () => {
    let calls = 0;
    let release: () => void = () => {};
    const monitor = createHealthMonitor({
      source: { systemHealth: () => { calls += 1; return new Promise((resolve) => { release = () => resolve(raw()); }); } },
      sink: { send: async () => {} },
      log: () => {},
      intervalMs: 0,
    });
    const a = monitor.tick();
    const b = monitor.tick();
    release();
    await Promise.all([a, b]);
    expect(calls).toBe(1);
  });
});

describe("Admin → Systemstatus", () => {
  it("shows counts and ids, marks what needs attention, and never content", () => {
    const view = systemStatusView(
      raw({
        queue: { queued: 3, running: 1, oldestQueuedSeconds: 2400, expiredLeases: 0 },
        failures: { failedLast24h: 2, byCodeLast24h: { no_text: 2 }, recentFailedJobIds: ["j1", "j2"] },
        evaluation: RUN,
        performance: { deviations: ["retrieval_total_p95"], accepted: false },
      }),
      (iso) => iso.slice(0, 10),
    );
    expect(view.environment).toBe("Produktion");
    expect(view.rows.find((row) => row.label === "Kø")).toMatchObject({ tone: "warning", value: "3 venter, 1 i gang · ældste 40 min." });
    expect(view.rows.find((row) => row.label === "Behandlingsfejl (24 t)")?.value).toBe("2: no_text (2)");
    expect(view.rows.find((row) => row.label === "Seneste regressionskørsel")).toMatchObject({ tone: "warning", value: "ikke bestået (kvalitetsregression) · pilot-v1 v1 · 2026-10-08" });
    expect(view.rows.find((row) => row.label === "Performance (§12)")).toMatchObject({ tone: "warning", value: "Afvigelser: retrieval_total_p95 · ikke godkendt" });
  });
});
