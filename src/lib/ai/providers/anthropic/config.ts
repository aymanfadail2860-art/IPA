/**
 * Configuration of the Anthropic Messages API connection (beta L4, B-039). Configuration only —
 * nothing here names an account, a key or a model:
 *
 *   IPA_AI_MODEL           the model id (registry.ts). Only ids with an approved, verified price
 *                          in the database (ai.model_prices) can be used.
 *   API_KEY_ENV_NAME       the server-side secret of the Anthropic Console organisation in use
 *                          (the project owner's in the beta, IPA's later). Never NEXT_PUBLIC_,
 *                          never in Git, the browser, a table or a log.
 *   IPA_AI_EFFORT          optional: low | medium | high (the model's effort setting).
 *
 * Switching to IPA's organisation is a change of these values in the server environment — no code
 * change. The API host is fixed here; an environment variable cannot redirect the key elsewhere.
 */

export const ANTHROPIC_API_BASE_URL = "https://api.anthropic.com";
export const API_KEY_ENV_NAME = "IPA_ANTHROPIC_API_KEY";
export const ANTHROPIC_EFFORT_ENV = "IPA_AI_EFFORT";

/** Per call at the provider. The adapter makes one attempt and never retries (model.ts). */
export const ANTHROPIC_TIMEOUT_MS = 120_000;

/**
 * Prompt caching (docs/beta.md §16.9): the adapter is cache-ready — the request builder can mark
 * the document prefix, and the ledger reserves and settles cache writes and reads — but caching is
 * NOT active in L4. Turning it on is a reviewed change, not configuration.
 */
export const PROMPT_CACHING_ACTIVE = false;

const MODEL_ID = /^claude-[a-z0-9][a-z0-9.-]{0,56}$/;
const EFFORTS = ["low", "medium", "high"] as const;
export type AnthropicEffort = (typeof EFFORTS)[number];

export interface AnthropicConfig {
  modelId: string;
  apiKey: string;
  effort: AnthropicEffort | null;
}

export class AnthropicConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnthropicConfigError";
  }
}

/** A Claude model id in the form the API uses. Whether it may be used is decided by ai.model_prices. */
export function isAnthropicModelId(id: unknown): id is string {
  return typeof id === "string" && MODEL_ID.test(id);
}

/** Reads and validates the configuration. Throws AnthropicConfigError — the registry then fails closed. */
export function readAnthropicConfig(modelId: string, env: Readonly<Record<string, string | undefined>>): AnthropicConfig {
  if (!isAnthropicModelId(modelId)) throw new AnthropicConfigError(`"${String(modelId).slice(0, 80)}" er ikke et gyldigt Claude-model-id.`);
  const apiKey = env[API_KEY_ENV_NAME]?.trim() ?? "";
  if (apiKey.length === 0) throw new AnthropicConfigError(`API-nøglen mangler: ${API_KEY_ENV_NAME} er ikke sat i servermiljøet.`);
  if (apiKey.length < 20 || /\s/.test(apiKey)) throw new AnthropicConfigError(`${API_KEY_ENV_NAME} har ikke form som en API-nøgle.`);
  const rawEffort = env[ANTHROPIC_EFFORT_ENV]?.trim() ?? "";
  if (rawEffort !== "" && !(EFFORTS as readonly string[]).includes(rawEffort)) {
    throw new AnthropicConfigError(`${ANTHROPIC_EFFORT_ENV} skal være low, medium eller high.`);
  }
  return Object.freeze({ modelId, apiKey, effort: rawEffort === "" ? null : (rawEffort as AnthropicEffort) });
}
