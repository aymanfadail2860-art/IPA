import { BedrockRuntimeClient, InvokeModelCommand, type BedrockRuntimeClientConfig } from "@aws-sdk/client-bedrock-runtime";

import { assertTransmittable } from "../../../egress/policy.ts";
import { runtimeEnv } from "../../core/grade.ts";
import { ProviderError } from "../../core/provider.ts";

import { assertNoStaticKeys, BEDROCK_PROVIDER, classifyBedrockError, type BedrockInvocation, type BedrockTransport } from "./transport.ts";

/**
 * The real Bedrock transport (8B-I2), on @aws-sdk/client-bedrock-runtime (InvokeModel only).
 *
 *   * Credentials are resolved by the SDK's default provider chain — web identity/OIDC, the ECS
 *     task role or SSO — or by a provider passed in (e.g. Vercel OIDC federation, D-11). No key
 *     is ever written in code or configuration, and static long-lived keys are refused in
 *     production (assertNoStaticKeys).
 *   * The SDK's own retries are switched off (maxAttempts 1): the provider-agnostic retry
 *     policy in core/provider.ts is the only one, so attempts and timeouts are predictable.
 *   * The client is created on the first call, so constructing a transport never needs
 *     credentials or network.
 */

export interface SdkTransportOptions {
  region: string;
  credentials?: BedrockRuntimeClientConfig["credentials"];
  env?: Record<string, string | undefined>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function createSdkBedrockTransport(options: SdkTransportOptions): BedrockTransport {
  assertNoStaticKeys(options.env ?? process.env, runtimeEnv(options.env?.IPA_RUNTIME_ENV ?? process.env.IPA_RUNTIME_ENV));
  let client: BedrockRuntimeClient | null = null;
  return Object.freeze({
    region: options.region,
    async invoke(call: BedrockInvocation): Promise<unknown> {
      // The external-AI data boundary: nothing is transmitted without a genuine authorization of
      // exactly these texts (8B-I2.5). Checked before the client even exists.
      assertTransmittable(call.egress, { provider: BEDROCK_PROVIDER, modelId: call.modelId, body: call.body });
      client ??= new BedrockRuntimeClient({ region: options.region, maxAttempts: 1, ...(options.credentials ? { credentials: options.credentials } : {}) });
      let output;
      try {
        output = await client.send(
          new InvokeModelCommand({ modelId: call.modelId, contentType: "application/json", accept: "application/json", body: encoder.encode(JSON.stringify(call.body)) }),
          { abortSignal: call.signal },
        );
      } catch (error) {
        throw classifyBedrockError(error);
      }
      if (!output.contentType?.includes("json") || !output.body) {
        throw new ProviderError("invalid_response", BEDROCK_PROVIDER, "Bedrock svarede ikke med JSON.");
      }
      try {
        return JSON.parse(decoder.decode(output.body)) as unknown;
      } catch {
        throw new ProviderError("invalid_response", BEDROCK_PROVIDER, "Bedrocks svar kunne ikke læses som JSON.");
      }
    },
  });
}
