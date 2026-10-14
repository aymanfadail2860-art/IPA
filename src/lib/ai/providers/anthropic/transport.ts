import Anthropic from "@anthropic-ai/sdk";
import type { MessageCountTokensParams, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";

import { assertTransmittable, EgressPolicyError, type AuthorizedEgress } from "@/lib/egress/policy";

import { runtimeEnv } from "@/lib/knowledge/core/grade";

import type { ApiMessage, ApiMessageRequest } from "./api-types";
import { ANTHROPIC_API_BASE_URL } from "./config";
import { failureForStatus, parseRetryAfter, ProviderError } from "./errors";
import { countTokensBody } from "./request";

/**
 * The ONLY module that talks to Anthropic (beta L4; allowlisted in the egress architecture test).
 *
 * Every transmission — the token count and the message — first passes assertTransmittable: the
 * request must carry a genuine authorization for this model, and every string in the body must be
 * an authorized text, a reviewed protocol constant or the model id. Otherwise nothing is sent.
 *
 *   * The key, host and retries are fixed here: the official SDK with an explicit key and host (no
 *     ANTHROPIC_* environment variable can redirect them), no auth token, no SDK retries (the
 *     model's own retry loop runs under the usage reservation), no SDK logging.
 *   * `fetch` can be injected: every test uses a fake transport. In IPA_RUNTIME_ENV=test the real
 *     network is refused outright (model.ts), so no test can make a paid call.
 */

export interface AnthropicTransport {
  /** The check alone — run before anything is reserved, so an unauthorized body costs nothing. */
  authorize(egress: AuthorizedEgress, body: ApiMessageRequest): void;
  countTokens(egress: AuthorizedEgress, body: ApiMessageRequest): Promise<number>;
  create(egress: AuthorizedEgress, body: ApiMessageRequest): Promise<{ message: ApiMessage; requestId: string | null }>;
}

/** SDK errors → ProviderError. Nothing of the provider's message is kept. */
function normalize(error: unknown): unknown {
  if (error instanceof EgressPolicyError || error instanceof ProviderError) return error;
  if (error instanceof Anthropic.APIUserAbortError) return new ProviderError("aborted");
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError("timeout");
  if (error instanceof Anthropic.APIConnectionError) return new ProviderError("network");
  if (error instanceof Anthropic.APIError && typeof error.status === "number") {
    return new ProviderError(failureForStatus(error.status), error.status, parseRetryAfter(error.headers?.get("retry-after")));
  }
  return new ProviderError("unknown");
}

export interface TransportOptions {
  modelId: string;
  apiKey: string;
  timeoutMs: number;
  /** A fake transport in tests. Production uses the platform's fetch. */
  fetch?: typeof globalThis.fetch;
}

export function createAnthropicTransport(options: TransportOptions): AnthropicTransport {
  // No test can reach the real API: without an injected fake transport, test refuses.
  if (!options.fetch && runtimeEnv() === "test") throw new Error("Rigtige Anthropic-kald er ikke tilladt i IPA_RUNTIME_ENV=test.");
  const fetchImpl = options.fetch ?? fetch;
  const client = new Anthropic({
    apiKey: options.apiKey,
    authToken: null,
    baseURL: ANTHROPIC_API_BASE_URL,
    maxRetries: 0,
    timeout: options.timeoutMs,
    fetch: fetchImpl,
    logLevel: "off",
  });

  /** The check before ANY network I/O: authorized texts, reviewed constants and this model only. */
  const authorize = (egress: AuthorizedEgress, body: ApiMessageRequest) => {
    assertTransmittable(egress, { provider: options.modelId, modelId: options.modelId, body });
    if (body.model !== options.modelId) {
      throw new EgressPolicyError({
        correlationId: egress.correlationId,
        module: "transport",
        provider: options.modelId,
        operation: egress.operation,
        reason: "unauthorized_transmission",
        category: null,
        role: null,
        partIndex: null,
      });
    }
  };

  return Object.freeze({
    authorize,
    async countTokens(egress: AuthorizedEgress, body: ApiMessageRequest) {
      authorize(egress, body);
      const params: MessageCountTokensParams = countTokensBody(body);
      try {
        const counted = await client.messages.countTokens(params);
        return counted.input_tokens;
      } catch (error) {
        throw normalize(error);
      }
    },
    async create(egress: AuthorizedEgress, body: ApiMessageRequest) {
      authorize(egress, body);
      const params: MessageCreateParamsNonStreaming = body;
      try {
        const { data, request_id } = await client.messages.create(params).withResponse();
        return { message: data as ApiMessage, requestId: request_id ?? null };
      } catch (error) {
        throw normalize(error);
      }
    },
  });
}
