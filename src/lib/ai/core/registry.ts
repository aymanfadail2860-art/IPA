import { assertGradeAllowed, runtimeEnv, type RuntimeEnv } from "@/lib/knowledge/core/grade";

import type { Model } from "./model";
import { createStubModel, STUB_MODEL, type StubBehaviour } from "./stub-model";

/**
 * Fail-closed model registry (docs/08 §3.2, B-012). The only place the stub model is
 * constructed (guardrail test). The stub has grade "development" and is refused unless
 * IPA_RUNTIME_ENV is EXPLICITLY local or test — a missing or unknown value is production.
 *
 * No real model is configured in phase 8. A configured id without an implementation fails; it
 * never falls back to the stub.
 */

export class ModelNotConfiguredError extends Error {
  constructor(id: string) {
    super(`Der er ingen implementering af modellen "${id}". Der kaldes ingen rigtig AI-model i fase 8.`);
    this.name = "ModelNotConfiguredError";
  }
}

/** The configured model: IPA_AI_MODEL, default "stub". */
export function createModel(id: string = process.env.IPA_AI_MODEL || STUB_MODEL.id, environment: RuntimeEnv = runtimeEnv()): Model {
  if (id === STUB_MODEL.id) {
    const model = createStubModel();
    assertGradeAllowed(`Stub-modellen "${STUB_MODEL.id}"`, model.grade, environment);
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
