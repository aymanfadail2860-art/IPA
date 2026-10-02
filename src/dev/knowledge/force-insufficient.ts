import { runtimeEnv, type RuntimeEnv } from "@/lib/knowledge/core/grade";

/**
 * ⚠ DEVELOPMENT TOOL — NOT A SETTING (decision B-009, docs/07 §20.4).
 *
 * Forces the state "Der findes ikke tilstrækkelig dokumentation" so its user interface can be
 * seen and built while only the test embedder and the "none" reranker exist — with them the
 * state practically never occurs on its own. It does NOT change scoring: retrieval is skipped
 * and an empty, marked EvidenceSet is issued.
 *
 * It can only be used when IPA_RUNTIME_ENV is explicitly local or test. A missing or unknown
 * value counts as production, where the tool is refused (fail-closed). It is a per-request
 * choice in the Admin tool "Afprøv retrieval", never configuration.
 */
export const FORCE_INSUFFICIENT_LABEL = "Fremtving utilstrækkeligt grundlag (udviklingsværktøj)";

export function forceInsufficientAllowed(environment: RuntimeEnv = runtimeEnv()): boolean {
  return environment === "local" || environment === "test";
}
