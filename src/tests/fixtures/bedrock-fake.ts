import { assertTransmittable } from "@/lib/egress/policy";
import type { BedrockInvocation, BedrockTransport } from "@/lib/knowledge/providers/bedrock/transport";

/**
 * A fake Bedrock transport for tests (8B-I2). No AWS account, no SDK, no network: each call is
 * recorded and answered by the handler. Fictional data only.
 *
 * Like the real transport it refuses anything the egress policy did not authorize (8B-I2.5), so
 * a recorded call is always one that would have been allowed to leave.
 */

export interface FakeCall {
  modelId: string;
  body: Record<string, unknown>;
  signal: AbortSignal;
}

export function fakeBedrock(handler: (call: FakeCall, index: number) => unknown | Promise<unknown>, region = "eu-central-1") {
  const calls: FakeCall[] = [];
  const transport: BedrockTransport = {
    region,
    async invoke(call: BedrockInvocation) {
      assertTransmittable(call.egress, { provider: "aws-bedrock", modelId: call.modelId, body: call.body, log: () => {} });
      const recorded = { modelId: call.modelId, body: structuredClone(call.body), signal: call.signal };
      calls.push(recorded);
      return handler(recorded, calls.length - 1);
    },
  };
  return { transport, calls };
}

/** A deterministic, non-zero vector per text (so tests can tell texts apart). */
export function fakeVector(text: string, dimensions = 1024): number[] {
  let seed = 0;
  for (const char of text) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
  return Array.from({ length: dimensions }, (_, i) => ((seed + i * 7919) % 1000) / 1000 - 0.5 || 0.001);
}

export function embedResponse(texts: readonly string[], dimensions = 1024) {
  return { id: "fake", response_type: "embeddings_by_type", embeddings: { float: texts.map((text) => fakeVector(text, dimensions)) } };
}

export const awsError = (name: string, status?: number) => Object.assign(new Error(`${name} (fake)`), { name, $metadata: { httpStatusCode: status } });

export const noSleep = { sleep: async () => {}, random: () => 0.5 };
