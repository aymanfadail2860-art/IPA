import type { ClassifiedText, DataCategory } from "@/lib/egress/classification";
import type { Grade } from "@/lib/knowledge/core/grade";
import type { TemporalStatus } from "@/lib/knowledge/core/evidence";

/**
 * Shared types of the AI Gateway (docs/08). Pure — no server-only imports, so the core can be
 * unit tested and the outcome types can reach client components.
 */

export type ProfileId = "copilot" | "learn" | "practice" | "advise" | "assessment";

/** The data categories of docs/03 §9 (docs/08 §5.1) — one model, defined with the egress boundary. */
export { DATA_CATEGORIES, type DataCategory } from "@/lib/egress/classification";

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
  /** The matrix category (docs/08 §5). */
  readonly category: DataCategory;
  readonly text: string;
  /**
   * The same text with its provenance (L1, 8B-I2.5). For an external model invokeModel
   * authorizes exactly these through the egress boundary; `text` must equal `content.text`.
   */
  readonly content: ClassifiedText;
  /**
   * Evidence parts only: what the model needs to cite and mark correctly. The document ids let an
   * external adapter send each document version as one document and map citations back (L4).
   */
  readonly evidence?: {
    evidenceId: string;
    label: string;
    temporalStatus: TemporalStatus;
    inConflict: boolean;
    documentId?: string;
    documentVersionId?: string;
  };
  /**
   * Evidence parts only: the title of the part's document version — Knowledge Engine metadata,
   * classified as knowledge and authorized with the part (invoke.ts). Sent as the document's title,
   * never as an instruction.
   */
  readonly sourceTitle?: ClassifiedText;
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
  /** External models: what the call used and cost — numbers and codes, never text. */
  usage?: CallUsageReport;
  /** External models: the provider's native citations, mapped to the evidence that was sent. */
  citations?: readonly NativeCitation[];
}

/**
 * One native citation of an external model (Anthropic content_block_location), with the evidence
 * it points to. `citedText` is the provider's copy of the cited blocks (source text): it stays in
 * memory and is never logged.
 */
export interface NativeCitation {
  documentIndex: number;
  startBlockIndex: number;
  endBlockIndex: number;
  documentVersionId: string | null;
  evidenceIds: string[];
  citedText: string;
}

/** The usage and cost of one external call, for the log and the outcome (docs/beta.md §16.11). */
export interface CallUsageReport {
  provider: string;
  reservationId: string | null;
  /** "none": nothing was reserved (refused before). */
  status: "none" | "pending" | "settled" | "released" | "uncertain";
  reservedCostUsd: number | null;
  actualCostUsd: number | null;
  /** The provider's token count of the request (count_tokens), when it was made. */
  countedInputTokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
  attempts: number;
  /** The content was sent to the provider (the token count sends it too). */
  transmitted: boolean;
  /** The provider's opaque request id (support), never content. */
  providerRequestId: string | null;
  stopReason: string | null;
}

export type { Grade };
