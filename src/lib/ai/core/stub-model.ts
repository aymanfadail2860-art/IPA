import type { Model } from "./model";
import { CONTRACTS, type Paragraph } from "./contracts";
import type { ModelInput, ModelOutput, SentPart } from "./types";

/**
 * ⚠ STUB MODEL — DEVELOPMENT ONLY (docs/08 §3.2). Grade "development". No AI.
 *
 * Same pattern as the test embedder (docs/07 §7): it can only be constructed by the registry
 * when IPA_RUNTIME_ENV is explicitly local or test, and its grade is frozen. It builds an answer
 * that satisfies the profile's output contract from the parts it RECEIVES and nothing else — it
 * adds no knowledge of its own. That makes it a sensor: tests can see exactly what would have
 * reached a real model (`received`).
 *
 * Behaviours other than "valid" break the contract or fail on purpose. They cannot be chosen by
 * configuration or environment variables — only by tests, and by the development tool
 * "Fremtving 'kan ikke dokumenteres'" (local/test only, like B-009).
 */

export const STUB_MODEL = { id: "stub", version: "1" } as const;

export type StubBehaviour = "valid" | "uncited" | "unknown_citation" | "missing_historical" | "unflagged_conflict" | "error";

export interface StubModel extends Model<"development"> {
  /** Every input the stub received, in order — what would have left the platform. */
  readonly received: readonly ModelInput[];
}

const MAX_QUOTE = 240;

function quote(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > MAX_QUOTE ? `${clean.slice(0, MAX_QUOTE - 1).trimEnd()}…` : clean;
}

function evidenceParts(input: ModelInput): (SentPart & { evidence: NonNullable<SentPart["evidence"]> })[] {
  return input.parts.filter((part): part is SentPart & { evidence: NonNullable<SentPart["evidence"]> } => Boolean(part.evidence));
}

function citedParagraphs(input: ModelInput, max = 3): Paragraph[] {
  return evidenceParts(input)
    .slice(0, max)
    .map((part) => [{ text: `${part.evidence.label}: »${quote(part.text)}« ` }, { cite: part.evidence.evidenceId }]);
}

function validOutput(input: ModelInput): unknown {
  const parts = evidenceParts(input);
  const conflict = parts.slice(0, 3).some((part) => part.evidence.inConflict);
  const historical = parts.slice(0, 3).some((part) => part.evidence.temporalStatus === "historical");
  switch (input.outputContract) {
    case CONTRACTS.copilotAnswer: {
      const paragraphs = citedParagraphs(input);
      if (conflict) {
        const ids = parts.slice(0, 3).map((part) => ({ cite: part.evidence.evidenceId }));
        paragraphs.unshift([{ text: "Kilderne er uenige, og der gives derfor ikke ét svar. " }, ...ids]);
      }
      return { kind: conflict ? "conflict" : "answer", historical, paragraphs };
    }
    case CONTRACTS.learnExplain:
      return { paragraphs: citedParagraphs(input), examples: [{ text: "Fiktivt eksempel fra stub-modellen.", fictional: true }] };
    case CONTRACTS.practiceTurn:
      return { reply: "Stub-kunde: Det lyder interessant. Hvad betyder det for min virksomhed?" };
    case CONTRACTS.practiceFeedback:
      return { points: citedParagraphs(input) };
    case CONTRACTS.adviseSuggest:
      return { suggestions: citedParagraphs(input).map((segments) => ({ status: "ai_suggestion", segments })) };
    case CONTRACTS.assessmentEvaluate:
      return { criteria: parts.slice(0, 3).map((part) => ({ criterion: part.evidence.label, verdict: "met", cites: [part.evidence.evidenceId] })) };
    default:
      return {};
  }
}

function breach(input: ModelInput, behaviour: Exclude<StubBehaviour, "valid" | "error">): unknown {
  const output = validOutput(input) as { kind?: string; historical?: boolean; paragraphs?: Paragraph[] };
  const paragraphs = output.paragraphs ?? [];
  switch (behaviour) {
    case "uncited":
      return { ...output, paragraphs: [...paragraphs, [{ text: "En påstand uden kilde." }]] };
    case "unknown_citation":
      return { ...output, paragraphs: [[{ text: "Henviser til en kilde, der ikke blev sendt. " }, { cite: "e999" }]] };
    case "missing_historical":
      return { ...output, historical: false };
    case "unflagged_conflict":
      return { ...output, kind: "answer" };
  }
}

export function createStubModel(behaviour: StubBehaviour = "valid"): StubModel {
  const received: ModelInput[] = [];
  return Object.freeze({
    id: STUB_MODEL.id,
    version: STUB_MODEL.version,
    grade: "development" as const,
    received,
    async generate(input: ModelInput): Promise<ModelOutput> {
      received.push(structuredClone(input));
      if (behaviour === "error") throw new Error("Stub-modellen fejlede med vilje.");
      return { raw: behaviour === "valid" ? validOutput(input) : breach(input, behaviour) };
    },
  });
}
