import { createHash } from "node:crypto";

import { classificationAlerts, invalidRunAlert, requestedModeMatches, type EvaluationMode, type RunClassification } from "../../evals/engine/regression.ts";
import { verifyPerformanceMeasurement, type PerformanceMeasurement } from "../../evals/engine/performance.ts";
import { createEvaluationPublisher, PublicationRefusedError, sqlPublisherConnection, type SqlClient } from "../../evals/engine/publication.ts";
import type { EvaluationReport } from "../../evals/engine/runner.ts";
import type { GateSet } from "../../evals/engine/types.ts";
import { createAlert, type AlertSink } from "../../src/lib/observability/alerts.ts";

/**
 * Publication of one evaluation run in production (docs/08b §4.5, D-7, D-18; 8B-I7).
 *
 *   * Runs as evaluation_publisher_login and nothing else: the connection can only call
 *     record_evaluation_run, register_evaluation_gate_set and record_performance_measurement.
 *   * The files are checked against their SHA-256 list from the evaluation run before anything
 *     is sent; the report and the measurement are recomputed here (verifyForPublication,
 *     verifyPerformanceMeasurement) and again in the database.
 *   * The DATABASE classifies the registered run (8B-I7.1): a run of the configuration in service
 *     is a regression, anything else a baseline — whatever the CI job asked for. A hard-gate
 *     regression's registration is what suspends the configuration (same transaction, no
 *     fallback). The alarms follow the database's classification: hard-gate regression
 *     (critical) or quality regression (warning), with evaluation set, gate set and fingerprint.
 *     The requested mode is logged and shown beside it; it decides nothing.
 *   * A run the database refuses as invalid (H7, or H6 outside service) raises
 *     "evaluation_invalid"; any other refusal "publication_refused" — never silence, and never a
 *     baseline or a pass.
 */

export interface PublishInput {
  report: EvaluationReport;
  gates: GateSet;
  performance: PerformanceMeasurement | null;
  /** What the CI job intended (`--mode`). Diagnostic only: stored and logged, decides nothing. */
  requestedMode: EvaluationMode | null;
  /** The files as read (name → content) and the sha256sum list of the run, if present. */
  files: Record<string, string>;
  checksums: string | null;
}

export type PublishOutcome =
  | { status: "published"; runId: string; classification: RunClassification; performanceId: string | null }
  | { status: "refused"; invalidRun: boolean; problems: string[] };

/** A registry refusal carries its code in the message: "Afvist (<code>): …". */
const isInvalidRunRefusal = (error: unknown) => error instanceof Error && error.message.includes("Afvist (invalid_run)");

/** sha256sum lines ("<hex>  <name>") against the given files. Missing or wrong → problems. */
export function checkFileSums(files: Record<string, string>, checksums: string | null): string[] {
  if (checksums === null) return ["Filernes SHA-256-liste mangler."];
  const listed = new Map(
    checksums.split("\n").filter(Boolean).map((line) => {
      const [hex, name] = line.split(/\s+/, 2);
      return [name ?? "", hex ?? ""] as const;
    }),
  );
  const problems: string[] = [];
  for (const [name, content] of Object.entries(files)) {
    const expected = listed.get(name);
    if (!expected) problems.push(`${name} står ikke i SHA-256-listen.`);
    else if (createHash("sha256").update(content).digest("hex") !== expected) problems.push(`${name} stemmer ikke med sin SHA-256.`);
  }
  return problems;
}

export async function publishEvaluation(input: PublishInput, sql: SqlClient, sink: AlertSink, log: (event: Record<string, unknown>) => void): Promise<PublishOutcome> {
  const requestedMode = input.requestedMode;
  const refuse = async (problems: string[], invalidRun = false): Promise<PublishOutcome> => {
    log({ event: "eval_publication_refused", run_id: input.report.runId, requested_mode: requestedMode, invalid_run: invalidRun, problems: problems.length });
    await sink.send(
      invalidRun
        ? invalidRunAlert(input.report.runId, requestedMode)
        : createAlert("publication_refused", { run_id: input.report.runId, requested_mode: requestedMode ?? "none", problems: problems.length }),
    );
    return { status: "refused", invalidRun, problems };
  };

  const problems = checkFileSums(input.files, input.checksums);
  if (input.performance) {
    problems.push(...verifyPerformanceMeasurement(input.performance));
    if (input.performance.runId !== input.report.runId) problems.push("Performance-målingen hører til en anden kørsel.");
  }
  if (problems.length > 0) return refuse(problems);

  let published: Awaited<ReturnType<ReturnType<typeof createEvaluationPublisher>["publish"]>>;
  try {
    published = await createEvaluationPublisher(sqlPublisherConnection(sql)).publish(input.report, input.gates, requestedMode);
  } catch (error) {
    if (error instanceof PublicationRefusedError) return refuse(error.problems);
    // The database refused it (it recomputes everything) — also a refusal, with its reason class.
    const code = (error as { code?: unknown })?.code;
    if (typeof code === "string" && /^(P0001|23|22|42501)/.test(code)) return refuse([`Databasen afviste rapporten (${code}).`], isInvalidRunRefusal(error));
    throw error;
  }
  const { event } = published;
  log({
    event: "eval_published", run_id: input.report.runId, registered_id: published.runId, verdict: input.report.verdict,
    classification: event.classification, requested_mode: requestedMode, requested_mode_matches: requestedModeMatches(event),
    configuration_status: event.configurationStatus, suspended: event.suspended,
  });

  let performanceId: string | null = null;
  if (input.performance) {
    const rows = await sql.unsafe("select knowledge.record_performance_measurement($1::text::jsonb) as id", [JSON.stringify(input.performance)]);
    performanceId = String(rows[0]?.id);
    log({ event: "eval_performance_recorded", run_id: input.report.runId, measurement_id: performanceId });
  }

  for (const alert of classificationAlerts(event)) await sink.send(alert);
  return { status: "published", runId: published.runId, classification: event.classification, performanceId };
}
