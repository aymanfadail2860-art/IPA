import { wilson } from "./metrics.ts";

/**
 * Beta acceptance of the AI's finished answers (docs/beta.md §5.2, B-036) — the end-to-end check
 * that the retrieval evaluation does NOT replace. Retrieval gates (H1–H7, D1–D6) judge whether the
 * method delivers the right documents; this judges whether Claude's answers built on them are
 * professionally correct.
 *
 * Three things are kept apart, and none of them implies another (ai.beta_status):
 *   1. an approved retrieval configuration (knowledge.retrieval_configurations);
 *   2. validated AI answer quality (ai.answer_quality_validations) — this module's subject;
 *   3. a beta version approved for advisers (ai.beta_release_approvals).
 *
 * The answers are graded by people, question by question. This module validates the grading and
 * applies the locked criteria — the same rules as ai.record_answer_quality. It never validates
 * anything: meeting the criteria only makes a result VALIDATABLE, and a person with
 * knowledge.version.publish must then validate it, accepting the statistical uncertainty
 * explicitly. A run with the stub or any non-Claude model can never meet the criteria.
 */

export const ACCEPTANCE_CATEGORIES = [
  "direct",
  "exception",
  "multi_clause",
  "missing_coverage",
  "similar_product",
  "historical",
  "conflict",
  "unanswerable",
  "permission",
] as const;
export type AcceptanceCategory = (typeof ACCEPTANCE_CATEGORIES)[number];

/** Locked in code and in the database (ai.record_answer_quality). A new version needs a decision. */
export const ACCEPTANCE_CRITERIA = Object.freeze({
  id: "beta-answer-acceptance",
  version: 1,
  decision: "B-036",
  minimumQuestions: 40,
  /** Fully correct answers as a share of all questions (point estimate). */
  minimumFullyCorrect: 0.95,
  maximumCriticalErrors: 0,
  maximumInventedCitations: 0,
  maximumExceptionFailures: 0,
  maximumRefusalFailures: 0,
  /** Only a real Claude model can pass; the stub and test models never can. */
  modelPattern: /^claude-[a-z0-9.-]+$/,
});

/** One question of the E2E set (authored in L9). The facit is the professional expectation. */
export interface AcceptanceCase {
  id: string;
  category: AcceptanceCategory;
  /** The product's stable id: Copilot answers about exactly one product. */
  productId: string;
  question: string;
  expected: {
    /** The professionally correct conclusion, in the grader's words. */
    conclusion: string;
    /** Sources the answer must cite (document key, version label, verbatim anchor). */
    mustCite: { document: string; version: string; anchor: string }[];
    /** Exceptions and limitations the answer must state. */
    exceptions: string[];
    /** True when the basis is insufficient and the answer must say so instead of answering. */
    refusal: boolean;
  };
  author: string;
  created: string;
  notes: string;
}

/** A person's grading of one answer. */
export interface GradedAnswer {
  caseId: string;
  category: AcceptanceCategory;
  correctness: "full" | "partial" | "wrong";
  /** A professional error that could mislead an adviser about coverage, exceptions, validity or rights. */
  critical: boolean;
  /** The answer cites a source, page or passage that does not exist or does not say it. */
  inventedCitation: boolean;
  exceptions: "correct" | "incorrect" | "not_applicable";
  refusal: "correct" | "missing" | "unwarranted" | "not_applicable";
  note?: string;
}

/** What is recorded through ai.record_answer_quality. */
export interface AcceptanceRun {
  criteria: { id: "beta-answer-acceptance"; version: 1 };
  evalSet: { id: string; version: number; checksum: string };
  retrievalConfigurationId: string;
  model: { id: string; version: string };
  profile: { id: string; version: string };
  results: GradedAnswer[];
}

export interface AcceptanceDecision {
  /** The criteria are met. The result is then validatable — never validated by this module. */
  criteriaMet: boolean;
  validated: false;
  problems: string[];
  questions: number;
  fullyCorrect: number;
  criticalErrors: number;
  inventedCitations: number;
  exceptionFailures: number;
  refusalFailures: number;
  categories: Record<AcceptanceCategory, number>;
  /** Lower bound of the 95 % Wilson interval for the share of fully correct answers (reported). */
  fullyCorrectLowerBound: number | null;
}

export class AcceptanceError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Bedømmelsen er ugyldig:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
    this.name = "AcceptanceError";
    this.problems = problems;
  }
}

const CASE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const keysAre = (value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) =>
  required.every((key) => key in value) && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));

/** The grading of one answer (ai.graded_answer_problem). Null = valid. */
export function gradedAnswerProblem(value: unknown): string | null {
  if (!isRecord(value) || !keysAre(value, ["caseId", "category", "correctness", "critical", "inventedCitation", "exceptions", "refusal"], ["note"])) {
    return "en bedømmelse har ikke de forventede felter";
  }
  const id = typeof value.caseId === "string" ? value.caseId : "?";
  if (
    typeof value.caseId !== "string" || !CASE_ID.test(value.caseId) ||
    !(ACCEPTANCE_CATEGORIES as readonly unknown[]).includes(value.category) ||
    !["full", "partial", "wrong"].includes(value.correctness as string) ||
    typeof value.critical !== "boolean" || typeof value.inventedCitation !== "boolean" ||
    !["correct", "incorrect", "not_applicable"].includes(value.exceptions as string) ||
    !["correct", "missing", "unwarranted", "not_applicable"].includes(value.refusal as string) ||
    (value.note !== undefined && (typeof value.note !== "string" || value.note.length > 2000))
  ) {
    return `bedømmelsen af ${id} er ugyldig`;
  }
  if (value.category === "exception" && value.exceptions === "not_applicable") return `${id}: et spørgsmål om undtagelser skal bedømmes på undtagelserne`;
  if ((value.category === "unanswerable" || value.category === "permission") && value.refusal === "not_applicable") {
    return `${id}: et spørgsmål uden tilstrækkeligt grundlag skal bedømmes på afvisningen`;
  }
  return null;
}

/** Fully correct: right, and no critical error, invented citation, exception or refusal failure. */
export function fullyCorrect(answer: GradedAnswer): boolean {
  return (
    answer.correctness === "full" && !answer.critical && !answer.inventedCitation && answer.exceptions !== "incorrect" &&
    (answer.refusal === "correct" || answer.refusal === "not_applicable")
  );
}

export function validateAcceptanceRun(value: unknown): AcceptanceRun {
  const problems: string[] = [];
  if (!isRecord(value) || !keysAre(value, ["criteria", "evalSet", "retrievalConfigurationId", "model", "profile", "results"])) {
    throw new AcceptanceError(["bedømmelsen har ikke det forventede format"]);
  }
  if (!isRecord(value.criteria) || value.criteria.id !== ACCEPTANCE_CRITERIA.id || value.criteria.version !== ACCEPTANCE_CRITERIA.version || Object.keys(value.criteria).length !== 2) {
    problems.push(`kun kriterierne ${ACCEPTANCE_CRITERIA.id} v${ACCEPTANCE_CRITERIA.version} kan bruges`);
  }
  const evalSet = value.evalSet;
  if (!isRecord(evalSet) || typeof evalSet.id !== "string" || !Number.isInteger(evalSet.version) || typeof evalSet.checksum !== "string" || !/^[0-9a-f]{64}$/.test(evalSet.checksum)) {
    problems.push("evalueringssættet skal have id, version og checksum");
  }
  if (typeof value.retrievalConfigurationId !== "string" || !/^[0-9a-f-]{36}$/.test(value.retrievalConfigurationId)) problems.push("retrieval-konfigurationens id mangler");
  for (const key of ["model", "profile"] as const) {
    const entry = value[key];
    if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.version !== "string" || entry.id.length === 0 || entry.version.length === 0) problems.push(`${key} skal have id og version`);
  }
  if (!Array.isArray(value.results) || value.results.length === 0) problems.push("bedømmelsen har ingen spørgsmål");
  else {
    for (const result of value.results) {
      const problem = gradedAnswerProblem(result);
      if (problem) problems.push(problem);
    }
    const ids = value.results.map((result) => (isRecord(result) ? result.caseId : null));
    if (new Set(ids).size !== ids.length) problems.push("et spørgsmål er bedømt mere end én gang");
  }
  if (problems.length > 0) throw new AcceptanceError(problems);
  return value as unknown as AcceptanceRun;
}

/** The locked criteria applied to a validated run (ai.record_answer_quality). */
export function decideAcceptance(run: AcceptanceRun): AcceptanceDecision {
  const results = run.results;
  const questions = results.length;
  const fully = results.filter(fullyCorrect).length;
  const criticalErrors = results.filter((answer) => answer.critical).length;
  const inventedCitations = results.filter((answer) => answer.inventedCitation).length;
  const exceptionFailures = results.filter((answer) => answer.exceptions === "incorrect").length;
  const refusalFailures = results.filter((answer) => answer.refusal === "missing" || answer.refusal === "unwarranted").length;
  const categories = Object.fromEntries(ACCEPTANCE_CATEGORIES.map((category) => [category, results.filter((answer) => answer.category === category).length])) as Record<AcceptanceCategory, number>;
  const c = ACCEPTANCE_CRITERIA;

  const problems: string[] = [];
  if (questions < c.minimumQuestions) problems.push(`for få spørgsmål: ${questions} (mindst ${c.minimumQuestions})`);
  const missing = ACCEPTANCE_CATEGORIES.filter((category) => categories[category] === 0);
  if (missing.length > 0) problems.push(`kategorier uden spørgsmål: ${[...missing].sort().join(", ")}`);
  // Integer arithmetic, as the database: fully / questions ≥ 0.95 ⇔ 100·fully ≥ 95·questions.
  if (fully * 100 < Math.round(c.minimumFullyCorrect * 100) * questions) problems.push(`${fully} af ${questions} fuldt korrekte (mindst 95 %)`);
  if (criticalErrors > c.maximumCriticalErrors) problems.push(`${criticalErrors} kritiske fejl`);
  if (inventedCitations > c.maximumInventedCitations) problems.push(`${inventedCitations} opdigtede kildehenvisninger`);
  if (exceptionFailures > c.maximumExceptionFailures) problems.push(`${exceptionFailures} fejl i undtagelser og begrænsninger`);
  if (refusalFailures > c.maximumRefusalFailures) problems.push(`${refusalFailures} manglende eller uberettigede afvisninger`);
  if (!c.modelPattern.test(run.model.id)) problems.push(`modellen "${run.model.id}" er ikke en rigtig Claude-model`);

  return {
    criteriaMet: problems.length === 0,
    validated: false,
    problems,
    questions,
    fullyCorrect: fully,
    criticalErrors,
    inventedCitations,
    exceptionFailures,
    refusalFailures,
    categories,
    fullyCorrectLowerBound: wilson(fully, questions)?.lower ?? null,
  };
}
