import { describe, expect, it } from "vitest";

import { RESTRICTED_CONFLICT_MESSAGE, type EvidenceItem, type EvidenceSet } from "@/lib/knowledge/core/evidence";

import { checkTypeMinimums, decide, evaluateHardGates, evaluateQualityGates, HARD_GATE_TOLERANCE, PILOT_TIER_BELOW, tierFor, TYPE_MINIMUMS } from "../../evals/engine/gates.ts";
import { computeMetrics, wilson } from "../../evals/engine/metrics.ts";
import type { CaseObservation, HardGateId, Metrics, MetricValue, RerankerComparison, RetrievalUnderTest } from "../../evals/engine/types.ts";
import { HARD_GATE_IDS } from "../../evals/engine/types.ts";
import { enlarged, fixtureRetrieval, loadExample, PRODUCTION_DOUBLE_CONFIGURATION, productionDouble, run } from "./fixtures/eval-retrieval";

/** 8B-I1 — metrikker, hårde gates H1–H7, kvalitetsgates Q1–Q7 og pilot-reglerne (docs/08b §4.2–§4.4). */

const inputs = loadExample();
const fixture = fixtureRetrieval(inputs);
const binding = fixture.binding();

function observation(overrides: Partial<CaseObservation>): CaseObservation {
  return {
    caseId: "c",
    type: "direct",
    split: "dev",
    outcome: "evidence",
    itemCount: 1,
    empty: false,
    sourceRank: 1,
    firstGrade3Rank: 1,
    requiredCovered: 1,
    requiredTotal: 1,
    gainsByRank: [3],
    idealGains: [3],
    itemsWithinK: 1,
    distractorItems: 0,
    violations: [],
    error: null,
    ...overrides,
  };
}

describe("Wilson 95 % interval", () => {
  it.each([
    [10, 10, 0.7225, 1],
    [0, 10, 0, 0.2775],
    [5, 10, 0.2366, 0.7634],
    [38, 40, 0.8346, 0.9862],
    [1, 1, 0.2065, 1],
  ])("%i/%i", (successes, n, lower, upper) => {
    const interval = wilson(successes, n)!;
    expect(interval.lower).toBeCloseTo(lower, 3);
    expect(interval.upper).toBeCloseTo(upper, 3);
  });

  it("is null for n = 0 and refuses impossible proportions", () => {
    expect(wilson(0, 0)).toBeNull();
    expect(() => wilson(3, 2)).toThrow();
    expect(() => wilson(-1, 2)).toThrow();
    expect(() => wilson(0.5, 2)).toThrow();
  });
});

describe("metrics (docs/08b §4.2)", () => {
  const observations: CaseObservation[] = [
    observation({ caseId: "a", sourceRank: 1, firstGrade3Rank: 1 }),
    observation({ caseId: "b", sourceRank: 2, firstGrade3Rank: 4, requiredCovered: 1, requiredTotal: 2, gainsByRank: [0, 0, 0, 3], idealGains: [3, 3] }),
    observation({ caseId: "c", sourceRank: null, firstGrade3Rank: null, requiredCovered: 0, gainsByRank: [0], idealGains: [3] }),
    observation({ caseId: "d", empty: true, itemCount: 0, sourceRank: null, firstGrade3Rank: null, requiredCovered: 0, gainsByRank: [], itemsWithinK: 0 }),
    observation({ caseId: "u1", type: "unanswerable", outcome: "insufficient", empty: true, itemCount: 0, itemsWithinK: 0 }),
    observation({ caseId: "u2", type: "permission", outcome: "insufficient", empty: false, itemCount: 3, itemsWithinK: 3 }),
    observation({ caseId: "x1", type: "distractor", itemsWithinK: 4, distractorItems: 1 }),
  ];
  const metrics = computeMetrics(observations);

  it("Source Recall@K: share of answerable questions with an expected document version in the top K", () => {
    // Answerable: a, b, c, d, x1 → hits a, b, x1.
    expect(metrics.source_recall_at_k).toMatchObject({ numerator: 3, denominator: 5, value: 0.6 });
    expect(metrics.source_recall_at_k.interval).not.toBeNull();
  });

  it("Passage Recall@K: every required (grade-3) passage must be covered — b covers 1 of 2 and does not count", () => {
    expect(metrics.passage_recall_at_k).toMatchObject({ numerator: 2, denominator: 5, value: 0.4 });
  });

  it("MRR@K: mean of 1/rank of the first grade-3 passage, 0 when missing", () => {
    expect(metrics.mrr_at_k.value).toBeCloseTo((1 + 0.25 + 0 + 0 + 1) / 5, 10);
    expect(metrics.mrr_at_k.interval).toBeNull();
  });

  it("correct abstention counts unanswerable and permission questions with an empty result", () => {
    expect(metrics.correct_abstention).toMatchObject({ numerator: 1, denominator: 2, value: 0.5 });
  });

  it("false abstention counts answerable questions with an empty result (no-answer cases)", () => {
    expect(metrics.false_abstention).toMatchObject({ numerator: 1, denominator: 5, value: 0.2 });
  });

  it("distractor intrusion is the share of distractor-question items from a distractor", () => {
    expect(metrics.distractor_intrusion).toMatchObject({ numerator: 1, denominator: 4, value: 0.25 });
    expect(computeMetrics([observation({ type: "distractor", itemsWithinK: 0, distractorItems: 0, empty: true })]).distractor_intrusion.value).toBe(0);
    expect(computeMetrics([observation({})]).distractor_intrusion.value).toBeNull();
  });

  it("reports Recall@1/@3, Full Coverage and nDCG without gating them", () => {
    expect(metrics.informational.source_recall_at_1.numerator).toBe(2);
    expect(metrics.informational.source_recall_at_3.numerator).toBe(3);
    expect(metrics.informational.full_coverage_at_k.value).toBeCloseTo((1 + 0.5 + 0 + 0 + 1) / 5, 10);
    expect(metrics.informational.ndcg_at_k.value).toBeGreaterThan(0);
    expect(metrics.informational.ndcg_at_k.value).toBeLessThan(1);
  });

  it("gives null — never a number — when there is nothing to measure", () => {
    const empty = computeMetrics([]);
    expect(empty.source_recall_at_k.value).toBeNull();
    expect(empty.correct_abstention.value).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------

function metricsWith(overrides: Partial<Record<keyof Omit<Metrics, "informational">, Partial<MetricValue>>>): Metrics {
  const base = computeMetrics([observation({}), observation({ caseId: "u", type: "unanswerable", outcome: "insufficient", empty: true, itemCount: 0 }), observation({ caseId: "x", type: "distractor" })]);
  for (const [key, value] of Object.entries(overrides)) Object.assign((base as unknown as Record<string, MetricValue>)[key]!, value);
  return base;
}

const comparison: RerankerComparison = { available: true, withReranker: { passage_recall_at_k: 0.9, mrr_at_k: 0.8 }, withoutReranker: { passage_recall_at_k: 0.9, mrr_at_k: 0.8 } };

describe("quality gates Q1–Q7 read their thresholds from the gate set", () => {
  const gates = inputs.gates;
  const status = (metrics: Metrics, id: string, cmp: RerankerComparison = comparison) => evaluateQualityGates(metrics, cmp, gates).find((gate) => gate.id === id)!;

  it.each([
    ["Q1", "source_recall_at_k", 0.95, 0.9499],
    ["Q2", "passage_recall_at_k", 0.85, 0.8499],
    ["Q3", "mrr_at_k", 0.7, 0.6999],
    ["Q4", "correct_abstention", 0.8, 0.7999],
  ] as const)("%s (%s ≥ %f) passes at the threshold and fails just below", (id, metric, threshold, below) => {
    expect(status(metricsWith({ [metric]: { value: threshold, interval: null } }), id).status).toBe("pass");
    expect(status(metricsWith({ [metric]: { value: below, interval: null } }), id).status).toBe("fail");
  });

  it.each([
    ["Q5", "false_abstention", 0.1, 0.1001],
    ["Q6", "distractor_intrusion", 0.1, 0.1001],
  ] as const)("%s (%s ≤ %f) passes at the threshold and fails just above", (id, metric, threshold, above) => {
    expect(status(metricsWith({ [metric]: { value: threshold, interval: null } }), id).status).toBe("pass");
    expect(status(metricsWith({ [metric]: { value: above, interval: null } }), id).status).toBe("fail");
  });

  it("Q7 passes when the reranker is not lower on Passage Recall and MRR, and fails otherwise", () => {
    expect(status(metricsWith({}), "Q7").status).toBe("pass");
    const worse = { ...comparison, withReranker: { passage_recall_at_k: 0.9, mrr_at_k: 0.79 } };
    expect(status(metricsWith({}), "Q7", worse).status).toBe("fail");
    const recallWorse = { ...comparison, withReranker: { passage_recall_at_k: 0.89, mrr_at_k: 0.9 } };
    expect(status(metricsWith({}), "Q7", recallWorse).status).toBe("fail");
    expect(status(metricsWith({}), "Q7", { ...comparison, available: false }).status).toBe("fail");
    expect(status(metricsWith({}), "Q7", { ...comparison, withoutReranker: { passage_recall_at_k: null, mrr_at_k: 0.8 } }).status).toBe("fail");
  });

  it("a metric that cannot be computed fails its gate (fail-closed)", () => {
    for (const id of ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6"]) {
      const metric = { Q1: "source_recall_at_k", Q2: "passage_recall_at_k", Q3: "mrr_at_k", Q4: "correct_abstention", Q5: "false_abstention", Q6: "distractor_intrusion" }[id]!;
      expect(status(metricsWith({ [metric]: { value: null, interval: null } }), id).status).toBe("fail");
      expect(status(metricsWith({ [metric]: { value: Number.NaN, interval: null } }), id).status).toBe("fail");
    }
  });

  it("uses the thresholds of the gate set it is given (a recalibrated set changes the outcome)", () => {
    const stricter = { ...gates, version: 2, quality: { ...gates.quality, Q3: { ...gates.quality.Q3, threshold: 0.9 } } };
    const metrics = metricsWith({ mrr_at_k: { value: 0.8, interval: null } });
    expect(evaluateQualityGates(metrics, comparison, gates).find((gate) => gate.id === "Q3")!.status).toBe("pass");
    expect(evaluateQualityGates(metrics, comparison, stricter).find((gate) => gate.id === "Q3")!.status).toBe("fail");
  });

  it("marks a passed proportion uncertain when the Wilson interval crosses the threshold", () => {
    // 19/20 = 0.95 passes Q1 on the point estimate; the lower bound 0.764 is below 0.95.
    const q1 = status(metricsWith({ source_recall_at_k: { value: 19 / 20, numerator: 19, denominator: 20, interval: wilson(19, 20) } }), "Q1");
    expect(q1).toMatchObject({ status: "pass", uncertain: true });
    // For a "≤" gate the upper bound matters: 0/20 has upper bound 0.161 > 0.10.
    const q5 = status(metricsWith({ false_abstention: { value: 0, numerator: 0, denominator: 20, interval: wilson(0, 20) } }), "Q5");
    expect(q5).toMatchObject({ status: "pass", uncertain: true });
    const certain = status(metricsWith({ false_abstention: { value: 0, numerator: 0, denominator: 80, interval: wilson(0, 80) } }), "Q5");
    expect(certain).toMatchObject({ status: "pass", uncertain: false });
  });
});

// ---------------------------------------------------------------------------------------------

describe("hard gates have zero tolerance and take precedence", () => {
  it("one violation fails the gate — the tolerance is a constant zero", () => {
    expect(HARD_GATE_TOLERANCE).toBe(0);
    for (const id of HARD_GATE_IDS) {
      const results = evaluateHardGates([{ gate: id, caseId: "c", explanation: "x" }]);
      expect(results.find((result) => result.id === id)).toMatchObject({ status: "fail", violations: 1 });
      expect(results.filter((result) => result.status === "fail")).toHaveLength(1);
    }
  });

  it("perfect quality cannot compensate for a hard gate", () => {
    const quality = evaluateQualityGates(metricsWith({}), comparison, inputs.gates).map((gate) => ({ ...gate, status: "pass" as const, uncertain: false }));
    const minimums = checkTypeMinimums(TYPE_MINIMUMS.flatMap((rule) => Array.from({ length: rule.minimum }, () => ({ type: rule.types[0]! }))));
    expect(decide(evaluateHardGates([]), quality, minimums).verdict).toBe("pass");
    for (const id of HARD_GATE_IDS) {
      expect(decide(evaluateHardGates([{ gate: id, caseId: null, explanation: "x" }]), quality, minimums).verdict).toBe("fail");
    }
  });

  it("a missing hard gate result is a failure, never a pass", () => {
    const quality = evaluateQualityGates(metricsWith({}), comparison, inputs.gates).map((gate) => ({ ...gate, status: "pass" as const, uncertain: false }));
    const minimums = checkTypeMinimums(TYPE_MINIMUMS.flatMap((rule) => Array.from({ length: rule.minimum }, () => ({ type: rule.types[0]! }))));
    const withoutH5 = evaluateHardGates([]).filter((result) => result.id !== "H5");
    expect(decide(withoutH5, quality, minimums).verdict).toBe("fail");
    expect(decide(evaluateHardGates([]), quality.slice(1), minimums).verdict).toBe("fail");
  });

  it("H6 and H7 make the run invalid", () => {
    const decision = decide(evaluateHardGates([{ gate: "H6", caseId: null, explanation: "x" }, { gate: "H7", caseId: null, explanation: "y" }]), [], []);
    expect(decision.valid).toBe(false);
    expect(decision.invalidReasons).toEqual(["Hårdt gate H6 er ikke bestået.", "Hårdt gate H7 er ikke bestået."]);
  });
});

describe("pilot rules", () => {
  it("checks the minimum per type (docs/08b §4.4, pilot rule 2)", () => {
    expect(TYPE_MINIMUMS.map((rule) => [rule.types.join("+"), rule.minimum])).toEqual([
      ["direct+multi_chunk", 20],
      ["unanswerable", 5],
      ["historical", 3],
      ["conflict", 2],
      ["distractor", 3],
      ["permission+filter", 3],
    ]);
    const results = checkTypeMinimums([...Array.from({ length: 19 }, () => ({ type: "direct" as const })), { type: "multi_chunk" }, { type: "filter" }]);
    expect(results.find((result) => result.label.startsWith("besvarbare"))).toMatchObject({ actual: 20, met: true });
    expect(results.find((result) => result.label.startsWith("adgang"))).toMatchObject({ actual: 1, met: false });
  });

  it("under 100 active questions the tier is pilot", () => {
    expect(PILOT_TIER_BELOW).toBe(100);
    expect(tierFor(0)).toBe("pilot");
    expect(tierFor(99)).toBe("pilot");
    expect(tierFor(100)).toBe("standard");
  });
});

// ---------------------------------------------------------------------------------------------
// H1–H7 end to end: the real retrieval pipeline over the fictional corpus, with one breach
// injected at a time. Each must be caught by exactly the gate it belongs to.
// ---------------------------------------------------------------------------------------------

const ids = (document: string, version: string) => ({ documentId: binding.documents[document]!.documentId, documentVersionId: binding.documents[document]!.versions[version]! });

function withItems(set: EvidenceSet, change: (items: EvidenceItem[]) => EvidenceItem[]): EvidenceSet {
  const items = change(structuredClone(set.items) as EvidenceItem[]);
  return { ...set, items, signals: { ...set.signals, itemCount: items.length } };
}

async function hardGatesWith(retrieval: RetrievalUnderTest, only?: string) {
  const set = only ? { ...inputs.set, cases: inputs.set.cases.filter((evalCase) => evalCase.id === only) } : inputs.set;
  const report = await run({ set, retrieval });
  return Object.fromEntries(report.hardGates.map((gate) => [gate.id, gate.violations])) as Record<HardGateId, number>;
}

describe("hard gates H1–H7 catch injected breaches", () => {
  it("the clean double breaks no hard gate", async () => {
    expect(await hardGatesWith(productionDouble(fixture))).toEqual({ H1: 0, H2: 0, H3: 0, H4: 0, H5: 0, H6: 0, H7: 0 });
  });

  it("H1: an item from a document the actor has no grant for (permission leakage fixture)", async () => {
    const leak = productionDouble(fixture, {
      transform: (set) => withItems(set, (items) => (items[0] ? [{ ...items[0], ...ids("intern-provision", "1") }, ...items.slice(1)] : items)),
    });
    const gates = await hardGatesWith(leak, "ex-direct-003");
    expect(gates.H1).toBe(1);
    expect(gates.H2).toBeGreaterThan(0); // Its ids are metadata from an inaccessible document as well.
  });

  it("H1: an item that cannot be attributed to the manifest is a breach (fail-closed)", async () => {
    const unknown = productionDouble(fixture, {
      transform: (set) => withItems(set, (items) => [{ ...items[0]!, documentId: "f0000000-0000-4000-8000-00000000000f", documentVersionId: "f0000000-0000-4000-8000-0000000000ff" }]),
    });
    expect((await hardGatesWith(unknown, "ex-direct-003")).H1).toBe(1);
  });

  it("H1: a historical version for an actor without historical access", async () => {
    const historical = productionDouble(fixture, {
      transform: (set) => withItems(set, (items) => items.map((item) => (item.documentId === ids("ansvar-tillaeg", "1").documentId ? { ...item, validity: { ...item.validity, temporalStatus: "historical" } } : item))),
    });
    expect((await hardGatesWith(historical, "ex-multi-001")).H1).toBeGreaterThan(0);
  });

  it("H2: a title from an inaccessible document in the raw result alone", async () => {
    const raw = productionDouble(fixture, {});
    const leaking: RetrievalUnderTest = { ...raw, run: async (evalCase) => ({ ...(await raw.run(evalCase)), raw: { debug: "Testnotat om provision (fiktiv, intern)" } }) };
    expect(await hardGatesWith(leaking, "ex-perm-001")).toMatchObject({ H1: 0, H2: 1 });
  });

  it("H2: an excerpt taken from another document than the one it is attributed to", async () => {
    const swapped = productionDouble(fixture, {
      transform: (set) => withItems(set, (items) => [{ ...items[0]!, excerpt: { text: "Provisionssatsen for nytegning af erhvervsansvar i testporteføljen er 7 procent af første års præmie.", leadIn: null } }, ...items.slice(1)]),
    });
    expect(await hardGatesWith(swapped, "ex-direct-001")).toMatchObject({ H1: 0, H2: 1 });
  });

  it("H2: a neutral conflict indicator carrying more than the fixed text", async () => {
    const chatty = productionDouble(fixture, {
      transform: (set) =>
        withItems(set, (items) =>
          items.map((item) => ({
            ...item,
            conflicts: item.conflicts.map((marker) => (marker.visibility === "restricted" ? ({ ...marker, counterpart: "x" } as unknown as typeof marker) : marker)),
          })),
        ),
    });
    const conflictCase = { ...inputs.set.cases.find((evalCase) => evalCase.id === "ex-conflict-001")!, id: "restricted", actor: "reader_terms", expected: { outcome: "evidence" as const, passages: [{ document: "ansvar-accept", version: "1", anchor: "omsætning over 50 mio. kr.", grade: 3 as const }] } };
    const report = await run({ set: { ...inputs.set, cases: [conflictCase] }, retrieval: chatty });
    expect(report.hardGates.find((gate) => gate.id === "H2")!.violations).toBeGreaterThan(0);
    // Without the injected field the restricted indicator is exactly the fixed text.
    const clean = await run({ set: { ...inputs.set, cases: [conflictCase] }, retrieval: productionDouble(fixture) });
    expect(clean.hardGates.find((gate) => gate.id === "H2")!.violations).toBe(0);
    expect(clean.hardGates.find((gate) => gate.id === "H5")!.violations).toBe(0);
    expect(RESTRICTED_CONFLICT_MESSAGE).toMatch(/konflikt/);
  });

  it("H3: a version that is not valid in current mode (historical/current fixture)", async () => {
    const stale = productionDouble(fixture, {
      transform: (set) => withItems(set, (items) => items.map((item) => (item.documentId === ids("ansvar-betingelser", "2").documentId ? { ...item, ...ids("ansvar-betingelser", "1") } : item))),
    });
    const gates = await hardGatesWith(stale, "ex-direct-001");
    expect(gates.H3).toBeGreaterThan(0);
    expect(gates.H1).toBe(0);
  });

  it("H3: the current version in an as_of question (mustNotInclude) and a wrong historical marking", async () => {
    const current = productionDouble(fixture, {
      transform: (set) => withItems(set, (items) => items.map((item) => ({ ...item, ...ids("ansvar-betingelser", "2") }))),
    });
    expect((await hardGatesWith(current, "ex-hist-001")).H3).toBeGreaterThan(0);
    const unmarked = productionDouble(fixture, {
      transform: (set) => withItems(set, (items) => items.map((item) => ({ ...item, validity: { ...item.validity, temporalStatus: "current" } }))),
    });
    expect((await hardGatesWith(unmarked, "ex-hist-001")).H3).toBeGreaterThan(0);
  });

  it("H3: two versions of one document, and a wrong mode or date", async () => {
    const mixed = productionDouble(fixture, {
      transform: (set) => withItems(set, (items) => [...items, { ...items[0]!, evidenceId: "dup", ...ids("ansvar-betingelser", "1"), validity: { ...items[0]!.validity, temporalStatus: "historical" } }]),
    });
    expect((await hardGatesWith(mixed, "ex-direct-001")).H3).toBeGreaterThan(0);
    const wrongDate = productionDouble(fixture, { transform: (set) => ({ ...set, query: { ...set.query, asOf: "2025-04-01" } }) });
    expect((await hardGatesWith(wrongDate, "ex-hist-001")).H3).toBe(1);
    const wrongMode = productionDouble(fixture, { transform: (set) => ({ ...set, query: { ...set.query, mode: "current" } }) });
    expect((await hardGatesWith(wrongMode, "ex-hist-001")).H3).toBeGreaterThan(0);
  });

  it("H4: an item outside the requested product", async () => {
    const outside = productionDouble(fixture, {
      transform: (set) => withItems(set, (items) => items.map((item, i) => (i === 0 ? { ...item, product: { ...item.product, id: binding.products["ansvar-fiktiv"]! } } : item))),
    });
    expect((await hardGatesWith(outside, "ex-filter-001")).H4).toBe(1);
  });

  it("H5: a conflict item without its marker, or without its accessible counterpart", async () => {
    const unmarked = productionDouble(fixture, { transform: (set) => withItems(set, (items) => items.map((item) => ({ ...item, conflicts: [] }))) });
    expect((await hardGatesWith(unmarked, "ex-conflict-001")).H5).toBeGreaterThan(0);
    const onesided = productionDouble(fixture, {
      transform: (set) => withItems(set, (items) => items.filter((item) => item.documentId !== ids("ansvar-accept-notat", "1").documentId)),
    });
    expect((await hardGatesWith(onesided, "ex-conflict-001")).H5).toBeGreaterThan(0);
  });

  it("H6: development evidence, devOverride, a foreign chunker version and a fingerprint mismatch", async () => {
    // The fixture itself: test embedder and "none" — never production.
    const fixtureReport = await run({ retrieval: fixture, declared: { label: "fixture", configuration: fixture.configuration() } });
    expect(fixtureReport.hardGates.find((gate) => gate.id === "H6")!.violations).toBeGreaterThan(0);
    expect(fixtureReport.verdict).toBe("fail");

    const forced = productionDouble(fixture, { transform: (set) => ({ ...set, retrieval: { ...set.retrieval, devOverride: "force_insufficient" } }) });
    expect((await hardGatesWith(forced, "ex-direct-001")).H6).toBe(1);
    const chunker = productionDouble(fixture, { chunkerVersion: "structure/0" });
    expect((await hardGatesWith(chunker, "ex-direct-001")).H6).toBe(1);
    const otherModel = productionDouble(fixture, { configuration: { ...PRODUCTION_DOUBLE_CONFIGURATION, params: { ...PRODUCTION_DOUBLE_CONFIGURATION.params, minScore: 0.2 } } });
    const mismatch = await hardGatesWith(otherModel, "ex-direct-001");
    expect(mismatch.H6).toBe(1); // Runtime fingerprint ≠ declared fingerprint.
  });

  it("H7: not in the evaluation environment, another identity, or a corpus that changes during the run", async () => {
    expect((await hardGatesWith(productionDouble(fixture, { environment: "fixture" }), "ex-direct-001")).H7).toBe(1);
    expect((await hardGatesWith(productionDouble(fixture, { actor: () => "reader_all" }), "ex-direct-001")).H7).toBe(1);
    let calls = 0;
    expect((await hardGatesWith(productionDouble(fixture, { corpusChecksum: () => `c${calls++}` }), "ex-direct-001")).H7).toBe(1);
    const report = await run({ set: { ...inputs.set, cases: inputs.set.cases.slice(0, 1) }, retrieval: productionDouble(fixture), verifyInputsUnchanged: () => "cases/example-v1.jsonl ændrede sig under kørslen." });
    expect(report.hardGates.find((gate) => gate.id === "H7")!.violations).toBe(1);
    expect(report.valid).toBe(false);
  });
});

async function explanations(retrieval: RetrievalUnderTest, only: string, gate: HardGateId) {
  const report = await run({ set: { ...inputs.set, cases: inputs.set.cases.filter((evalCase) => evalCase.id === only) }, retrieval });
  return report.failures.filter((failure) => failure.gate === gate).map((failure) => failure.explanation);
}

describe("each hard-gate check stands on its own (one breach, one precise explanation)", () => {
  it("H3: a non-valid version in current mode, without any mustNotInclude to catch it", async () => {
    const stale = productionDouble(fixture, {
      transform: (set) => withItems(set, (items) => items.map((item) => (item.documentId === ids("ansvar-betingelser", "2").documentId ? { ...item, ...ids("ansvar-betingelser", "1") } : item))),
    });
    const found = await explanations(stale, "ex-direct-002", "H3");
    expect(found.some((text) => /er ikke den version, der gælder/.test(text))).toBe(true);
    expect(found.some((text) => /facit udelukker/.test(text))).toBe(false);
  });

  it("H3: two versions of one document are reported as mixing", async () => {
    const mixed = productionDouble(fixture, {
      transform: (set) => withItems(set, (items) => [...items, { ...items[0]!, evidenceId: "dup", ...ids("ansvar-betingelser", "1"), validity: { ...items[0]!.validity, temporalStatus: "historical" } }]),
    });
    expect((await explanations(mixed, "ex-direct-002", "H3")).some((text) => /blander to versioner af ansvar-betingelser/.test(text))).toBe(true);
  });

  it("H3: a version the facit excludes is reported as excluded", async () => {
    const excluded = productionDouble(fixture, {
      transform: (set) => withItems(set, (items) => [...items, { ...items[0]!, evidenceId: "tillaeg", ...ids("ansvar-tillaeg", "1") }]),
    });
    expect((await explanations(excluded, "ex-hist-002", "H3")).some((text) => /ansvar-tillaeg, som facit udelukker/.test(text))).toBe(true);
  });

  it("H6: a development-grade implementation alone is a breach", async () => {
    const development = productionDouble(fixture, {
      transform: (set) => ({ ...set, retrieval: { ...set.retrieval, reranker: { ...set.retrieval.reranker, grade: "development" } } }),
    });
    expect(await explanations(development, "ex-direct-001", "H6")).toEqual(['Rerankeren har graden "development".']);
  });

  it("H6 judges the implementations, not P1–P9: a configuration under evaluation is not active yet (8B-I6)", async () => {
    const candidate = productionDouble(fixture, { transform: (set) => ({ ...set, retrieval: { ...set.retrieval, grade: "development", unmet: ["P3"] } }) });
    expect(await explanations(candidate, "ex-direct-001", "H6")).toEqual([]);
  });

  it('H6: the "none" reranker is a breach even if it claims to be production and is the declared one', async () => {
    const configuration = { ...PRODUCTION_DOUBLE_CONFIGURATION, reranker: { ...PRODUCTION_DOUBLE_CONFIGURATION.reranker, id: "none", version: "1" } };
    const report = await run({
      set: { ...inputs.set, cases: inputs.set.cases.filter((evalCase) => evalCase.id === "ex-direct-001") },
      retrieval: productionDouble(fixture, { configuration }),
      declared: { label: "none", configuration },
    });
    expect(report.failures.filter((failure) => failure.gate === "H6").map((failure) => failure.explanation)).toEqual(['Rerankeren er "none".']);
  });
});

describe("passage coverage is per version", () => {
  it("an item from another version of the right document does not cover the passage", async () => {
    const otherVersion = productionDouble(fixture, {
      transform: (set) =>
        withItems(set, (items) =>
          items.map((item) => (item.documentId === ids("ansvar-betingelser", "2").documentId ? { ...item, ...ids("ansvar-betingelser", "1") } : item)),
        ),
    });
    const report = await run({ set: { ...inputs.set, cases: inputs.set.cases.filter((evalCase) => evalCase.id === "ex-direct-002") }, retrieval: otherVersion });
    expect(report.cases[0]).toMatchObject({ sourceRank: null, firstGrade3Rank: null, requiredCovered: 0 });
  });
});

describe("the overall decision on real runs", () => {
  it("a good retrieval with enough questions passes; one hard breach makes it fail", async () => {
    const big = enlarged(inputs.set, 8); // 112 active questions → tier standard, tight intervals.
    const good = await run({ set: big, retrieval: productionDouble(fixture, { ideal: true }) });
    expect(good.hardGates.every((gate) => gate.status === "pass")).toBe(true);
    expect(good.qualityGates.every((gate) => gate.status === "pass")).toBe(true);
    expect(good).toMatchObject({ valid: true, verdict: "pass", tier: "standard" });

    const target = big.cases[0]!.id;
    const breach = productionDouble(fixture, {
      ideal: true,
      // Appended last, so every quality number stays exactly as good as before.
      transform: (set, evalCase) => (evalCase.id === target ? withItems(set, (items) => [...items, { ...items[0]!, evidenceId: "leak", ...ids("intern-provision", "1") }]) : set),
    });
    const bad = await run({ set: big, retrieval: breach });
    expect(bad.qualityGates.every((gate) => gate.status === "pass")).toBe(true);
    expect(bad.hardGates.find((gate) => gate.id === "H1")).toMatchObject({ status: "fail", violations: 1 });
    expect(bad.verdict).toBe("fail");
  });

  it("a good retrieval on a pilot-sized set is uncertain, not pass", async () => {
    const report = await run({ set: enlarged(inputs.set, 5), retrieval: productionDouble(fixture, { ideal: true }) });
    expect(report).toMatchObject({ valid: true, verdict: "uncertain", tier: "pilot" });
    expect(report.qualityGates.some((gate) => gate.uncertain)).toBe(true);
  });

  it("too few questions per type make the run invalid whatever the numbers", async () => {
    const report = await run({ retrieval: productionDouble(fixture, { ideal: true }) });
    expect(report.valid).toBe(false);
    expect(report.verdict).toBe("fail");
    expect(report.invalidReasons.join("\n")).toMatch(/For få besvarbare \(direct og multi_chunk\): 4 \(mindst 20\)/);
  });

  it("no-answer and distractor cases: the plain fixture does not abstain and lets distractors in", async () => {
    const report = await run({ retrieval: productionDouble(fixture) });
    expect(report.qualityGates.find((gate) => gate.id === "Q4")!.status).toBe("fail");
    expect(report.qualityGates.find((gate) => gate.id === "Q6")!.status).toBe("fail");
    expect(report.failures.some((failure) => failure.caseId === "ex-unans-001" && failure.gate === "Q4")).toBe(true);
    expect(report.failures.some((failure) => failure.caseId === "ex-distr-001" && failure.gate === "Q6")).toBe(true);
  });
});
