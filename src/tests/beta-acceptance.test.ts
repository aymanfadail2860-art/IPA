import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  ACCEPTANCE_CATEGORIES,
  ACCEPTANCE_CRITERIA,
  AcceptanceError,
  decideAcceptance,
  fullyCorrect,
  gradedAnswerProblem,
  validateAcceptanceRun,
  type AcceptanceRun,
  type GradedAnswer,
} from "../../evals/engine/acceptance.ts";

/**
 * B-036 (beta, L1.1) — the acceptance control for the AI's finished answers. It is separate from
 * the retrieval gates, and meeting it never validates anything: a person validates (in the
 * database), and the stub can never pass. The same locked rules as ai.record_answer_quality.
 */

function answer(i: number, overrides: Partial<GradedAnswer> = {}): GradedAnswer {
  const category = ACCEPTANCE_CATEGORIES[i % ACCEPTANCE_CATEGORIES.length]!;
  return {
    caseId: `e2e-${i + 1}`,
    category,
    correctness: "full",
    critical: false,
    inventedCitation: false,
    exceptions: category === "exception" ? "correct" : "not_applicable",
    refusal: category === "unanswerable" || category === "permission" ? "correct" : "not_applicable",
    ...overrides,
  };
}

function run(n = 40, change: (answers: GradedAnswer[]) => void = () => undefined, model = "claude-sonnet-5-5"): AcceptanceRun {
  const results = Array.from({ length: n }, (_, i) => answer(i));
  change(results);
  return {
    criteria: { id: "beta-answer-acceptance", version: 1 },
    evalSet: { id: "beta-e2e", version: 1, checksum: "e".repeat(64) },
    retrievalConfigurationId: "a0000000-0000-4000-8000-000000000001",
    model: { id: model, version: "1" },
    profile: { id: "copilot", version: "1" },
    results,
  };
}

describe("the locked acceptance criteria", () => {
  it("the criteria file states exactly what the code enforces", () => {
    const file = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../evals/acceptance/beta-answer-acceptance-v1.json"), "utf8"));
    expect(file).toMatchObject({
      id: ACCEPTANCE_CRITERIA.id,
      version: ACCEPTANCE_CRITERIA.version,
      decision: ACCEPTANCE_CRITERIA.decision,
      minimumQuestions: 40,
      minimumFullyCorrect: 0.95,
      maximumCriticalErrors: 0,
      maximumInventedCitations: 0,
      maximumExceptionFailures: 0,
      maximumRefusalFailures: 0,
    });
    expect([...file.categories].sort()).toEqual([...ACCEPTANCE_CATEGORIES].sort());
  });

  it("the database has the same categories (ai.acceptance_categories)", () => {
    const sql = fs.readFileSync(path.resolve(__dirname, "../../supabase/migrations/20261013000200_beta_acceptance.sql"), "utf8");
    const listed = sql.match(/function ai\.acceptance_categories\(\)[\s\S]*?select array\[([^\]]+)\]/)![1]!.match(/'([a-z_]+)'/g)!.map((entry) => entry.slice(1, -1));
    expect([...listed].sort()).toEqual([...ACCEPTANCE_CATEGORIES].sort());
  });
});

describe("deciding a graded run", () => {
  it("40 of 40 fully correct with a Claude model: the criteria are met — but nothing is validated", () => {
    const decision = decideAcceptance(validateAcceptanceRun(run()));
    expect(decision).toMatchObject({ criteriaMet: true, validated: false, problems: [], questions: 40, fullyCorrect: 40 });
    expect(decision.fullyCorrectLowerBound).toBeCloseTo(0.912, 3);
  });

  it("95 % is the point estimate: 38 of 40 meets it (lower bound ≈ 0.83, reported), 37 of 40 does not", () => {
    const met = decideAcceptance(run(40, (answers) => answers.slice(0, 2).forEach((entry) => (entry.correctness = "partial"))));
    expect(met).toMatchObject({ criteriaMet: true, fullyCorrect: 38 });
    expect(met.fullyCorrectLowerBound).toBeCloseTo(0.835, 2);
    const missed = decideAcceptance(run(40, (answers) => answers.slice(0, 3).forEach((entry) => (entry.correctness = "wrong"))));
    expect(missed.criteriaMet).toBe(false);
    expect(missed.problems).toContain("37 af 40 fuldt korrekte (mindst 95 %)");
  });

  it("the stub, a test model or anything but a Claude model can never meet the criteria", () => {
    for (const model of ["stub", "test-model", "Claude-sonnet", "gpt-x", ""]) {
      expect(decideAcceptance(run(40, undefined, model)).problems).toContain(`modellen "${model}" er ikke en rigtig Claude-model`);
    }
  });

  it("zero tolerance: one critical error, invented citation, exception failure or refusal failure", () => {
    const one = (change: (entry: GradedAnswer) => void) => decideAcceptance(run(40, (answers) => change(answers[1]!)));
    expect(one((entry) => (entry.critical = true)).problems).toContain("1 kritiske fejl");
    expect(one((entry) => (entry.inventedCitation = true)).problems).toContain("1 opdigtede kildehenvisninger");
    expect(one((entry) => (entry.exceptions = "incorrect")).problems).toContain("1 fejl i undtagelser og begrænsninger");
    expect(decideAcceptance(run(40, (answers) => (answers[7]!.refusal = "missing"))).problems).toContain("1 manglende eller uberettigede afvisninger");
    expect(decideAcceptance(run(40, (answers) => (answers[0]!.refusal = "unwarranted"))).problems).toContain("1 manglende eller uberettigede afvisninger");
  });

  it("at least 40 questions, and every category", () => {
    expect(decideAcceptance(run(39)).problems).toContain("for få spørgsmål: 39 (mindst 40)");
    const withoutPermission = run(40, (answers) => answers.forEach((entry) => {
      if (entry.category === "permission") Object.assign(entry, { category: "direct", refusal: "not_applicable" });
    }));
    expect(decideAcceptance(withoutPermission).problems).toContain("kategorier uden spørgsmål: permission");
  });

  it("fully correct means right AND no critical error, invented citation, exception or refusal failure", () => {
    expect(fullyCorrect(answer(0))).toBe(true);
    expect(fullyCorrect(answer(0, { critical: true }))).toBe(false);
    expect(fullyCorrect(answer(0, { inventedCitation: true }))).toBe(false);
    expect(fullyCorrect(answer(1, { exceptions: "incorrect" }))).toBe(false);
    expect(fullyCorrect(answer(7, { refusal: "missing" }))).toBe(false);
    expect(fullyCorrect(answer(0, { correctness: "partial" }))).toBe(false);
  });
});

describe("validating the grading (ai.graded_answer_problem)", () => {
  it("refuses unknown fields, categories and grades", () => {
    expect(gradedAnswerProblem({ ...answer(0), extra: 1 })).toMatch(/forventede felter/);
    expect(gradedAnswerProblem({ ...answer(0), category: "advise" })).toMatch(/ugyldig/);
    expect(gradedAnswerProblem({ ...answer(0), correctness: "mostly" })).toMatch(/ugyldig/);
    expect(gradedAnswerProblem({ ...answer(0), note: "x".repeat(2001) })).toMatch(/ugyldig/);
  });

  it("a question about exceptions is graded on its exceptions; an unanswerable or permission question on its refusal", () => {
    expect(gradedAnswerProblem(answer(1, { exceptions: "not_applicable" }))).toMatch(/undtagelserne/);
    expect(gradedAnswerProblem(answer(7, { refusal: "not_applicable" }))).toMatch(/afvisningen/);
    expect(gradedAnswerProblem(answer(8, { refusal: "not_applicable" }))).toMatch(/afvisningen/);
  });

  it("refuses another criteria version, a duplicate question and an incomplete run", () => {
    expect(() => validateAcceptanceRun({ ...run(), criteria: { id: "beta-answer-acceptance", version: 2 } })).toThrow(AcceptanceError);
    expect(() => validateAcceptanceRun(run(40, (answers) => (answers[1]!.caseId = "e2e-1")))).toThrow(/mere end én gang/);
    expect(() => validateAcceptanceRun({ ...run(), evalSet: { id: "x", version: 1, checksum: "nope" } })).toThrow(/evalueringssættet/);
    expect(() => validateAcceptanceRun({ ...run(), results: [] })).toThrow(/ingen spørgsmål/);
    expect(() => validateAcceptanceRun({ ...run(), extra: true })).toThrow(/format/);
  });
});
