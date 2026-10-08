import { HEALTH_THRESHOLDS, parseSystemHealth, type SystemHealth } from "./health.ts";

/**
 * Admin → Systemstatus (docs/08b §14; 8B-I7): the same counts and ids the worker's health check
 * reads (knowledge.system_status(), system.settings.manage), plus when the latest evaluation and
 * performance measurement were registered. A short list, not a dashboard.
 */

export type StatusTone = "success" | "warning" | "danger" | "neutral";

export interface StatusRow {
  label: string;
  value: string;
  tone: StatusTone;
}

export interface SystemStatusView {
  environment: string;
  rows: StatusRow[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const ENVIRONMENT: Record<string, string> = { local: "Lokal", evaluation: "Evalueringsmiljø", staging: "Staging/pilot", production: "Produktion", unset: "Ikke angivet" };

const OUTCOME: Record<string, string> = {
  pass: "bestået",
  pass_with_uncertainty: "bestået med usikkerhed",
  insufficient_certainty: "statistisk usikker",
  fail: "ikke bestået",
};

const CLASSIFICATION: Record<string, string> = {
  hard_gate_regression: "hård regression",
  quality_regression: "kvalitetsregression",
};

const minutes = (seconds: number) => `${Math.round(seconds / 60)} min.`;

export function systemStatusView(data: unknown, formatDate: (iso: string) => string): SystemStatusView {
  const health: SystemHealth = parseSystemHealth(data);
  const raw = isRecord(data) ? data : {};
  const evaluation = isRecord(raw.evaluation) ? raw.evaluation : null;
  const performance = isRecord(raw.performance) ? raw.performance : null;
  const rows: StatusRow[] = [];

  const oldest = health.queue.oldestQueuedSeconds;
  rows.push({
    label: "Kø",
    value: `${health.queue.queued} venter, ${health.queue.running} i gang${oldest !== null ? ` · ældste ${minutes(oldest)}` : ""}`,
    tone: oldest !== null && oldest > HEALTH_THRESHOLDS.queueStaleSeconds ? "warning" : "success",
  });
  const codes = Object.entries(health.failures.byCodeLast24h).map(([code, n]) => `${code} (${n})`).join(", ");
  rows.push({
    label: "Behandlingsfejl (24 t)",
    value: health.failures.failedLast24h === 0 ? "Ingen" : `${health.failures.failedLast24h}: ${codes}`,
    tone: health.failures.failedLast24h === 0 ? "success" : "warning",
  });
  rows.push({
    label: "Under behandling over en time",
    value: String(health.processing.stuckOverOneHour),
    tone: health.processing.stuckOverOneHour === 0 ? "success" : "warning",
  });
  rows.push({
    label: "Virusscanning (24 t)",
    value: `${health.scanner.scanFailedLast24h} tekniske fejl · ${health.scanner.infectedLast24h} fund`,
    tone: health.scanner.scanFailedLast24h > 0 ? "warning" : "success",
  });

  const cfg = health.configuration;
  rows.push({
    label: "Retrieval-konfiguration",
    value: cfg ? `${cfg.label} v${cfg.version} · ${cfg.status === "active" ? "aktiv" : `suspenderet (${cfg.suspensionReason ?? "ukendt årsag"})`}` : "Ingen i drift",
    tone: !cfg ? "neutral" : cfg.status === "active" ? "success" : "danger",
  });

  const run = health.evaluation;
  if (run) {
    const registered = typeof evaluation?.registeredAt === "string" ? formatDate(evaluation.registeredAt) : "";
    rows.push({
      label: run.regression ? "Seneste regressionskørsel" : "Godkendende evalueringskørsel",
      value: `${OUTCOME[run.outcome] ?? run.outcome}${CLASSIFICATION[run.classification] ? ` (${CLASSIFICATION[run.classification]})` : ""} · ${run.evalSet.id} v${run.evalSet.version}${registered ? ` · ${registered}` : ""}`,
      // The database's classification (8B-I7.1).
      tone: run.classification === "hard_gate_regression" ? "danger" : run.classification === "quality_regression" ? "warning" : "success",
    });
  } else {
    rows.push({ label: "Evaluering og regression", value: "Ingen registreret kørsel for konfigurationen i drift", tone: "neutral" });
  }

  if (performance) {
    const deviations = Array.isArray(performance.deviations) ? performance.deviations.filter((d): d is string => typeof d === "string") : [];
    const accepted = performance.accepted === true;
    rows.push({
      label: "Performance (§12)",
      value: deviations.length === 0 ? "Alle mål nået" : `Afvigelser: ${deviations.join(", ")}${accepted ? " · godkendt" : " · ikke godkendt"}`,
      tone: deviations.length === 0 || accepted ? "success" : "warning",
    });
  } else {
    rows.push({ label: "Performance (§12)", value: "Ikke målt for konfigurationen i drift", tone: "neutral" });
  }

  const environment = typeof raw.environment === "string" ? raw.environment : "unset";
  return { environment: ENVIRONMENT[environment] ?? environment, rows };
}
