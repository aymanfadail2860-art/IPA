import type { ControlReference } from "./control-set.ts";

/**
 * The approved production references of the embedding control set (docs/08b §2.5; 8B-I8 C6).
 *
 * VALIDATION PENDING: there is none yet, and the beta has no embedding model (B-035; the Bedrock
 * provider of 8B was removed in L2, docs/beta.md §14). A reference is captured with the real
 * provider in the evaluation environment, calibrated (tolerances from repeated captures) and
 * approved by a person with a decision in docs/decisions.md — then added here as a reviewed code
 * change. A reference that is a fake, a
 * development capture, unapproved or uncalibrated is refused (productionReferenceProblems; a
 * guardrail test validates every entry).
 *
 * Without a reference the worker logs embedding_control_unverified and the evaluation reports
 * the control set as unverified. Nothing is accepted automatically.
 */
export const CONTROL_REFERENCES: readonly ControlReference[] = Object.freeze([]);
