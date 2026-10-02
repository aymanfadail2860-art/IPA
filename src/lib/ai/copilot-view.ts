import type { EvidenceItem } from "@/lib/knowledge/core/evidence";
import { evidenceToSource } from "@/lib/knowledge/evidence-source";
import type { AnswerParagraph, CopilotExchange, SourceReference } from "@/types/domain";

import type { CopilotOutput } from "./core/contracts";
import { LOCKED_MESSAGES, type AiOutcome } from "./outcome";

/**
 * How one Copilot question is shown (docs/04 §8, docs/08 §13). Pure — used by client
 * components. The live path maps the gateway's AiOutcome; the demo builds the same shape from
 * mock data, so both look identical and only the marking differs.
 */
export type CopilotResult =
  | { kind: "exchange"; exchange: CopilotExchange; development: boolean; forced?: boolean }
  | { kind: "unverifiable"; question: string; sources: SourceReference[] }
  | { kind: "locked"; question: string; message: string }
  | { kind: "error"; question: string; message: string }
  | { kind: "notice"; question: string; message: string };

let sequence = 0;
const nextId = () => `live-${(sequence += 1)}`;

function retrievalSummary(evidence: readonly EvidenceItem[]) {
  return { passages: evidence.length, documents: new Set(evidence.map((item) => item.documentId)).size };
}

export function copilotResultFromOutcome(question: string, outcome: AiOutcome, asOf?: string): CopilotResult {
  switch (outcome.kind) {
    case "answer": {
      const output = outcome.output as CopilotOutput;
      // The answer shows the sources it rests on — the cited ones, in citation order.
      const cited = outcome.cited.flatMap((id) => outcome.evidence.filter((item) => item.evidenceId === id));
      const sources = cited.map((item) => evidenceToSource(item, cited));
      const number = new Map(cited.map((item, index) => [item.evidenceId, index + 1]));
      const paragraphs: AnswerParagraph[] = output.paragraphs.map((paragraph) =>
        paragraph.map((segment) => ("cite" in segment ? { source: number.get(segment.cite) ?? 0 } : segment.text)),
      );
      const kind = output.kind === "conflict" ? "conflict" : output.historical ? "historical" : "complete";
      return {
        kind: "exchange",
        development: outcome.grade === "development",
        exchange: {
          id: nextId(),
          question,
          kind,
          paragraphs,
          sources,
          followUps: [],
          historicalAsOf: kind === "historical" ? asOf : undefined,
          retrieval: retrievalSummary(outcome.evidence),
        },
      };
    }
    case "insufficient":
      return {
        kind: "exchange",
        development: outcome.grade === "development",
        forced: outcome.forced,
        exchange: {
          id: nextId(),
          question,
          kind: "insufficient",
          paragraphs: [
            [
              outcome.forced
                ? "Fremtvunget af udviklingsværktøjet, så tilstanden kan ses. Der er ikke søgt."
                : "Der blev ikke fundet godkendt dokumentation, du har adgang til, som dækker spørgsmålet. Der gives derfor ikke et fagligt svar.",
            ],
          ],
          sources: [],
          followUps: [],
          retrieval: retrievalSummary(outcome.evidence),
        },
      };
    case "unverifiable":
      return { kind: "unverifiable", question, sources: outcome.evidence.map((item) => evidenceToSource(item, outcome.evidence)) };
    case "locked":
      return { kind: "locked", question, message: LOCKED_MESSAGES[outcome.reason] };
    case "unavailable":
      return { kind: "error", question, message: outcome.message };
    case "denied":
    case "blocked_policy":
    case "invalid_request":
      return { kind: "notice", question, message: outcome.message };
  }
}
