import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { EmbeddingProvider } from "../../src/lib/knowledge/core/embedding.ts";
import type { RerankingProvider } from "../../src/lib/knowledge/core/reranker.ts";

import { createDatabaseRetrieval, embeddingModelIdFor } from "./database-retrieval.ts";
import type { EvaluationEnvironment } from "./evaluation-environment.ts";
import type { LoadedInputs } from "./loader.ts";
import { buildPerformanceMeasurement, createPerformanceRecorder, type IngestionSamples, type PerformanceMeasurement } from "./performance.ts";
import { provisionEvaluationCorpus } from "./provision.ts";
import type { EvaluationMode } from "./regression.ts";
import { renderMarkdown } from "./report.ts";
import { runEvaluation, type EvaluationReport } from "./runner.ts";

export { classificationAlerts, type EvaluationMode } from "./regression.ts";

/**
 * Evaluation operations (docs/08b §4.5, §10.2; 8B-I7): one evaluation run in the evaluation
 * environment, reproducibly, with versioned output.
 *
 *   * mode "baseline": the intention to evaluate a configuration for registration and approval.
 *   * mode "regression": the intention to evaluate the configuration in service again (scheduled
 *     weekly and at every change, or by hand).
 *   The mode is diagnostic only (8B-I7.1): the database classifies the registered run from the
 *   configuration's status, suspends on a hard-gate breach of the configuration in service
 *   (record_evaluation_run, D-8), and the alarms follow its classification.
 *
 * Reproducible: the run states the evaluation set (id, version, checksum), the gate set
 * (version, checksum), the configuration (fingerprint) and the corpus (checksum before and
 * after) — the same four inputs give a comparable run. Versioned output: the report
 * (reportSchema, engine version, its own checksums), the Markdown rendering, the performance
 * measurement and a SHA-256 list of the files.
 */


export interface EvaluationOperationOptions {
  inputs: LoadedInputs;
  mode: EvaluationMode;
  embedder: EmbeddingProvider;
  reranker: RerankingProvider;
  baselineReranker: RerankingProvider;
  /** The evaluation environment. Without one, nothing runs (the fixture adapter is cli.ts's own path). */
  env: EvaluationEnvironment;
  /** Provision the corpus first (idempotent). */
  provision: boolean;
  awaitWorker?: () => Promise<void>;
  now?: () => Date;
  log?: (event: Record<string, unknown>) => void;
}

export interface EvaluationOperationResult {
  report: EvaluationReport;
  performance: PerformanceMeasurement;
}

export async function runEvaluationOperation(options: EvaluationOperationOptions): Promise<EvaluationOperationResult> {
  const { inputs, env } = options;
  await env.assertEvaluation();
  let ingestion: IngestionSamples = { documents: [], corpusPages: 0, corpusSeconds: null };
  if (options.provision) {
    const provisioned = await provisionEvaluationCorpus({
      env,
      manifest: inputs.set.manifest,
      fixtures: inputs.fixtures,
      embedders: [options.embedder],
      awaitWorker: options.awaitWorker,
      log: options.log,
      now: options.now,
    });
    ingestion = provisioned.ingestion;
  }
  const snapshot = await env.snapshot(inputs.set.manifest);
  const recorder = createPerformanceRecorder();
  const retrieval = createDatabaseRetrieval({
    env,
    manifest: inputs.set.manifest,
    snapshot,
    embedder: options.embedder,
    embeddingModelId: await embeddingModelIdFor(env, options.embedder),
    reranker: options.reranker,
    baselineReranker: options.baselineReranker,
    now: options.now,
    observe: recorder.observer,
  });
  const report = await runEvaluation({
    set: inputs.set,
    gates: inputs.gates,
    declared: { label: inputs.declared.label, configuration: inputs.declared.configuration },
    retrieval,
    verifyInputsUnchanged: inputs.verifyUnchanged,
    now: options.now,
  });
  const performance = buildPerformanceMeasurement({
    runId: report.runId,
    configurationFingerprint: report.configuration.runtimeFingerprint,
    environment: report.configuration.environment === "evaluation" ? "evaluation" : "fixture",
    retrieval: recorder.samples(),
    ingestion,
    measuredAt: (options.now ?? (() => new Date()))().toISOString(),
  });
  options.log?.({ event: "eval_run_finished", mode: options.mode, run_id: report.runId, verdict: report.verdict, valid: report.valid });
  return { report, performance };
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/**
 * Writes the versioned output: <runId>.json, <runId>.md, <runId>.performance.json (when measured)
 * and <runId>.sha256 (sha256sum format). Returns the paths.
 */
export function writeVersionedReport(out: string, report: EvaluationReport, performance: PerformanceMeasurement | null): string[] {
  fs.mkdirSync(out, { recursive: true });
  const files: [string, string][] = [
    [`${report.runId}.json`, `${JSON.stringify(report, null, 2)}\n`],
    [`${report.runId}.md`, renderMarkdown(report)],
  ];
  if (performance) files.push([`${report.runId}.performance.json`, `${JSON.stringify(performance, null, 2)}\n`]);
  for (const [name, content] of files) fs.writeFileSync(path.join(out, name), content);
  const sums = files.map(([name, content]) => `${sha256(content)}  ${name}`).join("\n");
  fs.writeFileSync(path.join(out, `${report.runId}.sha256`), `${sums}\n`);
  return [...files.map(([name]) => path.join(out, name)), path.join(out, `${report.runId}.sha256`)];
}
