import { runtimeEnv, type RuntimeEnv } from "@/lib/knowledge/core/grade";

/**
 * ⚠ DEVELOPMENT TOOL — NOT A SETTING (docs/08 §13).
 *
 * Starts and ends an Assessment attempt or an AI roleplay for the signed-in user, so the server-
 * side gating (B-015) can be seen and tested before the Assessment and Practice modules exist.
 * It calls the same database functions the modules will call (B-013) — it does not bypass the
 * gating, it creates the state the gating reads. Refused unless IPA_RUNTIME_ENV is explicitly
 * local or test (fail-closed).
 */
export const GATING_TOOL_LABEL = "Udviklingsværktøj — kun lokalt og i test";
export const FORCE_UNVERIFIABLE_LABEL = "Fremtving \"kan ikke dokumenteres\"";
export const FORCE_INSUFFICIENT_AI_LABEL = "Fremtving utilstrækkeligt grundlag";

export function aiDevToolsAllowed(environment: RuntimeEnv = runtimeEnv()): boolean {
  return environment === "local" || environment === "test";
}
