import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { createEmbedder, createReranker } from "../../src/lib/knowledge/core/registry.ts";
import { TEST_EMBEDDER } from "../../src/lib/knowledge/core/test-embedder.ts";

import { createFixtureRetrieval, fixtureUuid } from "./fixture-retrieval.ts";
import { EVALS_ROOT, loadInputs } from "./loader.ts";
import { renderMarkdown } from "./report.ts";
import { runEvaluation } from "./runner.ts";
import { EvalSetError, GateSetError } from "./schema.ts";

/**
 * `npm run eval:retrieval` (docs/08b §4.5, 8B-I1).
 *
 *   --set            evaluation set (manifests/<set>.json + cases/<set>.jsonl), default "example-v1"
 *   --gates          gate set (gates/<gates>.json), default "gates-v1"
 *   --configuration  declared configuration (configurations/<name>.json), default "fixture-development"
 *   --adapter        retrieval under test; only "fixture" exists in 8B-I1
 *   --out            output directory, default evals/retrieval/reports/
 *
 * Writes <run-id>.json and <run-id>.md. Exit code 0 for "pass", 1 for "fail" or "uncertain",
 * 2 for invalid input. It never writes to a database and never registers anything.
 */

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      set: { type: "string", default: "example-v1" },
      gates: { type: "string", default: "gates-v1" },
      configuration: { type: "string", default: "fixture-development" },
      adapter: { type: "string", default: "fixture" },
      out: { type: "string", default: path.join(EVALS_ROOT, "reports") },
    },
  });
  if (values.adapter !== "fixture") {
    console.error(`Ukendt adapter "${values.adapter}". I 8B-I1 findes kun "fixture"; evalueringsmiljøet kommer i et senere deltrin.`);
    return 2;
  }

  const inputs = loadInputs({ set: values.set, gates: values.gates, configuration: values.configuration });
  // The development implementations come from the fail-closed registry, which refuses them
  // unless IPA_RUNTIME_ENV is explicitly local or test.
  const embedder = createEmbedder({ id: fixtureUuid("embedding-model:active"), ...TEST_EMBEDDER });
  const reranker = createReranker();
  const baselineReranker = createReranker("none");
  const retrieval = createFixtureRetrieval({ manifest: inputs.set.manifest, fixtures: inputs.fixtures, embedder, reranker, baselineReranker, now: () => new Date() });

  const report = await runEvaluation({
    set: inputs.set,
    gates: inputs.gates,
    declared: { label: inputs.declared.label, configuration: inputs.declared.configuration },
    retrieval,
    verifyInputsUnchanged: inputs.verifyUnchanged,
  });

  fs.mkdirSync(values.out, { recursive: true });
  const base = path.join(values.out, report.runId);
  fs.writeFileSync(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(`${base}.md`, renderMarkdown(report));
  console.log(`Resultat: ${report.verdict} (gyldig: ${report.valid ? "ja" : "nej"}, tier: ${report.tier})`);
  for (const gate of report.hardGates) console.log(`  ${gate.id} ${gate.status} (${gate.violations} brud)`);
  for (const gate of report.qualityGates) console.log(`  ${gate.id} ${gate.status}${gate.uncertain ? " (usikker)" : ""} — ${gate.explanation}`);
  for (const reason of report.invalidReasons) console.log(`  Ugyldig: ${reason}`);
  console.log(`Rapport: ${base}.json og ${base}.md`);
  return report.verdict === "pass" ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof EvalSetError || error instanceof GateSetError ? error.message : error);
    process.exit(2);
  },
);
