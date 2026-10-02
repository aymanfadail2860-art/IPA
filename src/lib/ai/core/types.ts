import type { Grade } from "@/lib/knowledge/core/grade";
import type { TemporalStatus } from "@/lib/knowledge/core/evidence";

/**
 * Shared types of the AI Gateway (docs/08). Pure — no server-only imports, so the core can be
 * unit tested and the outcome types can reach client components.
 */

export type ProfileId = "copilot" | "learn" | "practice" | "advise" | "assessment";

/** The data categories of docs/03 §9 (docs/08 §5.1). */
export const DATA_CATEGORIES = ["knowledge", "user_question", "learning", "training_fictional", "customer_identifiable", "audit_access"] as const;
export type DataCategory = (typeof DATA_CATEGORIES)[number];

export type PolicyRule = "allow" | "allow_redacted" | "deny";

/** A request to the gateway. Context is REFERENCES (ids), never content the client supplies. */
export interface AiRequest {
  profile: ProfileId;
  action: string;
  /** The user's own free text (question, roleplay line). */
  input: string;
  context?: AiContext;
}

export interface AiContext {
  /** Free-text context label from the page (e.g. "Erhvervsansvar · Modul 3"). Treated as user input. */
  label?: string;
  productIds?: string[];
  documentTypes?: string[];
  mode?: "current" | "as_of";
  asOf?: string;
  caseId?: string;
  roleplaySessionId?: string;
  [key: string]: unknown;
}

/** One piece of content sent to a model. Constructed only by the gateway (parts.ts). */
export interface SentPart {
  readonly kind: "question" | "context" | "evidence";
  readonly category: DataCategory;
  readonly text: string;
  /** Evidence parts only: what the model needs to cite and mark correctly. */
  readonly evidence?: { evidenceId: string; label: string; temporalStatus: TemporalStatus; inConflict: boolean };
}

export interface ModelInput {
  profile: { id: ProfileId; version: string };
  action: string;
  system: string;
  parts: readonly SentPart[];
  outputContract: string;
}

/** The model's raw output: JSON, validated against the profile's output contract afterwards. */
export interface ModelOutput {
  raw: unknown;
}

export type { Grade };
