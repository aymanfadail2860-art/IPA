import type { EvidenceItem } from "@/lib/knowledge/core/evidence";
import type { Grade } from "@/lib/knowledge/core/grade";

import type { ContractOutput, ContractReason } from "./core/contracts";
import type { DataCategory, ProfileId } from "./core/types";

/**
 * The gateway's explicit outcome (docs/08 §1) and how it is shown. Pure — usable in client
 * components.
 *
 * Four states can never look alike (docs/04 §16, B-016): an answer, "Der findes ikke
 * tilstrækkelig dokumentation", "Systemet kunne ikke give et svar, der kan dokumenteres", and a
 * system failure. The mapping lives only in presentAi().
 */

export type AiOutcome =
  | { kind: "answer"; profile: ProfileId; grade: Grade; output: ContractOutput; evidence: EvidenceItem[]; cited: string[] }
  | { kind: "insufficient"; profile: ProfileId; grade: Grade; evidence: EvidenceItem[]; forced: boolean }
  | { kind: "unverifiable"; profile: ProfileId; reason: ContractReason; evidence: EvidenceItem[] }
  | { kind: "locked"; reason: "assessment_active" | "roleplay_active" }
  | { kind: "denied"; message: string }
  | { kind: "blocked_policy"; category: DataCategory; message: string }
  | { kind: "invalid_request"; message: string }
  | { kind: "unavailable"; message: string };

export type AiPresentation = "answer" | "insufficient" | "unverifiable" | "locked" | "error" | "denied" | "blocked" | "invalid";

export function presentAi(outcome: AiOutcome): AiPresentation {
  switch (outcome.kind) {
    case "answer":
      return "answer";
    case "insufficient":
      return "insufficient";
    case "unverifiable":
      return "unverifiable";
    case "locked":
      return "locked";
    case "denied":
      return "denied";
    case "blocked_policy":
      return "blocked";
    case "invalid_request":
      return "invalid";
    case "unavailable":
      return "error";
  }
}

export const UNVERIFIABLE_TITLE = "Systemet kunne ikke give et svar, der kan dokumenteres";
export const UNVERIFIABLE_BODY =
  "Der blev fundet kilder til spørgsmålet, men svaret kunne ikke kontrolleres mod dem. Derfor vises det ikke. Du kan selv læse kilderne herunder.";
export const GATEWAY_UNAVAILABLE_TITLE = "Copilot er utilgængelig";
export const LOCKED_MESSAGES: Record<"assessment_active" | "roleplay_active", string> = {
  assessment_active: "Copilot er slået fra under prøven.",
  roleplay_active: "Copilot er slået fra under rollespillet.",
};
export const DEVELOPMENT_ANSWER_LABEL = "Udviklingssvar — ingen AI-model";
