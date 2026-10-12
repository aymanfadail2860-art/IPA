import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { captureControlReference, productionReferenceProblems } from "../../src/lib/knowledge/core/control-set.ts";

import type { EmbeddingProvider } from "../../src/lib/knowledge/core/embedding.ts";
import { createEmbedder, createEvaluationBaselineReranker, createReranker } from "../../src/lib/knowledge/core/registry.ts";
import type { RerankingProvider } from "../../src/lib/knowledge/core/reranker.ts";
import { TEST_EMBEDDER } from "../../src/lib/knowledge/core/test-embedder.ts";
import { EMBED_V4_EU_1024_DESCRIPTOR } from "../../src/lib/knowledge/providers/bedrock/cohere-embed-v4.ts";
import { COHERE_RERANK_35_ID } from "../../src/lib/knowledge/providers/bedrock/cohere-rerank-3-5.ts";
import { createProductionReranker, embeddingModelRow } from "../../src/lib/knowledge/providers/catalog.ts";
import { ENVIRONMENT_CREDENTIAL_SOURCES } from "../../src/lib/knowledge/providers/credentials-environment.ts";
import { createRuntimeEmbedder, providerRuntimeFor } from "../../src/lib/knowledge/providers/runtime.ts";
import { runtimeEnv } from "../../src/lib/knowledge/core/grade.ts";

import { createAlert, createAlertSink } from "../../src/lib/observability/alerts.ts";

import { connectEvaluationEnvironment, evaluationEnvironmentFromEnv, NotAnEvaluationEnvironmentError } from "./evaluation-environment.ts";
import { createFixtureRetrieval, fixtureUuid } from "./fixture-retrieval.ts";
import { EVALS_ROOT, loadInputs } from "./loader.ts";
import { runEvaluationOperation, writeVersionedReport, type EvaluationMode } from "./operations.ts";
import { runEvaluation } from "./runner.ts";
import { EvalSetError, GateSetError } from "./schema.ts";

/**
 * `npm run eval:retrieval` (docs/08b §4.5, 8B-I1).
 *
 *   --set            evaluation set (manifests/<set>.json + cases/<set>.jsonl), default "example-v1"
 *   --gates          gate set (gates/<gates>.json), default "gates-v1"
 *   --configuration  declared configuration (configurations/<name>.json), default by --providers
 *   --adapter        retrieval under test: "fixture" (in-memory, development only, default) or
 *                    "evaluation" — the evaluation environment (docs/08b §4.5, 8B-I7): a separate
 *                    Supabase project whose database says it is one. Its own credentials come
 *                    from the environment (evaluationEnvironmentFromEnv) — never production ones.
 *   --mode           "baseline" (default) or "regression": what the run intends. Diagnostic only —
 *                    the database classifies the registered run (8B-I7.1)
 *   --provision      (evaluation adapter) provision the corpus, users, grants and conflicts first (idempotent)
 *   --providers      "development" (test embedder + "none", default) or "bedrock" (Cohere Embed v4 EU
 *                    1024 + Rerank 3.5 in eu-central-1, 8B-I2). "bedrock" calls AWS with the job's
 *                    one credential path (GitHub OIDC in CI, the development chain locally; 8B-I8)
 *                    and uses the candidate configuration bedrock-embed-v4-eu-1024-rerank-3-5
 *                    (fixture adapter) or bedrock-embed-v4-eu-1024-rerank-3-5-structure-1
 *                    (evaluation environment) unless --configuration is given.
 *   --out            output directory, default evals/retrieval/reports/
 *   --capture-control-reference <file>
 *                    (with --providers bedrock) embed the embedding control set and write a DRAFT
 *                    reference to <file> — unapproved and uncalibrated (docs/08b §2.5, 8B-I8 C6).
 *                    It becomes the production reference only through a person's decision.
 *
 * Writes <run-id>.json, <run-id>.md, <run-id>.sha256 and — with the evaluation adapter — the
 * performance measurement <run-id>.performance.json. Exit code 0 for "pass", 1 for "fail" or
 * "uncertain", 2 for invalid input, 3 when the run could not be carried out (an alarm is sent:
 * evaluation_failed). It never writes to the production database and never registers anything:
 * registration is a separate step as evaluation_publisher (workers/evaluation/publish.ts).
 */

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      set: { type: "string", default: "example-v1" },
      gates: { type: "string", default: "gates-v1" },
      configuration: { type: "string" },
      adapter: { type: "string", default: "fixture" },
      providers: { type: "string", default: "development" },
      out: { type: "string", default: path.join(EVALS_ROOT, "reports") },
      "capture-control-reference": { type: "string" },
      mode: { type: "string", default: "baseline" },
      provision: { type: "boolean", default: false },
    },
  });
  if (values.mode !== "baseline" && values.mode !== "regression") {
    console.error(`Ukendt mode "${values.mode}". Brug "baseline" eller "regression".`);
    return 2;
  }
  const mode = values.mode as EvaluationMode;
  if (values.providers !== "development" && values.providers !== "bedrock") {
    console.error(`Ukendte providers "${values.providers}". Brug "development" eller "bedrock".`);
    return 2;
  }
  if (values.adapter !== "fixture" && values.adapter !== "evaluation") {
    console.error(`Ukendt adapter "${values.adapter}". Brug "fixture" eller "evaluation".`);
    return 2;
  }

  // The fixture adapter's corpus is chunked as "fixture-sections/1"; the evaluation environment's
  // corpus by the real worker ("structure/1", 8B-I8 C7). The declared configuration must say which.
  const configuration =
    values.configuration ??
    (values.providers === "bedrock" ? (values.adapter === "evaluation" ? "bedrock-embed-v4-eu-1024-rerank-3-5-structure-1" : "bedrock-embed-v4-eu-1024-rerank-3-5") : "fixture-development");
  const inputs = loadInputs({ set: values.set, gates: values.gates, configuration });
  let embedder: EmbeddingProvider;
  let reranker: RerankingProvider;
  let baselineReranker: RerankingProvider;
  let credentialSource = "none";
  if (values.providers === "bedrock") {
    // The production adapters through the shared resolution path (8B-I8 C7), with the evaluation
    // job's one credential path: GitHub OIDC in CI, the development chain locally.
    const runtime = providerRuntimeFor("evaluation", process.env, ENVIRONMENT_CREDENTIAL_SOURCES);
    credentialSource = runtime.credentialSource;
    embedder = createRuntimeEmbedder({ id: fixtureUuid("embedding-model:bedrock"), ...embeddingModelRow(EMBED_V4_EU_1024_DESCRIPTOR) }, () => runtime, runtimeEnv());
    reranker = createProductionReranker(COHERE_RERANK_35_ID, runtime);
    // Q7 needs the same run without reranking: the fusion order is the baseline. A measurement,
    // never evidence — allowed in the CI job's production runtime (registry.ts).
    baselineReranker = createEvaluationBaselineReranker();
  } else {
    // The development implementations come from the fail-closed registry, which refuses them
    // unless IPA_RUNTIME_ENV is explicitly local or test.
    embedder = createEmbedder({ id: fixtureUuid("embedding-model:active"), ...TEST_EMBEDDER });
    reranker = createReranker();
    baselineReranker = createReranker("none");
  }
  const captureTo = values["capture-control-reference"];
  if (captureTo) {
    if (values.providers !== "bedrock") {
      console.error("--capture-control-reference kræver --providers bedrock (en rigtig udbyder).");
      return 2;
    }
    const draft = await captureControlReference(embedder, {
      runtime: "evaluation",
      credentialSource,
      capturedAt: new Date().toISOString(),
      runId: process.env.GITHUB_RUN_ID ?? randomUUID(),
    });
    fs.mkdirSync(path.dirname(path.resolve(captureTo)), { recursive: true });
    fs.writeFileSync(captureTo, `${JSON.stringify(draft, null, 2)}\n`);
    // A draft is never approvable as it stands: approval and calibrated tolerances are a person's.
    console.log(JSON.stringify({ event: "eval_control_reference_captured", file: captureTo, credential_source: credentialSource, open: productionReferenceProblems(draft) }));
    return 0;
  }

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

  const written = writeVersionedReport(values.out, report, performance);
  const base = path.join(values.out, report.runId);
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
