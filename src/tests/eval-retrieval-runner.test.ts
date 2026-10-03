import { describe, expect, it } from "vitest";

import { canonicalJson, checksumOf, configurationFingerprint, evalSetChecksum, gateSetChecksum } from "../../evals/engine/checksum.ts";
import { PublisherUnavailableError, unavailablePublisher, verifyReport } from "../../evals/engine/publication.ts";
import { renderMarkdown } from "../../evals/engine/report.ts";
import { NOT_PRODUCTION_REASON, reportChecksum, runEvaluation, validateAnchors, type EvaluationReport } from "../../evals/engine/runner.ts";
import { EvalSetError } from "../../evals/engine/schema.ts";
import type { RetrievalUnderTest } from "../../evals/engine/types.ts";
import { doubleFingerprint, enlarged, fixtureRetrieval, loadExample, now, PRODUCTION_DOUBLE_CONFIGURATION, productionDouble, run } from "./fixtures/eval-retrieval";

/** 8B-I1 — kørsel, reproducerbarhed, checksums, rapport og adskillelsen kørsel/publiceret resultat (docs/08b §4.5). */

const inputs = loadExample();
const fixture = fixtureRetrieval(inputs);

describe("checksums", () => {
  it("canonical JSON ignores key order and refuses non-finite numbers", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: null, c: "x" }] })).toBe('{"a":[2,{"c":"x","d":null}],"b":1}');
    expect(checksumOf({ a: 1, b: 2 })).toBe(checksumOf({ b: 2, a: 1 }));
    expect(() => canonicalJson({ a: Number.NaN })).toThrow();
    expect(() => canonicalJson({ a: Infinity })).toThrow();
  });

  it("the eval-set checksum is independent of case order but changes with any content", () => {
    const reversed = { ...inputs.set, cases: [...inputs.set.cases].reverse() };
    expect(evalSetChecksum(reversed)).toBe(evalSetChecksum(inputs.set));
    const edited = structuredClone(inputs.set);
    edited.cases[0]!.notes += ".";
    expect(evalSetChecksum(edited)).not.toBe(evalSetChecksum(inputs.set));
  });

  it("a changed gate set has another checksum", () => {
    const changed = { ...inputs.gates, quality: { ...inputs.gates.quality, Q1: { ...inputs.gates.quality.Q1, threshold: 0.9 } } };
    expect(gateSetChecksum(changed)).not.toBe(gateSetChecksum(inputs.gates));
  });

  it("the configuration fingerprint changes with every defining field, but not with chunker order", () => {
    const base = PRODUCTION_DOUBLE_CONFIGURATION;
    const variants = [
      { ...base, embeddingModel: { ...base.embeddingModel!, dimensions: 512 } },
      { ...base, embeddingModel: { ...base.embeddingModel!, provider: "other" } },
      { ...base, reranker: { ...base.reranker, version: "2" } },
      { ...base, algorithmVersion: "hybrid-rrf-2" },
      { ...base, params: { ...base.params, minScore: 0.11 } },
      { ...base, chunkerVersions: ["structure/1"] },
    ];
    for (const variant of variants) expect(configurationFingerprint(variant)).not.toBe(doubleFingerprint);
    expect(configurationFingerprint({ ...base, chunkerVersions: ["b", "a"] })).toBe(configurationFingerprint({ ...base, chunkerVersions: ["a", "b", "a"] }));
  });
});

describe("the evaluation run", () => {
  it("is reproducible: the same inputs give the same results checksum", async () => {
    const first = await run({ retrieval: fixture, declared: { label: "fixture", configuration: fixture.configuration() } });
    const second = await run({ retrieval: fixtureRetrieval(loadExample()), declared: { label: "fixture", configuration: fixture.configuration() }, runId: "00000000-0000-4000-8000-000000000002" });
    expect(second.checksums.results).toBe(first.checksums.results);
    expect(second.checksums.report).not.toBe(first.checksums.report); // Another run id.
  });

  it("records the eval set, gate set, configuration and corpus it ran with", async () => {
    const report = await run({ retrieval: productionDouble(fixture) });
    expect(report.evalSet).toMatchObject({ setId: "example-v1", version: 1, caseSchema: 1, checksum: evalSetChecksum(inputs.set), activeCases: 14, retiredCases: 1 });
    expect(report.evalSet.byType).toEqual({ direct: 3, multi_chunk: 1, historical: 2, conflict: 1, unanswerable: 2, distractor: 2, permission: 2, filter: 1 });
    expect(report.gateSet).toMatchObject({ id: "gates", version: 1, decision: "B-020", k: 8, checksum: gateSetChecksum(inputs.gates) });
    expect(report.configuration).toMatchObject({ declaredFingerprint: doubleFingerprint, runtimeFingerprint: doubleFingerprint, matches: true, environment: "evaluation" });
    expect(report.corpus.checksumBefore).toBe(report.corpus.checksumAfter);
    expect(report.cases.map((observation) => observation.caseId)).not.toContain("ex-retired-001");
  });

  it("a changed retrieval fingerprint is caught (H6) and recorded", async () => {
    const report = await run({ retrieval: productionDouble(fixture), declared: { label: "other", configuration: { ...PRODUCTION_DOUBLE_CONFIGURATION, params: { ...PRODUCTION_DOUBLE_CONFIGURATION.params, topK: 10 } } } });
    expect(report.configuration.matches).toBe(false);
    expect(report.failures.some((failure) => failure.gate === "H6" && failure.caseId === null && /fingeraftrykket/.test(failure.explanation))).toBe(true);
  });

  it("aborts on an anchor that is missing or not unique — a set error, not a retrieval error", () => {
    const missing = structuredClone(inputs.set);
    missing.cases[0]!.expected.passages[0]!.anchor = "Denne tekst står ingen steder i korpusset";
    expect(() => validateAnchors(missing, fixture)).toThrow(EvalSetError);
    const ambiguous = structuredClone(inputs.set);
    ambiguous.cases[0]!.expected.passages[0]!.anchor = "Forsikringen dækker";
    expect(() => validateAnchors(ambiguous, fixture)).toThrow(/flere gange/);
    expect(() => validateAnchors(inputs.set, fixture)).not.toThrow();
  });

  it("a retrieval that fails makes the run invalid and counts as the worst outcome", async () => {
    const broken: RetrievalUnderTest = { ...productionDouble(fixture, { ideal: true }), run: async () => Promise.reject(new Error("forbindelsen blev afbrudt")) };
    const report = await run({ set: enlarged(inputs.set, 8), retrieval: broken });
    expect(report.valid).toBe(false);
    expect(report.verdict).toBe("fail");
    expect(report.invalidReasons.join()).toMatch(/Retrieval fejlede for 112 spørgsmål/);
    // An unanswerable question whose retrieval failed has NOT abstained correctly.
    expect(report.metrics.correct_abstention.value).toBe(0);
    expect(report.metrics.false_abstention.value).toBe(1);
  });

  it("never makes a report production-eligible — not even a passing one", async () => {
    const report = await run({ set: enlarged(inputs.set, 8), retrieval: productionDouble(fixture, { ideal: true }) });
    expect(report.verdict).toBe("pass");
    expect(report.production).toEqual({ eligible: false, reason: NOT_PRODUCTION_REASON });
  });

  it("has every field the report format requires", async () => {
    const report = await run({ retrieval: productionDouble(fixture) });
    for (const key of [
      "runId", "startedAt", "finishedAt", "reportSchema", "evalSet", "gateSet", "configuration", "corpus", "metrics", "rerankerComparison",
      "hardGates", "qualityGates", "minimums", "tier", "verdict", "valid", "invalidReasons", "failures", "cases", "production", "checksums",
    ]) {
      expect(report).toHaveProperty(key);
    }
    expect(report.hardGates.map((gate) => gate.id)).toEqual(["H1", "H2", "H3", "H4", "H5", "H6", "H7"]);
    expect(report.qualityGates.map((gate) => gate.id)).toEqual(["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7"]);
    expect(report.metrics.source_recall_at_k.interval).not.toBeNull();
    expect(report.failures.every((failure) => failure.rootCauseNote === null && failure.explanation.length > 0)).toBe(true);
    expect(report.checksums.report).toBe(reportChecksum(report));
  });

  it("renders a human-readable report", async () => {
    const report = await run({ retrieval: fixture, declared: { label: "fixture-development", configuration: fixture.configuration() } });
    const markdown = renderMarkdown(report);
    expect(markdown).toMatch(/^# Retrieval-evaluering — IKKE BESTÅET/);
    expect(markdown).toContain(NOT_PRODUCTION_REASON);
    expect(markdown).toMatch(/\| H6 \| Udviklingsevidens/);
    expect(markdown).toMatch(/\| Q4 \| Korrekt afvisning/);
    expect(markdown).toContain(report.evalSet.checksum);
    expect(markdown).toContain("Wilson 95 %");
  });
});

describe("a run is not a published result (D-7, D-18)", () => {
  async function passing(): Promise<EvaluationReport> {
    return run({ set: enlarged(inputs.set, 8), retrieval: productionDouble(fixture, { ideal: true }) });
  }

  it("an untouched report verifies against its gate set", async () => {
    const report = await passing();
    expect(verifyReport(report, inputs.gates)).toEqual({ ok: true });
    const failing = await run({ retrieval: fixture, declared: { label: "fixture", configuration: fixture.configuration() } });
    expect(verifyReport(failing, inputs.gates)).toEqual({ ok: true });
  });

  it("a hand-edited verdict does not verify, even with a recomputed report checksum", async () => {
    const report = await run({ retrieval: fixture, declared: { label: "fixture", configuration: fixture.configuration() } });
    const forged = structuredClone(report) as EvaluationReport;
    (forged as { verdict: string }).verdict = "pass";
    forged.valid = true;
    forged.checksums.report = reportChecksum(forged);
    const result = verifyReport(forged, inputs.gates);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.problems.join()).toMatch(/Afgørelsen stemmer ikke/);
  });

  it("hidden hard-gate breaches, edited metrics, another gate set and production claims are refused", async () => {
    const base = await passing();
    const mutate = (change: (report: EvaluationReport) => void) => {
      const copy = structuredClone(base);
      change(copy);
      copy.checksums.report = reportChecksum(copy);
      const result = verifyReport(copy, inputs.gates);
      return result.ok ? "" : result.problems.join("\n");
    };
    expect(mutate((report) => report.cases[0]!.violations.push({ gate: "H1", caseId: report.cases[0]!.caseId, explanation: "x" }))).toMatch(/hårde gates/);
    expect(mutate((report) => (report.metrics.mrr_at_k.value = 0.99))).toMatch(/Metrikkerne kan ikke genberegnes/);
    expect(mutate((report) => (report.cases[3]!.empty = true))).toMatch(/Metrikkerne kan ikke genberegnes/);
    expect(mutate((report) => ((report.production as { eligible: boolean }).eligible = true))).toMatch(/aldrig være production-egnet/);
    expect(mutate((report) => (report.tier = "pilot"))).toMatch(/Tier stemmer ikke/);
    const copy = structuredClone(base);
    copy.runId = "00000000-0000-4000-8000-0000000000ff"; // Harmless on its own, but the checksum no longer matches.
    const result = verifyReport(copy, inputs.gates);
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.problems).toEqual(["Rapportens checksum stemmer ikke med indholdet."]);
    const laxer = { ...inputs.gates, version: 2, quality: { ...inputs.gates.quality, Q1: { ...inputs.gates.quality.Q1, threshold: 0.5 } } };
    expect(verifyReport(base, laxer)).toMatchObject({ ok: false });
  });

  it("there is no publisher in 8B-I1: publishing is refused", async () => {
    const report = await passing();
    await expect(unavailablePublisher.publish(report, inputs.gates)).rejects.toBeInstanceOf(PublisherUnavailableError);
  });
});

describe("Q7 needs the run without the reranker", () => {
  it("fails when the comparison cannot be made", async () => {
    const noBaseline = productionDouble(fixture, { ideal: true, baseline: null });
    const report = await run({ set: enlarged(inputs.set, 8), retrieval: noBaseline });
    expect(report.rerankerComparison.available).toBe(false);
    expect(report.qualityGates.find((gate) => gate.id === "Q7")!.status).toBe("fail");
    expect(report.verdict).toBe("fail");
  });

  it("runs the baseline through the same evaluation (fixture: the reranker is already none, so equal)", async () => {
    const report = await runEvaluation({ set: inputs.set, gates: inputs.gates, declared: { label: "fixture", configuration: fixture.configuration() }, retrieval: fixture, now });
    expect(report.rerankerComparison).toMatchObject({ available: true });
    expect(report.rerankerComparison.withReranker).toEqual(report.rerankerComparison.withoutReranker);
  });
});
