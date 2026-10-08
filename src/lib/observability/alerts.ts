/**
 * Alarms (docs/08b §14, D-15; 8B-I7). Every alarm goes through the abstract AlertSink. The
 * domain model knows only the interface; the channel is configuration:
 *
 *   IPA_ALERT_SINK=log       (default) one JSON line on stdout — the alarm never disappears
 *   IPA_ALERT_SINK=webhook   the log line AND an HTTPS POST to IPA_ALERT_WEBHOOK_URL
 *
 * The first channel is deliberately a plain webhook (JSON over HTTPS): it fits e-mail relays,
 * chat tools and incident tools alike. Which one, and who receives it, is a deployment decision
 * (Å-5) — the URL lives in the environment's secret handling, never in the repository.
 *
 * An alarm never contains document content, queries or personal data. That is enforced, not
 * hoped for: the summary is fixed text per alarm code (ALERT_CATALOGUE), and a detail value
 * must be a number or a short token (an id, a checksum, a code) without spaces. Anything else
 * is dropped and counted.
 *
 * Shared by the Next.js server, the worker and the evaluation CLI: relative imports, no
 * path aliases, no server-only.
 */

export type AlertSeverity = "warning" | "critical";

/** Every alarm the platform can raise, with its severity and fixed (Danish) summary. */
export const ALERT_CATALOGUE = {
  dead_letter: { severity: "warning", summary: "Et eller flere behandlingsjob er endeligt fejlet (dead-letter)." },
  queue_stale: { severity: "warning", summary: "Det ældste ventende job har ventet over 30 minutter." },
  processing_stuck: { severity: "warning", summary: "Versioner har været under behandling i over en time." },
  scanner_failures: { severity: "warning", summary: "Virusscanninger er endt som tekniske fejl. Intet frigives, mens det står på." },
  malware_found: { severity: "warning", summary: "En upload er fundet inficeret og sat i karantæne." },
  configuration_suspended: { severity: "critical", summary: "Retrieval-konfigurationen er suspenderet. Al evidens er development, indtil en ny kørsel er godkendt." },
  hard_gate_regression: { severity: "critical", summary: "En regressionskørsel har brudt et hårdt gate. Konfigurationen suspenderes automatisk (ingen fallback)." },
  quality_regression: { severity: "warning", summary: "En regressionskørsel har fejlet et kvalitetsgate. Det kræver faglig og teknisk vurdering." },
  evaluation_failed: { severity: "warning", summary: "En planlagt eller manuel evalueringskørsel kunne ikke gennemføres." },
  evaluation_invalid: { severity: "warning", summary: "En evalueringskørsel er ugyldig (H6 eller H7) og er ikke registreret. Den tæller hverken som baseline eller regression; konfigurationen er uændret." },
  publication_refused: { severity: "warning", summary: "En evalueringsrapport blev afvist ved publiceringen." },
  retrieval_unavailable: { severity: "critical", summary: "Retrieval er utilgængelig (systemfejl, ikke et tomt resultat)." },
  configuration_mismatch: { severity: "critical", summary: "Runtime-fingeraftrykket svarer ikke til den aktive konfiguration. Evidensen er development." },
} as const satisfies Record<string, { severity: AlertSeverity; summary: string }>;

export type AlertCode = keyof typeof ALERT_CATALOGUE;

export interface Alert {
  code: AlertCode;
  severity: AlertSeverity;
  summary: string;
  details: Record<string, string | number>;
  occurredAt: string;
}

/** The interface of docs/08b §14 (D-15). An implementation never throws into its caller. */
export interface AlertSink {
  send(alert: Alert): Promise<void>;
}

const DETAIL_KEY = /^[a-z][a-z0-9_]{0,40}$/;
/** Ids, checksums, codes, ISO timestamps, comma-separated lists of those — never prose. */
const DETAIL_TOKEN = /^[A-Za-z0-9_.:/@+,-]{0,200}$/;
const MAX_DETAILS = 20;

/**
 * Builds an alarm from its code. The summary and severity come from the catalogue; details
 * that are not a finite number or a short token are dropped and counted (`details_dropped`).
 */
export function createAlert(code: AlertCode, details: Record<string, unknown> = {}, now: () => Date = () => new Date()): Alert {
  const entry = ALERT_CATALOGUE[code];
  if (!entry) throw new Error(`Ukendt alarmkode: ${String(code)}`);
  const kept: Record<string, string | number> = {};
  let dropped = 0;
  for (const [key, value] of Object.entries(details)) {
    const ok =
      DETAIL_KEY.test(key) && Object.keys(kept).length < MAX_DETAILS &&
      ((typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && DETAIL_TOKEN.test(value)));
    if (ok) kept[key] = value as string | number;
    else dropped += 1;
  }
  if (dropped > 0) kept.details_dropped = dropped;
  return Object.freeze({ code, severity: entry.severity, summary: entry.summary, details: Object.freeze(kept), occurredAt: now().toISOString() }) as Alert;
}

/** True when the value has the shape createAlert produces (a sink re-checks what it is given). */
export function isSafeAlert(alert: Alert): boolean {
  const entry = (ALERT_CATALOGUE as Record<string, { severity: AlertSeverity; summary: string } | undefined>)[alert.code];
  return (
    entry !== undefined && alert.severity === entry.severity && alert.summary === entry.summary &&
    Object.entries(alert.details).length <= MAX_DETAILS + 1 &&
    Object.entries(alert.details).every(([key, value]) =>
      DETAIL_KEY.test(key) && ((typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && DETAIL_TOKEN.test(value))))
  );
}

export type LineWriter = (line: string) => void;

/** The default sink: one JSON line (event "alert"). Log metric filters can raise an alarm on it. */
export function logAlertSink(source: string, write: LineWriter = (line) => process.stdout.write(`${line}\n`)): AlertSink {
  return {
    async send(alert) {
      if (!isSafeAlert(alert)) {
        write(JSON.stringify({ event: "alert_refused", source, code: String(alert.code) }));
        return;
      }
      write(JSON.stringify({ event: "alert", source, code: alert.code, severity: alert.severity, summary: alert.summary, details: alert.details, occurred_at: alert.occurredAt }));
    },
  };
}

export interface WebhookOptions {
  url: string;
  source: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Where a failed delivery is reported (the log sink's writer). */
  write?: LineWriter;
}

/** The first channel (Å-5 decides receiver and service): JSON over HTTPS, 5 s timeout, never throws. */
export function webhookAlertSink(options: WebhookOptions): AlertSink {
  const doFetch = options.fetch ?? fetch;
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  return {
    async send(alert) {
      if (!isSafeAlert(alert)) return;
      try {
        const response = await doFetch(options.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source: options.source, code: alert.code, severity: alert.severity, summary: alert.summary, details: alert.details, occurredAt: alert.occurredAt }),
          signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
        });
        if (!response.ok) write(JSON.stringify({ event: "alert_delivery_failed", source: options.source, code: alert.code, status: response.status }));
      } catch (error) {
        write(JSON.stringify({ event: "alert_delivery_failed", source: options.source, code: alert.code, error: error instanceof Error ? error.name : "unknown" }));
      }
    },
  };
}

/** Sends to every sink; one failing channel never stops the others. */
export function fanOut(...sinks: AlertSink[]): AlertSink {
  return {
    async send(alert) {
      await Promise.all(sinks.map((sink) => sink.send(alert).catch(() => undefined)));
    },
  };
}

export class AlertConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlertConfigError";
  }
}

/**
 * The sink from the environment. `log` always runs. A webhook must be HTTPS (plain HTTP only to
 * localhost, for local tests). An unknown setting is a configuration error — fail fast at start.
 */
export function createAlertSink(
  env: Record<string, string | undefined>,
  source: string,
  options: { fetch?: typeof fetch; write?: LineWriter } = {},
): AlertSink {
  const kind = env.IPA_ALERT_SINK?.trim() || "log";
  const log = logAlertSink(source, options.write);
  if (kind === "log") return log;
  if (kind !== "webhook") throw new AlertConfigError(`IPA_ALERT_SINK="${kind}" er ukendt. Brug "log" eller "webhook".`);
  const raw = env.IPA_ALERT_WEBHOOK_URL?.trim();
  if (!raw) throw new AlertConfigError("IPA_ALERT_SINK=webhook kræver IPA_ALERT_WEBHOOK_URL.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AlertConfigError("IPA_ALERT_WEBHOOK_URL er ikke en gyldig URL.");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new AlertConfigError("IPA_ALERT_WEBHOOK_URL skal bruge HTTPS.");
  return fanOut(log, webhookAlertSink({ url: url.toString(), source, fetch: options.fetch, write: options.write }));
}
