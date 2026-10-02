"use server";

import { runAiRequest } from "./gateway";
import type { AiOutcome } from "./outcome";

/**
 * Copilot's server action (docs/08 §13). Every question goes through runAiRequest with the
 * Copilot profile — the client never chooses a model, a profile's actions, the matrix or the
 * gating. Context is references only. The development tools are per call and refused outside
 * IPA_RUNTIME_ENV=local/test by the gateway itself.
 */
export async function askCopilot(
  question: string,
  context: { label?: string; caseId?: string } = {},
  dev: { forceUnverifiable?: boolean; forceInsufficient?: boolean } = {},
): Promise<AiOutcome> {
  const outcome = await runAiRequest(
    {
      profile: "copilot",
      action: "answer_question",
      input: typeof question === "string" ? question : "",
      context: { label: typeof context.label === "string" ? context.label : undefined, caseId: typeof context.caseId === "string" ? context.caseId : undefined },
    },
    { forceUnverifiable: dev.forceUnverifiable === true, forceInsufficient: dev.forceInsufficient === true },
  );
  return structuredClone(outcome);
}
