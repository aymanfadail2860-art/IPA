import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DOCUMENT_TYPES } from "@/lib/knowledge/document-types";

import {
  CASE_FIELDS,
  EvalSetError,
  EXPECTED_FIELDS,
  GATE_SET_FIELDS,
  GateSetError,
  LOCKED_QUALITY_GATES,
  MANIFEST_FIELDS,
  parseCasesJsonl,
  validateDeclaredConfiguration,
  validateEvalSet,
  validateGateSet,
} from "../../evals/engine/schema.ts";
import { CASE_MODES, CASE_OUTCOMES, CASE_SPLITS, CASE_TYPES, QUALITY_GATE_IDS, type EvalCase } from "../../evals/engine/types.ts";
import { loadExample } from "./fixtures/eval-retrieval";

/** 8B-I1 — evalueringssættets og gate-sættets format (docs/08b §4.4, §5.2–§5.6). */

const ROOT = path.resolve(__dirname, "../../evals/retrieval");
const readJson = (file: string) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));

const example = loadExample();
const manifest = example.set.manifest;
const direct = () => structuredClone(example.set.cases.find((evalCase) => evalCase.id === "ex-direct-001")!) as EvalCase & Record<string, unknown>;

function errorsFor(cases: unknown[], manifestValue: unknown = manifest): string[] {
  try {
    validateEvalSet(manifestValue, cases);
    return [];
  } catch (error) {
    if (!(error instanceof EvalSetError)) throw error;
    return error.errors.map((entry) => `${entry.path}: ${entry.message}`);
  }
}

function caseErrors(mutate: (evalCase: Record<string, unknown> & EvalCase) => void): string[] {
  const evalCase = direct();
  mutate(evalCase);
  return errorsFor([evalCase]);
}

describe("evaluation case schema v1", () => {
  it("accepts the example set", () => {
    expect(example.set.cases.length).toBe(15);
    expect(errorsFor(example.set.cases)).toEqual([]);
  });

  it.each([
    ["a missing field", (c: Record<string, unknown>) => delete c.question, /question: mangler/],
    ["an unknown field (a typo cannot silently drop a facit)", (c: Record<string, unknown>) => (c.expectd = {}), /expectd: ukendt felt/],
    ["a wrong schema version", (c: Record<string, unknown>) => (c.schema = 2), /schema: skal være 1/],
    ["an unknown type", (c: Record<string, unknown>) => (c.type = "trick"), /type: skal være én af/],
    ["an empty question", (c: Record<string, unknown>) => (c.question = "  "), /question: må ikke være tom/],
    ["a too long question", (c: Record<string, unknown>) => (c.question = "x".repeat(1001)), /question: må højst være 1000 tegn/],
    ["an unknown mode", (c: Record<string, unknown>) => (c.mode = "future"), /mode: skal være én af/],
    ["asOf without as_of", (c: Record<string, unknown>) => (c.asOf = "2025-01-01"), /asOf: må kun angives med mode "as_of"/],
    ["as_of without a date", (c: Record<string, unknown>) => (c.mode = "as_of"), /asOf: skal være en gyldig dato/],
    ["an impossible date", (c: Record<string, unknown>) => ((c.mode = "as_of"), (c.asOf = "2025-02-30")), /asOf: skal være en gyldig dato/],
    ["an unknown split", (c: Record<string, unknown>) => (c.split = "test"), /split: skal være én af/],
    ["empty notes", (c: Record<string, unknown>) => (c.notes = ""), /notes: må ikke være tom/],
    ["retired without a reason", (c: Record<string, unknown>) => (c.retired = true), /retiredReason: skal være tekst/],
    ["a reason without retired", (c: Record<string, unknown>) => (c.retiredReason = "x"), /retiredReason: kræver retired: true/],
    ["an unknown document type filter", (c: Record<string, unknown>) => (c.filters = { documentTypes: ["memo"] }), /documentTypes\[0\]: skal være én af/],
    ["an empty filter object", (c: Record<string, unknown>) => (c.filters = {}), /filters: må ikke være tom/],
    ["a too short anchor", (c: EvalCase) => (c.expected.passages[0]!.anchor = "10.000"), /anchor: må ikke være tom/],
    ["a grade outside 1–3", (c: EvalCase) => ((c.expected.passages[0] as { grade: number }).grade = 4), /grade: skal være én af/],
    ["an unknown outcome", (c: EvalCase) => ((c.expected as { outcome: string }).outcome = "maybe"), /outcome: skal være én af/],
  ])("rejects %s", (_label, mutate, pattern) => {
    expect(caseErrors(mutate as (c: Record<string, unknown> & EvalCase) => void).join("\n")).toMatch(pattern);
  });

  it("enforces the facit rules of every question type (docs/08b §5.3)", () => {
    const of = (type: string, change: (c: EvalCase) => void = () => {}) =>
      caseErrors((c) => {
        (c as { type: string }).type = type;
        change(c);
      }).join("\n");
    expect(of("multi_chunk")).toMatch(/multi_chunk kræver mindst to passager med grad 3/);
    expect(of("historical")).toMatch(/historical kræver mode "as_of"/);
    expect(of("conflict")).toMatch(/conflict kræver de to dokumenter/);
    expect(of("unanswerable")).toMatch(/unanswerable kræver "insufficient"/);
    expect(of("distractor")).toMatch(/distractor kræver mindst én distraktor/);
    expect(of("permission")).toMatch(/permission kræver "insufficient"/);
    expect(of("filter")).toMatch(/filter kræver mindst ét filter/);
    expect(of("direct", (c) => ((c.expected as { outcome: string }).outcome = "insufficient"))).toMatch(/skal være tom ved outcome "insufficient"/);
    expect(of("direct", (c) => (c.expected.passages[0]!.grade = 2))).toMatch(/mindst én passage med grad 3/);
  });

  it("cross-checks every case against the manifest", () => {
    expect(caseErrors((c) => (c.actor = "reader_ghost")).join()).toMatch(/actor: findes ikke i manifestet/);
    expect(caseErrors((c) => (c.expected.passages[0]!.document = "ukendt-dokument")).join()).toMatch(/ukendt dokument/);
    expect(caseErrors((c) => (c.expected.passages[0]!.version = "9")).join()).toMatch(/ukendt version "9"/);
    // A facit the actor cannot see can never be met: a set error, not a retrieval error.
    expect(caseErrors((c) => (c.actor = "reader_none")).join()).toMatch(/reader_none har ikke adgang til ansvar-betingelser/);
    expect(caseErrors((c) => (c.filters = { products: ["ukendt-produkt"] })).join()).toMatch(/ukendt produkt/);
    const perm = structuredClone(example.set.cases.find((evalCase) => evalCase.id === "ex-perm-001")!);
    perm.expected.permissions!.forbiddenDocuments = ["ansvar-betingelser"];
    expect(errorsFor([perm]).join()).toMatch(/reader_terms har faktisk adgang til ansvar-betingelser/);
    const conflict = structuredClone(example.set.cases.find((evalCase) => evalCase.id === "ex-conflict-001")!);
    conflict.expected.conflict = { documents: ["ansvar-betingelser", "ansvar-tillaeg"] };
    expect(errorsFor([conflict]).join()).toMatch(/konflikten er ikke erklæret som åben/);
  });

  it("rejects duplicate ids, an empty set and a broken JSON line", () => {
    expect(errorsFor([direct(), direct()]).join()).toMatch(/er brugt før \(ex-direct-001\)/);
    expect(errorsFor([]).join()).toMatch(/sættet har ingen spørgsmål/);
    const parsed = parseCasesJsonl(`${JSON.stringify(direct())}\n\n{"id": \n`);
    expect(parsed.cases).toHaveLength(1);
    expect(parsed.errors).toEqual([{ path: "linje 3", message: "er ikke gyldig JSON" }]);
  });

  it("validates the manifest: unknown references, fixtures that are not fictional, bad validity", () => {
    const broken = structuredClone(manifest) as unknown as Record<string, unknown> & typeof manifest;
    broken.documents[0]!.fictional = false;
    broken.documents[0]!.versions[0]!.validTo = "2023-01-01";
    broken.actors[0]!.grants.push({ document: "findes-ikke", historical: false });
    broken.conflicts.push({ id: "x", documents: ["ansvar-accept", "ansvar-accept"], status: "open" });
    const errors = errorsFor([direct()], broken).join("\n");
    expect(errors).toMatch(/fictional: materiale i fixtures skal være fiktivt/);
    expect(errors).toMatch(/validTo: skal ligge efter validFrom/);
    expect(errors).toMatch(/grants\[6\]\.document: findes ikke i manifest\.documents/);
    expect(errors).toMatch(/skal være to forskellige dokumenter/);
  });
});

describe("the JSON Schemas describe the same format the engine enforces", () => {
  const caseSchema = readJson("schema/case.schema.json");
  const manifestSchema = readJson("schema/manifest.schema.json");
  const gatesSchema = readJson("schema/gates.schema.json");
  const sorted = (values: readonly unknown[]) => [...values].map(String).sort();

  it("case: fields, enums and limits", () => {
    expect(sorted(caseSchema.required)).toEqual(sorted(CASE_FIELDS.required));
    expect(sorted(Object.keys(caseSchema.properties))).toEqual(sorted([...CASE_FIELDS.required, ...CASE_FIELDS.optional]));
    expect(sorted(caseSchema.properties.type.enum)).toEqual(sorted(CASE_TYPES));
    expect(sorted(caseSchema.properties.mode.enum)).toEqual(sorted(CASE_MODES));
    expect(sorted(caseSchema.properties.split.enum)).toEqual(sorted(CASE_SPLITS));
    expect(caseSchema.properties.schema.const).toBe(1);
    const expected = caseSchema.properties.expected;
    expect(sorted(expected.required)).toEqual(sorted(EXPECTED_FIELDS.required));
    expect(sorted(Object.keys(expected.properties))).toEqual(sorted([...EXPECTED_FIELDS.required, ...EXPECTED_FIELDS.optional]));
    expect(sorted(expected.properties.outcome.enum)).toEqual(sorted(CASE_OUTCOMES));
    expect(sorted(caseSchema.properties.filters.properties.documentTypes.items.enum)).toEqual(sorted(DOCUMENT_TYPES.map((type) => type.key)));
    expect(caseSchema.properties.question.maxLength).toBe(1000);
  });

  it("manifest: fields and document types", () => {
    expect(sorted(manifestSchema.required)).toEqual(sorted(MANIFEST_FIELDS.required));
    expect(sorted(manifestSchema.properties.documents.items.properties.type.enum)).toEqual(sorted(DOCUMENT_TYPES.map((type) => type.key)));
  });

  it("gates: only Q1–Q7, with the locked metric and direction", () => {
    expect(sorted(gatesSchema.required)).toEqual(sorted(GATE_SET_FIELDS.required));
    expect(sorted(gatesSchema.properties.quality.required)).toEqual(sorted(QUALITY_GATE_IDS));
    for (const id of QUALITY_GATE_IDS) {
      expect(gatesSchema.properties.quality.properties[id].properties.metric.const).toBe(LOCKED_QUALITY_GATES[id].metric);
      expect(gatesSchema.properties.quality.properties[id].properties.comparator.const).toBe(LOCKED_QUALITY_GATES[id].comparator);
    }
    expect(gatesSchema.properties.quality.additionalProperties).toBe(false);
  });
});

describe("gate set validation (docs/08b §4.4, D-6)", () => {
  const gates = () => structuredClone(readJson("gates/gates-v1.json"));
  const messages = (value: unknown) => {
    try {
      validateGateSet(value);
      return "";
    } catch (error) {
      if (!(error instanceof GateSetError)) throw error;
      return error.errors.map((entry) => `${entry.path}: ${entry.message}`).join("\n");
    }
  };

  it("accepts gates-v1 and freezes it", () => {
    const value = validateGateSet(gates());
    expect(Object.isFrozen(value)).toBe(true);
  });

  it.each(["H1", "H2", "H3", "H4", "H5", "H6", "H7"])("refuses hard gate %s as data — hard gates are invariants", (id) => {
    const value = gates();
    value.quality[id] = { metric: "source_recall_at_k", comparator: ">=", threshold: 0 };
    expect(messages(value)).toMatch(new RegExp(`quality\\.${id}: hårde gates er invarianter`));
  });

  it("refuses a flipped comparator or a different metric (a gate cannot be loosened by its direction)", () => {
    const flipped = gates();
    flipped.quality.Q5.comparator = ">=";
    expect(messages(flipped)).toMatch(/Q5\.comparator: skal være "<="/);
    const swapped = gates();
    swapped.quality.Q1.metric = "mrr_at_k";
    expect(messages(swapped)).toMatch(/Q1\.metric: skal være "source_recall_at_k"/);
  });

  it("refuses thresholds outside [0,1], missing thresholds, a threshold on Q7, a missing gate and another K", () => {
    const value = gates();
    value.quality.Q1.threshold = 1.5;
    delete value.quality.Q2.threshold;
    value.quality.Q7.threshold = 0;
    delete value.quality.Q6;
    value.k = 10;
    const text = messages(value);
    expect(text).toMatch(/Q1\.threshold: skal være et tal mellem 0 og 1/);
    expect(text).toMatch(/Q2\.threshold: skal være et tal mellem 0 og 1/);
    expect(text).toMatch(/Q7\.threshold: Q7 sammenligner/);
    expect(text).toMatch(/quality\.Q6: mangler/);
    expect(text).toMatch(/gates\.k: skal være 8/);
  });

  it("requires a decision reference", () => {
    const value = gates();
    value.decision = "godkendt";
    expect(messages(value)).toMatch(/decision: har ugyldigt format/);
  });
});

describe("declared configuration", () => {
  it("accepts the fixture configuration — provider and model are data", () => {
    const declared = validateDeclaredConfiguration(readJson("configurations/fixture-development.json"));
    expect(declared.configuration.embedding?.provider).toBe("test");
  });

  it("rejects a malformed configuration", () => {
    const value = readJson("configurations/fixture-development.json");
    value.configuration.params.topK = 0;
    value.configuration.chunkerVersions = [];
    value.configuration.extra = true;
    expect(() => validateDeclaredConfiguration(value)).toThrow(/extra: ukendt felt[\s\S]*topK: skal være et positivt heltal[\s\S]*chunkerVersions: skal have mindst 1/);
  });
});
