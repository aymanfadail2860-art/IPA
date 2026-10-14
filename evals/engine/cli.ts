import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { isDocumentMaterial, type DocumentRetrievalParams } from "../../src/lib/knowledge/core/provider.ts";
import { createEmbedder, createReranker } from "../../src/lib/knowledge/core/registry.ts";
import { TEST_EMBEDDER } from "../../src/lib/knowledge/core/test-embedder.ts";

import { createAlert, createAlertSink } from "../../src/lib/observability/alerts.ts";

import { connectEvaluationEnvironment, evaluationEnvironmentFromEnv, NotAnEvaluationEnvironmentError } from "./evaluation-environment.ts";
import { createFixtureRetrieval, fixtureUuid } from "./fixture-retrieval.ts";
import { EVALS_ROOT, loadInputs } from "./loader.ts";
import { runEvaluationOperation, writeVersionedReport, type EvaluationMode } from "./operations.ts";
import type { PerformanceMeasurement } from "./performance.ts";
import { runEvaluation, type EvaluationReport } from "./runner.ts";
import { EvalSetError, GateSetError, validateDeclaredConfiguration } from "./schema.ts";

/**
 * `npm run eval:retrieval` (docs/08b §4.5, 8B-I1).
 *
 *   --set            evaluation set (manifests/<set>.json + cases/<set>.jsonl), default "example-v1"
 *   --gates          gate set (gates/<gates>.json), default "gates-v1" for the hybrid method and
 *                    "product-documents-gates-v1" for product_documents (B-036). A gate set
 *                    evaluates only its own method; any other combination is refused.
 *   --configuration  declared configuration (configurations/<name>.json), default "fixture-development"
 *   --adapter        retrieval under test: "fixture" (in-memory, development only, default) or
 *                    "evaluation" — the evaluation environment (docs/08b §4.5, 8B-I7): a separate
 *                    Supabase project whose database says it is one. Its own credentials come
 *                    from the environment (evaluationEnvironmentFromEnv) — never production ones.
 *   --mode           "baseline" (default) or "regression": what the run intends. Diagnostic only —
 *                    the database classifies the registered run (8B-I7.1)
 *   --provision      (evaluation adapter) provision the corpus, users, grants and conflicts first (idempotent)
 *   --out            output directory, default evals/retrieval/reports/
 *
 * A hybrid configuration runs with the development implementations only (test embedder and
 * "none"). The production providers of 8B (AWS Bedrock) were removed in the beta's L2
 * (docs/beta.md §14); product_documents needs no provider at all.
 *
 * Writes <run-id>.json, <run-id>.md, <run-id>.sha256 and — with the evaluation adapter — the
 * performance measurement <run-id>.performance.json. Exit code 0 for "pass", 1 for "fail" or
 * "uncertain", 2 for invalid input, 3 when the run could not be carried out (an alarm is sent:
 * evaluation_failed). It never writes to the production database and never registers anything:
 * registration is a separate step as evaluation_publisher (workers/evaluation/publish.ts).
 */

/** The gate set for the declared configuration's method (B-036): Q1–Q7 for hybrid, D1–D6 for product_documents. */
function defaultGateSet(configuration: string): string {
  // An invalid name is refused by loadInputs; it is never used as a path here.
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(configuration)) return "gates-v1";
  const declared = validateDeclaredConfiguration(JSON.parse(fs.readFileSync(path.join(EVALS_ROOT, "configurations", `${configuration}.json`), "utf8")));
  return isDocumentMaterial(declared.configuration) ? "product-documents-gates-v1" : "gates-v1";
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      set: { type: "string", default: "example-v1" },
      gates: { type: "string" },
      configuration: { type: "string" },
      adapter: { type: "string", default: "fixture" },
      out: { type: "string", default: path.join(EVALS_ROOT, "reports") },
      mode: { type: "string", default: "baseline" },
      provision: { type: "boolean", default: false },
    },
  });
  if (values.mode !== "baseline" && values.mode !== "regression") {
    console.error(`Ukendt mode "${values.mode}". Brug "baseline" eller "regression".`);
    return 2;
  }
  const mode = values.mode as EvaluationMode;
  if (values.adapter !== "fixture" && values.adapter !== "evaluation") {
    console.error(`Ukendt adapter "${values.adapter}". Brug "fixture" eller "evaluation".`);
    return 2;
  }

  // The fixture adapter's corpus is chunked as "fixture-sections/1"; the evaluation environment's
  // corpus by the real worker ("structure/1", 8B-I8 C7). The declared configuration must say which.
  const configuration = values.configuration ?? "fixture-development";
  const inputs = loadInputs({ set: values.set, gates: values.gates ?? defaultGateSet(configuration), configuration });
  // product_documents (B-035): no embedder, no reranker — only the declared budget.
  const declared = inputs.declared.configuration;
  if (isDocumentMaterial(declared)) {
    return finish(values.out, mode, await runDocumentEvaluation(values, inputs, declared.params, mode));
  }
  // The development implementations come from the fail-closed registry, which refuses them
  // unless IPA_RUNTIME_ENV is explicitly local or test.
  const embedder = createEmbedder({ id: fixtureUuid("embedding-model:active"), ...TEST_EMBEDDER });
  const reranker = createReranker();
  const baselineReranker = createReranker("none");

  let report;
  let performance = null;
  if (values.adapter === "evaluation") {
    const config = evaluationEnvironmentFromEnv(process.env);
    if ("missing" in config) {
      console.error(`Evalueringsmiljøet kræver ${config.missing.join(", ")}.`);
      return 2;
    }
    const env = connectEvaluationEnvironment(config);
    try {
      ({ report, performance } = await runEvaluationOperation({
        inputs, mode, embedder, reranker, baselineReranker, env, provision: values.provision,
        log: (event) => console.log(JSON.stringify(event)),
      }));
    } catch (error) {
      const reason = error instanceof NotAnEvaluationEnvironmentError ? "not_evaluation_environment" : error instanceof Error ? error.name : "unknown";
      await createAlertSink(process.env, "evaluation").send(createAlert("evaluation_failed", { set: values.set, mode, reason }));
      console.error(error instanceof Error ? error.message : error);
      return 3;
    }
  } else {
    const retrieval = createFixtureRetrieval({ manifest: inputs.set.manifest, fixtures: inputs.fixtures, embedder, reranker, baselineReranker, now: () => new Date() });
    report = await runEvaluation({
      set: inputs.set,
      gates: inputs.gates,
      declared: { label: inputs.declared.label, configuration: inputs.declared.configuration },
      retrieval,
      verifyInputsUnchanged: inputs.verifyUnchanged,
    });
  }

  return finish(values.out, mode, { report, performance });
}

/** product_documents (B-035): the fixture adapter, or the evaluation environment, without providers. */
async function runDocumentEvaluation(
  values: { adapter?: string; set: string; provision: boolean },
  inputs: ReturnType<typeof loadInputs>,
  documents: DocumentRetrievalParams,
  mode: EvaluationMode,
): Promise<{ report: EvaluationReport; performance: PerformanceMeasurement | null } | number> {
  if (values.adapter === "evaluation") {
    const config = evaluationEnvironmentFromEnv(process.env);
    if ("missing" in config) {
      console.error(`Evalueringsmiljøet kræver ${config.missing.join(", ")}.`);
      return 2;
    }
    try {
      return await runEvaluationOperation({
        inputs, mode, documents, env: connectEvaluationEnvironment(config), provision: values.provision,
        log: (event) => console.log(JSON.stringify(event)),
      });
    } catch (error) {
      const reason = error instanceof NotAnEvaluationEnvironmentError ? "not_evaluation_environment" : error instanceof Error ? error.name : "unknown";
      await createAlertSink(process.env, "evaluation").send(createAlert("evaluation_failed", { set: values.set, mode, reason }));
      console.error(error instanceof Error ? error.message : error);
      return 3;
    }
  }
  const retrieval = createFixtureRetrieval({ manifest: inputs.set.manifest, fixtures: inputs.fixtures, documents, now: () => new Date() });
  const report = await runEvaluation({
    set: inputs.set,
    gates: inputs.gates,
    declared: { label: inputs.declared.label, configuration: inputs.declared.configuration },
    retrieval,
    verifyInputsUnchanged: inputs.verifyUnchanged,
  });
  return { report, performance: null };
}

function finish(out: string, mode: EvaluationMode, result: { report: EvaluationReport; performance: PerformanceMeasurement | null } | number): number {
  if (typeof result === "number") return result;
  const { report, performance } = result;
  const written = writeVersionedReport(out, report, performance);
  const base = path.join(out, report.runId);
  console.log(`Resultat: ${report.verdict} (gyldig: ${report.valid ? "ja" : "nej"}, tier: ${report.tier})`);
  for (const gate of report.hardGates) console.log(`  ${gate.id} ${gate.status} (${gate.violations} brud)`);
  for (const gate of report.qualityGates) console.log(`  ${gate.id} ${gate.status}${gate.uncertain ? " (usikker)" : ""} — ${gate.explanation}`);
  for (const reason of report.invalidReasons) console.log(`  Ugyldig: ${reason}`);
  console.log(`Rapport: ${base}.json og ${base}.md (${mode}; filer med SHA-256: ${written.length})`);
  return report.verdict === "pass" ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof EvalSetError || error instanceof GateSetError ? error.message : error);
    process.exit(2);
  },
);
