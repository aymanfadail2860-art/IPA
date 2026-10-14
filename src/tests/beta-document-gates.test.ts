import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { EvidenceSet } from "@/lib/knowledge/core/evidence";
import { DEFAULT_DOCUMENT_RETRIEVAL_PARAMS } from "@/lib/knowledge/retrieval-core";

import { createFixtureRetrieval, fixtureUuid as fixtureUuidOf } from "../../evals/engine/fixture-retrieval.ts";
import { decide, evaluateDocumentGates, evaluateHardGates, LOCKED_DOCUMENT_GATES } from "../../evals/engine/gates.ts";
import { computeDocumentMetrics } from "../../evals/engine/metrics.ts";
import { expectedBasis } from "../../evals/engine/observe.ts";
import { verifyReport } from "../../evals/engine/publication.ts";
import { assertGateSetFits, documentQualityFailures, runEvaluation, type EvaluationReport } from "../../evals/engine/runner.ts";
import { DOCUMENT_GATE_SET_FIELDS, validateGateSet } from "../../evals/engine/schema.ts";
import { DOCUMENT_GATE_IDS, gateSetMethod, type CaseObservation, type DocumentMetrics, type EvalCase, type EvalSet, type GateSet, type RetrievalUnderTest } from "../../evals/engine/types.ts";

import { loadExample } from "./fixtures/eval-retrieval";
import { buildDocumentReport, GATES_V1, passingDocuments, PRODUCT_DOCUMENTS_GATES_V1, reseal } from "./fixtures/evaluation-report";
import { fixtureDocumentMaterial, fixtureMaterial } from "./fixtures/production-config";

/**
 * B-036 (beta, L1.1) — the gate set of product_documents: D1–D6, each an invariant (share 1).
 *
 *   * It evaluates only product_documents; Q1–Q7 (gates-v1) only the hybrid method.
 *   * The hard gates H1–H7 stay; H4 and H6 are adapted for the method (exactly the one product;
 *     the whole basis: every valid version, complete, in order, unabridged, within the budget).
 *   * A document gate never makes a run "uncertain": one miss fails it.
 */

const ROOT = path.resolve(__dirname, "../../evals/retrieval");
const readJson = (file: string) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));

describe("the gate set product-documents-gates v1", () => {
  const file = () => structuredClone(readJson("gates/product-documents-gates-v1.json"));
  const errors = (value: unknown) => {
    try {
      validateGateSet(value);
      return "";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };

  it("is valid, names its method and has no K; gates-v1 is unchanged and hybrid", () => {
    const gates = validateGateSet(file());
    expect(gates).toMatchObject({ id: "product-documents-gates", version: 1, decision: "B-036", method: "product_documents" });
    expect("k" in gates).toBe(false);
    expect(gateSetMethod(gates)).toBe("product_documents");
    expect(gateSetMethod(GATES_V1)).toBe("hybrid");
    expect(Object.keys(GATES_V1.quality)).toEqual(["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7"]);
  });

  it("metric, direction and the threshold 1 are locked: an invariant cannot be loosened", () => {
    const lower = file();
    lower.quality.D4.threshold = 0.99;
    expect(errors(lower)).toMatch(/D4\.threshold: skal være 1/);
    const metric = file();
    metric.quality.D3.metric = "valid_version_coverage";
    expect(errors(metric)).toMatch(/D3\.metric: skal være "full_document_integrity"/);
    const direction = file();
    direction.quality.D1.comparator = "<=";
    expect(errors(direction)).toMatch(/D1\.comparator: skal være ">="/);
  });

  it("only D1–D6 — no Q-gate, no hard gate, no K, no other method", () => {
    const withQ = file();
    withQ.quality.Q1 = { metric: "source_recall_at_k", comparator: ">=", threshold: 0.95 };
    expect(errors(withQ)).toMatch(/Q1/);
    const withHard = file();
    withHard.quality.H1 = { metric: "x", comparator: ">=", threshold: 1 };
    expect(errors(withHard)).toMatch(/hårde gates er invarianter/);
    const missing = file();
    delete missing.quality.D6;
    expect(errors(missing)).toMatch(/D6/);
    expect(errors({ ...file(), k: 8 })).toMatch(/k/);
    expect(errors({ ...file(), method: "hybrid" })).toMatch(/gates\.method: skal være "product_documents"/);
  });

  it("the JSON Schema describes the same locked gates", () => {
    const schema = readJson("schema/document-gates.schema.json");
    expect([...schema.required].sort()).toEqual([...DOCUMENT_GATE_SET_FIELDS.required].sort());
    expect(schema.properties.method.const).toBe("product_documents");
    expect([...schema.properties.quality.required]).toEqual([...DOCUMENT_GATE_IDS]);
    for (const id of DOCUMENT_GATE_IDS) expect(schema.properties.quality.properties[id].properties.metric.const).toBe(LOCKED_DOCUMENT_GATES[id].metric);
    expect(schema.$defs.invariant.properties.threshold.const).toBe(1);
    expect(schema.$defs.invariant.properties.comparator.const).toBe(">=");
  });
});

describe("a gate set evaluates exactly its own method", () => {
  const inputs = loadExample();

  it("Q1–Q7 never evaluate product_documents, and D1–D6 never the hybrid method", () => {
    expect(() => assertGateSetFits(inputs.set, GATES_V1, fixtureDocumentMaterial())).toThrow(/gælder retrieval-metoden "hybrid"/);
    expect(() => assertGateSetFits(inputs.set, PRODUCT_DOCUMENTS_GATES_V1, fixtureMaterial())).toThrow(/gælder retrieval-metoden "product_documents"/);
    expect(() => assertGateSetFits(inputs.set, GATES_V1, fixtureMaterial())).not.toThrow();
  });

  it("D1–D6 need exactly one product from the manifest on every active question", () => {
    const set = (products: string[] | undefined): EvalSet => ({ ...inputs.set, cases: inputs.set.cases.map((evalCase) => ({ ...evalCase, filters: { ...evalCase.filters, products } })) });
    expect(() => assertGateSetFits(set(["ansvar-fiktiv"]), PRODUCT_DOCUMENTS_GATES_V1, fixtureDocumentMaterial())).not.toThrow();
    expect(() => assertGateSetFits(set(undefined), PRODUCT_DOCUMENTS_GATES_V1, fixtureDocumentMaterial())).toThrow(/netop ét produkt/);
    expect(() => assertGateSetFits(set(["ansvar-fiktiv", "bygning-fiktiv"]), PRODUCT_DOCUMENTS_GATES_V1, fixtureDocumentMaterial())).toThrow(/netop ét produkt/);
    expect(() => assertGateSetFits(set(["ukendt"]), PRODUCT_DOCUMENTS_GATES_V1, fixtureDocumentMaterial())).toThrow(/netop ét produkt/);
  });
});

describe("D1–D6 and the hard gates catch every way the basis can be wrong", () => {
  const inputs = loadExample();
  const productOf = (evalCase: EvalCase): string => {
    const document = evalCase.expected.passages[0]?.document ?? evalCase.filters?.documents?.[0];
    return inputs.set.manifest.documents.find((entry) => entry.key === document)?.product ?? "ansvar-fiktiv";
  };
  const set: EvalSet = { ...inputs.set, cases: inputs.set.cases.map((evalCase) => ({ ...evalCase, filters: { ...evalCase.filters, products: [productOf(evalCase)] } })) };
  const fixture = createFixtureRetrieval({ manifest: inputs.set.manifest, fixtures: inputs.fixtures, documents: { ...DEFAULT_DOCUMENT_RETRIEVAL_PARAMS }, now: () => new Date() });
  const declared = { label: "product-documents-fixture", configuration: fixture.configuration() };
  const TARGET = "ex-direct-001"; // ansvar-fiktiv, reader_terms: ansvar-betingelser v2, ansvar-tillaeg, ansvar-accept.

  function tampered(change: (result: EvidenceSet) => EvidenceSet, only: string = TARGET): RetrievalUnderTest {
    return {
      ...fixture,
      async run(evalCase) {
        const result = await fixture.run(evalCase);
        return evalCase.id === only ? { ...result, set: change(result.set) } : result;
      },
    };
  }
  async function evaluate(retrieval: RetrievalUnderTest): Promise<EvaluationReport> {
    return runEvaluation({ set, gates: PRODUCT_DOCUMENTS_GATES_V1, declared, retrieval });
  }
  const failing = (report: EvaluationReport) => report.qualityGates.filter((gate) => gate.status === "fail").map((gate) => gate.id);
  const hard = (report: EvaluationReport, caseId = TARGET) => [...new Set(report.cases.find((observation) => observation.caseId === caseId)!.violations.map((violation) => violation.gate))].sort();
  const items = (result: EvidenceSet, keep: (item: EvidenceSet["items"][number], i: number) => boolean) => ({ ...result, items: result.items.filter(keep) });

  it("the untouched method meets every requirement", async () => {
    const report = await evaluate(fixture);
    expect(failing(report)).toEqual([]);
    expect(report.hardGates.filter((gate) => gate.status === "fail").map((gate) => gate.id)).toEqual(["H7"]);
  });

  it("an omitted document (a whole valid version missing): D4 and D6 fail, and H6 — the basis is the contract", async () => {
    const report = await evaluate(tampered((result) => items(result, (item) => item.document.type !== "acceptance_rules")));
    expect(failing(report)).toEqual(["D4", "D6"]);
    expect(hard(report)).toEqual(["H6"]);
    expect(report.cases.find((observation) => observation.caseId === TARGET)!.documents).toMatchObject({ missingVersions: 1, missingDocuments: 1, unexpectedVersions: 0 });
  });

  it("a truncated version (its last chunk missing): D3 and H6 fail", async () => {
    const report = await evaluate(tampered((result) => {
      const counts = new Map<string, number>();
      for (const item of result.items) counts.set(item.documentVersionId, (counts.get(item.documentVersionId) ?? 0) + 1);
      const longest = [...counts].sort((a, b) => b[1] - a[1])[0]![0];
      expect(counts.get(longest)).toBeGreaterThan(1);
      const last = result.items.findLastIndex((item) => item.documentVersionId === longest);
      return items(result, (_, i) => i !== last);
    }));
    expect(failing(report)).toEqual(["D3"]);
    expect(hard(report)).toEqual(["H6"]);
  });

  it("an abridged chunk (silent truncation of the text): D3 and H6 fail", async () => {
    const report = await evaluate(tampered((result) => ({ ...result, items: result.items.map((item, i) => (i === 0 ? { ...item, excerpt: { ...item.excerpt, text: item.excerpt.text.slice(0, 10) } } : item)) })));
    expect(failing(report)).toEqual(["D3"]);
    expect(hard(report)).toEqual(["H6"]);
  });

  it("chunks out of order: D3 and H6 fail", async () => {
    const report = await evaluate(tampered((result) => ({ ...result, items: [...result.items].reverse() })));
    expect(failing(report)).toContain("D3");
    expect(hard(report)).toContain("H6");
  });

  it("an item from another product: D5 and H4 fail", async () => {
    const report = await evaluate(tampered((result) => ({ ...result, items: [...result.items, { ...result.items[0]!, product: { id: "e7a10000-0000-4000-8000-000000000002", name: "Testprodukt Bygning (fiktiv)" } }] })));
    expect(failing(report)).toContain("D5");
    expect(hard(report)).toContain("H4");
  });

  it("the retrieval asked for another product: D5 and H4 fail", async () => {
    const report = await evaluate(tampered((result) => ({ ...result, query: { ...result.query, filters: { ...result.query.filters, productIds: ["e7a10000-0000-4000-8000-000000000002"] } } })));
    expect(failing(report)).toContain("D5");
    expect(hard(report)).toContain("H4");
  });

  it("a failed retrieval meets no requirement, and the run is invalid", async () => {
    const broken: RetrievalUnderTest = {
      ...fixture,
      async run(evalCase) {
        if (evalCase.id === TARGET) throw new Error("Dokumentgrundlaget kunne ikke samles helt.");
        return fixture.run(evalCase);
      },
    };
    const report = await evaluate(broken);
    expect(report.cases.find((observation) => observation.caseId === TARGET)).toMatchObject({ documents: null, error: expect.stringMatching(/kunne ikke samles/) });
    expect(failing(report)).toEqual(["D1", "D2", "D3", "D4", "D5", "D6"]);
    expect(report.valid).toBe(false);
  });

  it("an adapter that cannot show the chunks' text fails D3 and H6 everywhere (fail-closed)", async () => {
    const blind: RetrievalUnderTest = {
      ...fixture,
      async run(evalCase) {
        const run = await fixture.run(evalCase);
        return { ...run, chunkDigests: undefined };
      },
    };
    const report = await evaluate(blind);
    expect(report.qualityGates.find((gate) => gate.id === "D3")).toMatchObject({ status: "fail" });
    expect(report.hardGates.find((gate) => gate.id === "H6")).toMatchObject({ status: "fail" });
  });

  it("a version the actor may not read slipped into the basis: D4 (unexpected) and D6 fail, and H1", async () => {
    const report = await evaluate(tampered((result) => {
      const note = { ...result.items[0]!, documentId: fixtureUuidOf("document:ansvar-accept-notat"), documentVersionId: fixtureUuidOf("version:ansvar-accept-notat:1"), document: { ...result.items[0]!.document, type: "guidance" } };
      return { ...result, items: [...result.items, note] };
    }));
    expect(failing(report)).toEqual(expect.arrayContaining(["D4", "D6"]));
    expect(report.cases.find((observation) => observation.caseId === TARGET)!.documents).toMatchObject({ missingVersions: 0, unexpectedVersions: 1, unexpectedDocuments: 1 });
    expect(hard(report)).toContain("H1");
  });

  it("every miss is listed per question under its gate", async () => {
    const report = await evaluate(tampered((result) => items(result, (item) => item.document.type !== "acceptance_rules")));
    const misses = report.failures.filter((failure) => failure.caseId === TARGET);
    expect(misses.map((failure) => failure.gate).sort()).toEqual(["D4", "D6", "H6"]);
    expect(misses.find((failure) => failure.gate === "D4")!.explanation).toMatch(/1 gyldig\(e\) version\(er\) mangler/);
  });
});

describe("the expected basis comes from the manifest, never from the retrieval", () => {
  const inputs = loadExample();
  const evalCase = (overrides: Partial<EvalCase>): EvalCase => ({ ...inputs.set.cases[0]!, actor: "reader_terms", mode: "as_of", asOf: "2025-03-01", filters: { products: ["ansvar-fiktiv"] }, ...overrides });

  it("a historical version needs the actor's historical grant", () => {
    const withHistorical = expectedBasis(evalCase({}), inputs.set.manifest, "2025-03-01", "2026-10-13");
    expect([...withHistorical]).toContain("ansvar-betingelser\u0000" + "1");
    const manifest = structuredClone(inputs.set.manifest);
    manifest.actors.find((actor) => actor.id === "reader_terms")!.grants.find((grant) => grant.document === "ansvar-betingelser")!.historical = false;
    expect([...expectedBasis(evalCase({}), manifest, "2025-03-01", "2026-10-13")]).not.toContain("ansvar-betingelser\u0000" + "1");
  });

  it("only the case's product, language, document types and documents — and only granted documents", () => {
    const basis = (overrides: Partial<EvalCase>) => [...expectedBasis(evalCase({ mode: "current", asOf: undefined, ...overrides }), inputs.set.manifest, "2026-10-13", "2026-10-13")].map((key) => key.split("\u0000")[0]).sort();
    expect(basis({})).toEqual(["ansvar-accept", "ansvar-betingelser", "ansvar-tillaeg"]);
    expect(basis({ filters: { products: ["ansvar-fiktiv"], documentTypes: ["terms"] } })).toEqual(["ansvar-betingelser", "ansvar-tillaeg"]);
    expect(basis({ filters: { products: ["ansvar-fiktiv"], documents: ["ansvar-tillaeg"] } })).toEqual(["ansvar-tillaeg"]);
    expect(basis({ language: "en" })).toEqual([]);
    expect(basis({ actor: "reader_none" })).toEqual([]);
    expect(basis({ filters: { products: ["ansvar-fiktiv", "bygning-fiktiv"] } })).toEqual([]);
  });
});

describe("the document metrics and gates", () => {
  const observation = (outcome: "evidence" | "insufficient", documents: CaseObservation["documents"]): CaseObservation => ({
    caseId: "c", type: outcome === "evidence" ? "direct" : "unanswerable", split: "dev", outcome, itemCount: 1, empty: false, sourceRank: 1, firstGrade3Rank: 1,
    requiredCovered: 1, requiredTotal: 1, gainsByRank: [], idealGains: [], itemsWithinK: 1, distractorItems: 0, violations: [], error: documents ? null : "x", documents,
  });

  it("D1 and D2 count answerable questions only; the rest count every question", () => {
    const metrics = computeDocumentMetrics([observation("evidence", passingDocuments(true)), observation("insufficient", { ...passingDocuments(false), missingVersions: 1 })]);
    expect(metrics.required_document_coverage).toMatchObject({ value: 1, numerator: 1, denominator: 1 });
    expect(metrics.valid_version_coverage).toMatchObject({ value: 0.5, numerator: 1, denominator: 2 });
  });

  it("an answerable question whose facit names no source cannot meet D1 or D2", () => {
    const metrics = computeDocumentMetrics([observation("evidence", { ...passingDocuments(true), requiredDocuments: 0, requiredDocumentsCovered: 0, requiredPassages: 0, requiredPassagesCovered: 0 })]);
    expect(metrics.required_document_coverage.value).toBe(0);
    expect(metrics.required_passage_coverage.value).toBe(0);
  });

  it("a gate is an invariant: 1 passes, anything less fails, nothing is ever uncertain, and no questions is a failure", () => {
    const perfect = computeDocumentMetrics([observation("evidence", passingDocuments(true))]);
    expect(evaluateDocumentGates(perfect, PRODUCT_DOCUMENTS_GATES_V1).every((gate) => gate.status === "pass" && !gate.uncertain)).toBe(true);
    const almost = computeDocumentMetrics([...Array.from({ length: 99 }, () => observation("evidence", passingDocuments(true))), observation("evidence", { ...passingDocuments(true), incompleteVersions: 1 })]);
    expect(evaluateDocumentGates(almost, PRODUCT_DOCUMENTS_GATES_V1).find((gate) => gate.id === "D3")).toMatchObject({ status: "fail", value: 0.99, uncertain: false });
    const none = computeDocumentMetrics([]) as DocumentMetrics;
    expect(evaluateDocumentGates(none, PRODUCT_DOCUMENTS_GATES_V1).every((gate) => gate.status === "fail" && gate.value === null)).toBe(true);
  });

  it("the decision needs exactly the gate set's gates — a missing or an extra gate fails", () => {
    const quality = evaluateDocumentGates(computeDocumentMetrics([observation("evidence", passingDocuments(true))]), PRODUCT_DOCUMENTS_GATES_V1);
    const minimums = [{ label: "x", minimum: 0, actual: 0, met: true }];
    expect(decide(evaluateHardGates([]), quality, minimums, DOCUMENT_GATE_IDS).verdict).toBe("pass");
    expect(decide(evaluateHardGates([]), quality.slice(1), minimums, DOCUMENT_GATE_IDS).verdict).toBe("fail");
    expect(decide(evaluateHardGates([]), [...quality, { ...quality[0]!, id: "Q1" }], minimums, DOCUMENT_GATE_IDS).verdict).toBe("fail");
    expect(decide(evaluateHardGates([]), quality, minimums).verdict).toBe("fail");
  });

  it("documentQualityFailures names the gate behind each miss", () => {
    const failures = documentQualityFailures([observation("evidence", { ...passingDocuments(true), foreignProductItems: 2, productQueried: false })]);
    expect(failures).toEqual([expect.objectContaining({ gate: "D5", explanation: expect.stringMatching(/ikke spurgt om netop spørgsmålets produkt; 2 element/) })]);
  });
});

describe("a product_documents report is verified as strictly as a hybrid one", () => {
  it("the generated report verifies", () => {
    const report = buildDocumentReport();
    expect(report).toMatchObject({ verdict: "pass", valid: true, rerankerComparison: null, gateSet: { method: "product_documents", k: null } });
    expect(verifyReport(report, PRODUCT_DOCUMENTS_GATES_V1)).toEqual({ ok: true });
  });

  it("forgeries are refused, also with recomputed checksums", () => {
    const problems = (change: (report: EvaluationReport) => void, gates: GateSet = PRODUCT_DOCUMENTS_GATES_V1) => {
      const report = buildDocumentReport();
      change(report);
      const result = verifyReport(reseal(report), gates);
      return result.ok ? [] : result.problems;
    };
    expect(problems((report) => { (report.metrics as DocumentMetrics).valid_version_coverage.value = 0.5; })).toContain("Metrikkerne kan ikke genberegnes fra observationerne.");
    expect(problems((report) => { report.cases[0]!.documents!.incompleteVersions = 1; })).toEqual(expect.arrayContaining(["Metrikkerne kan ikke genberegnes fra observationerne."]));
    expect(problems((report) => { report.rerankerComparison = { available: false, withReranker: { passage_recall_at_k: null, mrr_at_k: null }, withoutReranker: { passage_recall_at_k: null, mrr_at_k: null } }; }))
      .toContain("En kørsel af product_documents har ingen sammenligning uden reranker.");
    expect(problems((report) => { delete report.cases[0]!.documents; })).toContain("En observation mangler sin dokumentobservation.");
    expect(problems((report) => { report.qualityGates[0]!.uncertain = true; })).toContain("Kvalitetsgates kan ikke genberegnes med gate-sættet.");
    expect(problems((report) => { report.gateSet.method = "hybrid"; })).toContain("Rapporten beskriver gate-sættets metode anderledes end gate-sættet.");
    expect(problems(() => undefined, GATES_V1)).toEqual(expect.arrayContaining(["Gate-sættet gælder en anden retrieval-metode end konfigurationen."]));
  });
});
