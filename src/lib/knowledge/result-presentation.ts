import type { EvidenceSet } from "./core/evidence";

/**
 * How retrieval results are shown (docs/04 §16, docs/07 §20.2). Pure — usable in client
 * components. "Der findes ikke tilstrækkelig dokumentation" is a competent answer;
 * "Retrieval er utilgængelig" is a system failure. They can never be confused: a failed or
 * unavailable retrieval is never an empty result, and only a successful retrieval without
 * items can be shown as insufficient.
 */

/** The outcome of a retrieval call as the UI receives it. Failures are never an empty result. */
export type RetrievalOutcome =
  | { kind: "evidence"; set: EvidenceSet }
  | { kind: "unavailable"; message: string }
  | { kind: "invalid_request"; message: string }
  | { kind: "denied"; message: string };

/**
 * How an outcome is shown:
 *   error         → ErrorState ("Retrieval er utilgængelig") with retry — a system failure
 *   insufficient  → InsufficientEvidence ("Der findes ikke tilstrækkelig dokumentation")
 *   evidence      → the evidence
 *   invalid / denied → the message at the form / access denied
 * Only a SUCCESSFUL retrieval without items can be "insufficient".
 */
export type RetrievalPresentation = "evidence" | "insufficient" | "error" | "invalid" | "denied";

export function presentRetrieval(outcome: RetrievalOutcome): RetrievalPresentation {
  switch (outcome.kind) {
    case "evidence":
      return outcome.set.items.length > 0 ? "evidence" : "insufficient";
    case "unavailable":
      return "error";
    case "invalid_request":
      return "invalid";
    case "denied":
      return "denied";
  }
}

export const UNAVAILABLE_TITLE = "Retrieval er utilgængelig";
export const INSUFFICIENT_TITLE = "Der findes ikke tilstrækkelig dokumentation";
