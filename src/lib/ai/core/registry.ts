import { assertGradeAllowed, runtimeEnv, type RuntimeEnv } from "@/lib/knowledge/core/grade";

import type { Model } from "./model";
import { createStubModel, STUB_MODEL, type StubBehaviour } from "./stub-model";

/**
 * Fail-closed model registry (docs/08 §3.2, B-012). The only place the stub model is
 * constructed (guardrail test). The stub has grade "development" and is refused unless
 * IPA_RUNTIME_ENV is EXPLICITLY local or test — a missing or unknown value is production.
 *
 * Beta L4 (B-039): a Claude model id (IPA_AI_MODEL) is constructed by the server-only factory
 * the gateway passes in (providers/anthropic/server.ts). Whether it may be USED is decided per call
 * by the database (ai.model_prices: only approved models with verified prices). A configured id
 * without an implementation, or with an incomplete configuration (e.g. no API key), fails — it
 * never falls back to the stub or to another model.
 */

export class ModelNotConfiguredError extends Error {
  constructor(id: string) {
    super(`Der er ingen implementering af modellen "${id}".`);
    this.name = "ModelNotConfiguredError";
  }
}

/** External model factories, by provider. Only the server-only gateway entry supplies them. */
export interface ExternalModelFactories {
  /** A Claude model id ("claude-…"). Throws when the configuration is incomplete. */
  anthropic?: (id: string) => Model;
}

const CLAUDE_MODEL_ID = /^claude-/;

/** The configured model: IPA_AI_MODEL, default "stub". */
export function createModel(
  id: string = process.env.IPA_AI_MODEL || STUB_MODEL.id,
  environment: RuntimeEnv = runtimeEnv(),
  external: ExternalModelFactories = {},
): Model {
  if (id === STUB_MODEL.id) {
    const model = createStubModel();
    assertGradeAllowed(`Stub-modellen "${STUB_MODEL.id}"`, model.grade, environment);
    return model;
  }
  if (CLAUDE_MODEL_ID.test(id) && external.anthropic) {
    const model = external.anthropic(id);
    if (model.grade !== "production" || model.id !== id) throw new ModelNotConfiguredError(id);
    return model;
  }
  throw new ModelNotConfiguredError(id);
}

/**
 * A stub that breaks the output contract — for the development tool "Fremtving 'kan ikke
 * dokumenteres'" only. Same fail-closed rule as the stub itself.
 */
export function createContractBreakingStub(environment: RuntimeEnv = runtimeEnv(), behaviour: Exclude<StubBehaviour, "valid" | "error"> = "uncited"): Model {
  const model = createStubModel(behaviour);
  assertGradeAllowed(`Stub-modellen "${STUB_MODEL.id}"`, model.grade, environment);
  return model;
}
