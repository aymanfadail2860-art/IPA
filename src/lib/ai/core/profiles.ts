import { CONTRACTS, type ContractId } from "./contracts";
import { PROFILE_SYSTEM } from "./instructions";
import type { DataCategory, ProfileId } from "./types";

/**
 * Workflow profiles (docs/08 §4, docs/03 §9 and §7). Versioned in the repository and reviewed as
 * code (B-017). A profile can never perform another profile's actions.
 *
 * The system prompts live in instructions.ts, the reviewed list of every instruction text that may
 * leave the platform (docs/beta.md §16).
 *
 * ⚠ The prompts are DRAFTS and NOT VALIDATED. The evaluation set and its infrastructure come in
 * 8B; validation against a real model happens in 8C. Raise `version` when a prompt or contract changes.
 */

export interface ActionSpec {
  outputContract: ContractId;
  /** Empty evidence stops the call before the model (step 7) — "insufficient". */
  requiresEvidence: boolean;
  /** Retrieval runs for this action. */
  retrieval: boolean;
}

export interface RetrievalProfile {
  documentTypes?: string[];
  /** Whether a historical lookup (as_of) may be requested. */
  allowHistorical: boolean;
  topK: number;
}

export interface WorkflowProfile {
  id: ProfileId;
  version: string;
  /** Callable by a user. Assessment is the system's own use only (docs/08 §4.2). */
  userCallable: boolean;
  system: string;
  actions: Readonly<Record<string, ActionSpec>>;
  retrieval: RetrievalProfile;
  /** Categories the profile may send at all. Narrows the matrix, never widens it. */
  categories: readonly DataCategory[];
  /** Allowlist of context keys (docs/08 §6). Everything else is removed and counted. */
  context: readonly string[];
  limits: { maxEvidence: number; maxCharsPerPart: number; maxTotalChars: number };
}

const LIMITS = { maxEvidence: 8, maxCharsPerPart: 2000, maxTotalChars: 16000 } as const;

export const PROFILES: Readonly<Record<ProfileId, WorkflowProfile>> = Object.freeze({
  copilot: {
    id: "copilot",
    version: "1",
    userCallable: true,
    system: PROFILE_SYSTEM.copilot,
    actions: { answer_question: { outputContract: CONTRACTS.copilotAnswer, requiresEvidence: true, retrieval: true } },
    retrieval: { allowHistorical: true, topK: 8 },
    categories: ["knowledge", "user_question"],
    context: ["label", "productIds", "documentTypes", "mode", "asOf", "caseId"],
    limits: LIMITS,
  },
  learn: {
    id: "learn",
    version: "1",
    userCallable: true,
    system: PROFILE_SYSTEM.learn,
    actions: { explain: { outputContract: CONTRACTS.learnExplain, requiresEvidence: true, retrieval: true } },
    retrieval: { documentTypes: ["product_description", "guidance", "sales_material"], allowHistorical: false, topK: 8 },
    categories: ["knowledge", "user_question", "learning"],
    context: ["label", "productIds"],
    limits: LIMITS,
  },
  practice: {
    id: "practice",
    version: "1",
    userCallable: true,
    system: PROFILE_SYSTEM.practice,
    actions: {
      roleplay_turn: { outputContract: CONTRACTS.practiceTurn, requiresEvidence: false, retrieval: false },
      feedback: { outputContract: CONTRACTS.practiceFeedback, requiresEvidence: true, retrieval: true },
    },
    retrieval: { allowHistorical: false, topK: 6 },
    categories: ["knowledge", "user_question", "learning", "training_fictional"],
    context: ["label", "productIds", "roleplaySessionId"],
    limits: LIMITS,
  },
  advise: {
    id: "advise",
    version: "1",
    userCallable: true,
    system: PROFILE_SYSTEM.advise,
    actions: { suggest: { outputContract: CONTRACTS.adviseSuggest, requiresEvidence: true, retrieval: true } },
    retrieval: { documentTypes: ["terms", "acceptance_rules", "business_procedure"], allowHistorical: true, topK: 8 },
    // customer_identifiable is NOT in the list: case fields are never sent in phase 8 (docs/08 §6).
    categories: ["knowledge", "user_question"],
    // Case fields allowlist is EMPTY in phase 8; only the case reference (for access and redaction).
    context: ["caseId", "productIds", "asOf", "mode"],
    limits: LIMITS,
  },
  assessment: {
    id: "assessment",
    version: "1",
    userCallable: false,
    system: PROFILE_SYSTEM.assessment,
    actions: { evaluate: { outputContract: CONTRACTS.assessmentEvaluate, requiresEvidence: true, retrieval: true } },
    retrieval: { allowHistorical: false, topK: 8 },
    categories: ["knowledge", "learning"],
    context: ["productIds"],
    limits: LIMITS,
  },
});

export function profileFor(id: string): WorkflowProfile | null {
  return Object.hasOwn(PROFILES, id) ? PROFILES[id as ProfileId] : null;
}
