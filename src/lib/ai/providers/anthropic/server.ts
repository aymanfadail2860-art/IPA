import "server-only";

import type { Model } from "../../core/model";

import { ANTHROPIC_TIMEOUT_MS, readAnthropicConfig } from "./config";
import { createAnthropicModel } from "./model";
import { createAnthropicTransport } from "./transport";

/**
 * The configured Claude model for the application (beta L4, B-039). Server-only: the API key is
 * read here from the server environment and handed only to the transport — it never reaches a
 * client bundle, a table or a log. Throws (AnthropicConfigError) when the configuration is
 * incomplete; the registry then fails closed — never a fallback to the stub or another model.
 */
export function configuredAnthropicModel(modelId: string): Model {
  const config = readAnthropicConfig(modelId, process.env);
  const transport = createAnthropicTransport({ modelId: config.modelId, apiKey: config.apiKey, timeoutMs: ANTHROPIC_TIMEOUT_MS });
  return createAnthropicModel({ config, transport });
}
