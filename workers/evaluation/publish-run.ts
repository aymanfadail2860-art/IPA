import { createHash } from "node:crypto";

import { regressionAlerts, type EvaluationMode } from "../../evals/engine/regression.ts";
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
 *   * A regression run's registration is what suspends the configuration on a hard-gate breach
 *     (in the database, same transaction, no fallback). The alarms follow: hard-gate regression
 *     (critical) or quality regression (warning), with evaluation set, gate set and fingerprint.
 *   * A refused publication raises an alarm too — never silence.
 */

export interface PublishInput {
  report: EvaluationReport;
  gates: GateSet;
  performance: PerformanceMeasurement | null;
  mode: EvaluationMode;
  /** The files as read (name → content) and the sha256sum list of the run, if present. */
  files: Record<string, string>;
  checksums: string | null;
}

export interface PublishOutcome {
  status: "published" | "refused";
  runId?: string;
  performanceId?: string | null;
  problems?: string[];
}

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
  const refuse = async (problems: string[]): Promise<PublishOutcome> => {
    log({ event: "eval_publication_refused", run_id: input.report.runId, problems: problems.length });
    await sink.send(createAlert("publication_refused", { run_id: input.report.runId, mode: input.mode, problems: problems.length }));
    return { status: "refused", problems };
  };

  const problems = checkFileSums(input.files, input.checksums);
  if (input.performance) {
    problems.push(...verifyPerformanceMeasurement(input.performance));
    if (input.performance.runId !== input.report.runId) problems.push("Performance-målingen hører til en anden kørsel.");
  }
  if (problems.length > 0) return refuse(problems);

  let runId: string;
  try {
    runId = (await createEvaluationPublisher(sqlPublisherConnection(sql)).publish(input.report, input.gates)).runId;
  } catch (error) {
    if (error instanceof PublicationRefusedError) return refuse(error.problems);
    // The database refused it (it recomputes everything) — also a refusal, with its reason class.
    const code = (error as { code?: unknown })?.code;
    if (typeof code === "string" && /^(P0001|23|22|42501)/.test(code)) return refuse([`Databasen afviste rapporten (${code}).`]);
    throw error;
  }
  log({ event: "eval_published", run_id: input.report.runId, registered_id: runId, mode: input.mode, verdict: input.report.verdict });

  let performanceId: string | null = null;
  if (input.performance) {
    const rows = await sql.unsafe("select knowledge.record_performance_measurement($1::text::jsonb) as id", [JSON.stringify(input.performance)]);
    performanceId = String(rows[0]?.id);
    log({ event: "eval_performance_recorded", run_id: input.report.runId, measurement_id: performanceId });
  }

  for (const alert of regressionAlerts(input.report, input.mode)) await sink.send(alert);
  return { status: "published", runId, performanceId };
}
