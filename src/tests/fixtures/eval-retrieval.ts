import { createEmbedder, createReranker } from "@/lib/knowledge/core/registry";
import { TEST_EMBEDDER } from "@/lib/knowledge/core/test-embedder";
import type { EvidenceSet } from "@/lib/knowledge/core/evidence";

import { configurationFingerprint } from "../../../evals/engine/checksum.ts";
import { createFixtureRetrieval, fixtureUuid } from "../../../evals/engine/fixture-retrieval.ts";
import { loadInputs, type LoadedInputs } from "../../../evals/engine/loader.ts";
import { runEvaluation, type RunOptions } from "../../../evals/engine/runner.ts";
import type { ConfigurationInput, EvalCase, EvalSet, RetrievalRun, RetrievalUnderTest } from "../../../evals/engine/types.ts";

/**
 * Test helpers for the retrieval evaluation (8B-I1). Everything here is fictional.
 *
 * `productionDouble` is a TEST DOUBLE that relabels fixture evidence as if it came from
 * production implementations in the evaluation environment. It exists only to exercise the
 * gate logic on a run that can pass; it is a plain object, not issued evidence, and nothing
 * outside the tests can construct it.
 */

export const FIXED_NOW = new Date("2026-10-03T10:00:00Z");
export const now = () => FIXED_NOW;

export function loadExample(): LoadedInputs {
  return loadInputs({ set: "example-v1", gates: "gates-v1", configuration: "fixture-development" });
}

export function fixtureRetrieval(inputs: LoadedInputs = loadExample()): RetrievalUnderTest {
  const embedder = createEmbedder({ id: fixtureUuid("embedding-model:active"), ...TEST_EMBEDDER }, "test");
  return createFixtureRetrieval({
    manifest: inputs.set.manifest,
    fixtures: inputs.fixtures,
    embedder,
    reranker: createReranker("none", "test"),
    baselineReranker: createReranker("none", "test"),
    now,
  });
}

export const PRODUCTION_DOUBLE_CONFIGURATION: ConfigurationInput = {
  embeddingModel: { provider: "test-double", model: "embed-double", version: "1", dimensions: 256 },
  reranker: { id: "rerank-double", version: "1" },
  algorithmVersion: "hybrid-rrf-1",
  params: { candidateK: 50, rerankN: 30, topK: 8, maxPerVersion: 3, minScore: 0.1, rrfK: 60 },
  chunkerVersions: ["fixture-sections/1"],
};

export interface DoubleOptions {
  /** Post-processes each set, e.g. to inject a breach. */
  transform?: (set: EvidenceSet, evalCase: EvalCase) => EvidenceSet;
  /** Simulates a good retrieval: abstains where the facit says so and drops distractors. */
  ideal?: boolean;
  environment?: "evaluation" | "fixture";
  configuration?: ConfigurationInput;
  actor?: (evalCase: EvalCase) => string;
  chunkerVersion?: string;
  corpusChecksum?: () => string;
  baseline?: RetrievalUnderTest | null;
}

export function productionDouble(inner: RetrievalUnderTest, options: DoubleOptions = {}): RetrievalUnderTest {
  const configuration = options.configuration ?? PRODUCTION_DOUBLE_CONFIGURATION;
  const model = configuration.embeddingModel!;
  return {
    name: "production-double",
    environment: options.environment ?? "evaluation",
    configuration: () => configuration,
    binding: () => inner.binding(),
    versionText: (document, version) => inner.versionText(document, version),
    corpusChecksum: options.corpusChecksum ?? (() => inner.corpusChecksum()),
    async run(evalCase: EvalCase): Promise<RetrievalRun> {
      const run = await inner.run(evalCase);
      const binding = inner.binding();
      const distractorIds = new Set(
        (evalCase.expected.distractors ?? []).map((ref) => binding.documents[ref.document]!.documentId),
      );
      let items = structuredClone(run.set.items) as EvidenceSet["items"][number][];
      if (options.ideal) {
        items = evalCase.expected.outcome === "insufficient" ? [] : items.filter((item) => !distractorIds.has(item.documentId));
      }
      let set: EvidenceSet = {
        ...structuredClone(run.set),
        retrieval: {
          ...structuredClone(run.set.retrieval),
          grade: "production",
          embeddingModel: { id: `${model.provider}:${model.model}@${model.version}`, grade: "production" },
          reranker: { id: configuration.reranker.id, version: configuration.reranker.version, grade: "production" },
        },
        items,
        signals: { ...run.set.signals, itemCount: items.length },
      };
      if (options.transform) set = options.transform(set, evalCase);
      const chunkerVersions = Object.fromEntries(Object.keys(run.chunkerVersions).map((id) => [id, options.chunkerVersion ?? "fixture-sections/1"]));
      return { actor: options.actor?.(evalCase) ?? run.actor, set, raw: run.raw, chunkerVersions };
    },
    withoutReranker: () => (options.baseline === undefined ? productionDouble(inner, { ...options, baseline: null, transform: undefined }) : options.baseline),
  };
}

/** Repeats cases (with new ids) until every type minimum is met. */
export function enlarged(set: EvalSet, copies: number): EvalSet {
  const active = set.cases.filter((evalCase) => !evalCase.retired);
  const cases: EvalCase[] = [];
  for (let i = 0; i < copies; i += 1) for (const evalCase of active) cases.push({ ...structuredClone(evalCase), id: `${evalCase.id}-x${i}` });
  return { manifest: set.manifest, cases };
}

export async function run(options: Partial<RunOptions> & Pick<RunOptions, "retrieval">) {
  const inputs = loadExample();
  return runEvaluation({
    set: options.set ?? inputs.set,
    gates: options.gates ?? inputs.gates,
    declared: options.declared ?? { label: "test", configuration: PRODUCTION_DOUBLE_CONFIGURATION },
    now,
    runId: options.runId ?? "00000000-0000-4000-8000-000000000001",
    ...options,
  });
}

export const doubleFingerprint = configurationFingerprint(PRODUCTION_DOUBLE_CONFIGURATION);
