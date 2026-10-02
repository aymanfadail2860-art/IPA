import type { SentPart } from "./types";

/**
 * Output contracts (docs/08 §4.3). Validated deterministically AFTER the model call. A breach
 * means the answer is never shown — the outcome is "unverifiable" (B-016) with a reason code.
 *
 * A citation may only point to evidence that was actually sent. Historical and conflicting
 * evidence must be marked by the answer itself.
 */

export type Segment = { text: string } | { cite: string };
export type Paragraph = Segment[];

export interface CopilotOutput {
  kind: "answer" | "conflict" | "insufficient";
  historical: boolean;
  paragraphs: Paragraph[];
}
export interface LearnOutput {
  paragraphs: Paragraph[];
  examples: { text: string; fictional: true }[];
}
export interface RoleplayTurnOutput {
  reply: string;
}
export interface PracticeFeedbackOutput {
  points: Paragraph[];
}
export interface AdviseOutput {
  suggestions: { status: "ai_suggestion"; segments: Paragraph }[];
}
export interface AssessmentOutput {
  criteria: { criterion: string; verdict: "met" | "partial" | "not_met"; cites: string[] }[];
}

export type ContractOutput = CopilotOutput | LearnOutput | RoleplayTurnOutput | PracticeFeedbackOutput | AdviseOutput | AssessmentOutput;

export type ContractReason =
  | "malformed"
  | "too_long"
  | "uncited_paragraph"
  | "unknown_citation"
  | "missing_historical_marker"
  | "conflict_not_flagged"
  | "example_not_marked"
  | "unexpected_citation";

export type ContractResult = { ok: true; output: ContractOutput; cited: string[] } | { ok: false; reason: ContractReason };

/** Contract ids, referenced by the profiles. */
export const CONTRACTS = {
  copilotAnswer: "copilot.answer.v1",
  learnExplain: "learn.explain.v1",
  practiceTurn: "practice.roleplay_turn.v1",
  practiceFeedback: "practice.feedback.v1",
  adviseSuggest: "advise.suggest.v1",
  assessmentEvaluate: "assessment.evaluate.v1",
} as const;
export type ContractId = (typeof CONTRACTS)[keyof typeof CONTRACTS];

const MAX_TEXT = 4000;

class Breach extends Error {
  readonly reason: ContractReason;
  constructor(reason: ContractReason) {
    super(reason);
    this.reason = reason;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function text(value: unknown): string {
  if (typeof value !== "string") throw new Breach("malformed");
  if (value.length > MAX_TEXT) throw new Breach("too_long");
  return value;
}

function array(value: unknown, max = 20): unknown[] {
  if (!Array.isArray(value)) throw new Breach("malformed");
  if (value.length > max) throw new Breach("too_long");
  return value;
}

interface EvidenceIndex {
  ids: Set<string>;
  historical: Set<string>;
  conflict: Set<string>;
}

function indexEvidence(parts: readonly SentPart[]): EvidenceIndex {
  const index: EvidenceIndex = { ids: new Set(), historical: new Set(), conflict: new Set() };
  for (const part of parts) {
    if (!part.evidence) continue;
    index.ids.add(part.evidence.evidenceId);
    if (part.evidence.temporalStatus === "historical") index.historical.add(part.evidence.evidenceId);
    if (part.evidence.inConflict) index.conflict.add(part.evidence.evidenceId);
  }
  return index;
}

/** Parses a paragraph; returns the evidence ids it cites (each must have been sent). */
function paragraph(value: unknown, evidence: EvidenceIndex, cited: string[]): Paragraph {
  const segments = array(value, 60).map((segment): Segment => {
    if (!isObject(segment)) throw new Breach("malformed");
    if ("cite" in segment) {
      const id = text(segment.cite);
      if (!evidence.ids.has(id)) throw new Breach("unknown_citation");
      cited.push(id);
      return { cite: id };
    }
    return { text: text(segment.text) };
  });
  return segments;
}

function requireCitation(paragraph: Paragraph): void {
  if (!paragraph.some((segment) => "cite" in segment)) throw new Breach("uncited_paragraph");
}

function validateCopilot(raw: unknown, evidence: EvidenceIndex, cited: string[]): CopilotOutput {
  if (!isObject(raw) || !["answer", "conflict", "insufficient"].includes(raw.kind as string) || typeof raw.historical !== "boolean") {
    throw new Breach("malformed");
  }
  const kind = raw.kind as CopilotOutput["kind"];
  const paragraphs = array(raw.paragraphs).map((entry) => paragraph(entry, evidence, cited));
  if (kind === "insufficient") return { kind, historical: raw.historical, paragraphs: [] };
  if (paragraphs.length === 0) throw new Breach("malformed");
  paragraphs.forEach(requireCitation);
  if (cited.some((id) => evidence.historical.has(id)) && !raw.historical) throw new Breach("missing_historical_marker");
  if (cited.some((id) => evidence.conflict.has(id)) && kind !== "conflict") throw new Breach("conflict_not_flagged");
  return { kind, historical: raw.historical, paragraphs };
}

function validate(contract: ContractId, raw: unknown, evidence: EvidenceIndex, cited: string[]): ContractOutput {
  switch (contract) {
    case CONTRACTS.copilotAnswer:
      return validateCopilot(raw, evidence, cited);
    case CONTRACTS.learnExplain: {
      if (!isObject(raw)) throw new Breach("malformed");
      const paragraphs = array(raw.paragraphs).map((entry) => paragraph(entry, evidence, cited));
      if (paragraphs.length === 0) throw new Breach("malformed");
      paragraphs.forEach(requireCitation);
      const examples = array(raw.examples ?? [], 5).map((example) => {
        if (!isObject(example)) throw new Breach("malformed");
        if (example.fictional !== true) throw new Breach("example_not_marked");
        return { text: text(example.text), fictional: true as const };
      });
      return { paragraphs, examples };
    }
    case CONTRACTS.practiceTurn: {
      if (!isObject(raw)) throw new Breach("malformed");
      // A roleplay line carries no citations. That it contains no product facts cannot be
      // validated by a machine (docs/08 §4.3) — a residual risk.
      if ("cite" in raw || JSON.stringify(raw).includes('"cite"')) throw new Breach("unexpected_citation");
      return { reply: text(raw.reply) };
    }
    case CONTRACTS.practiceFeedback: {
      if (!isObject(raw)) throw new Breach("malformed");
      const points = array(raw.points).map((entry) => paragraph(entry, evidence, cited));
      if (points.length === 0) throw new Breach("malformed");
      return { points };
    }
    case CONTRACTS.adviseSuggest: {
      if (!isObject(raw)) throw new Breach("malformed");
      const suggestions = array(raw.suggestions).map((entry) => {
        if (!isObject(entry) || entry.status !== "ai_suggestion") throw new Breach("malformed");
        const segments = paragraph(entry.segments, evidence, cited);
        requireCitation(segments);
        return { status: "ai_suggestion" as const, segments };
      });
      if (suggestions.length === 0) throw new Breach("malformed");
      return { suggestions };
    }
    case CONTRACTS.assessmentEvaluate: {
      if (!isObject(raw)) throw new Breach("malformed");
      const criteria = array(raw.criteria).map((entry) => {
        if (!isObject(entry) || !["met", "partial", "not_met"].includes(entry.verdict as string)) throw new Breach("malformed");
        const cites = array(entry.cites, 10).map((id) => {
          const value = text(id);
          if (!evidence.ids.has(value)) throw new Breach("unknown_citation");
          cited.push(value);
          return value;
        });
        if (cites.length === 0) throw new Breach("uncited_paragraph");
        return { criterion: text(entry.criterion), verdict: entry.verdict as "met" | "partial" | "not_met", cites };
      });
      return { criteria };
    }
  }
}

export function validateOutput(contract: ContractId, raw: unknown, sent: readonly SentPart[]): ContractResult {
  const cited: string[] = [];
  try {
    const output = validate(contract, raw, indexEvidence(sent), cited);
    return { ok: true, output, cited: [...new Set(cited)] };
  } catch (error) {
    if (error instanceof Breach) return { ok: false, reason: error.reason };
    return { ok: false, reason: "malformed" };
  }
}
