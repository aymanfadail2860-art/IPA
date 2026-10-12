import { providerErrorFields } from "../core/provider.ts";

import type { ProviderEntry } from "./aws-credentials.ts";
import type { BedrockInvocation, BedrockTransport } from "./bedrock/transport.ts";
import type { ProviderRuntime } from "./catalog.ts";

/**
 * Provider metrics as log lines (docs/08b §14, B-033; 8B-I8 C3). One line per call to the
 * provider — each attempt, so a 429 that a retry later absorbs still counts:
 *
 *   event "provider_call": runtime, provider, operation, model, outcome, duration_ms,
 *   provider_error_kind, throttled, timeout, retryable, http_status, error_class,
 *   correlation_id (the egress authorization), and — in the app — request_id,
 *   configuration_id and configuration_fingerprint.
 *
 * Enough for the platform to compute the provider error rate, the throttling (429) rate and
 * the timeout rate per runtime, operation and configuration (deploy/monitoring/). Never the
 * provider's message, a query, a text or a credential. Logging never changes the call.
 */

export const PROVIDER_CALL_EVENT = "provider_call";

export interface ProviderCallLabels {
  runtime: ProviderEntry;
  request_id?: string | null;
  configuration_id?: string | null;
  configuration_fingerprint?: string | null;
}

export type ProviderCallLog = (fields: Record<string, unknown> & { event: typeof PROVIDER_CALL_EVENT }) => void;

const clock = (): number => globalThis.performance?.now?.() ?? Date.now();

export function observedTransport(transport: BedrockTransport, labels: ProviderCallLabels, log: ProviderCallLog, now: () => number = clock): BedrockTransport {
  const record = (call: BedrockInvocation, started: number, error: unknown | null) => {
    try {
      const fields = error === null ? providerErrorFields(null) : providerErrorFields(error);
      // An attempt aborted by the retry policy's timeout is a timeout, whatever the SDK threw.
      const timeout = fields.timeout || (error !== null && call.signal.aborted);
      log({
        event: PROVIDER_CALL_EVENT,
        ...labels,
        provider: call.egress.provider,
        operation: call.egress.operation,
        model: call.modelId,
        correlation_id: call.egress.correlationId,
        outcome: error === null ? "ok" : "error",
        duration_ms: Math.max(0, Math.round(now() - started)),
        provider_error_kind: error === null ? null : timeout && fields.provider_error_kind === null ? "timeout" : fields.provider_error_kind,
        throttled: fields.throttled,
        timeout,
        retryable: error === null ? null : fields.retryable,
        http_status: fields.http_status,
        error_class: error === null ? null : fields.error_class,
      });
    } catch {
      // Metrics never fail a provider call.
    }
  };
  return Object.freeze({
    region: transport.region,
    async invoke(call: BedrockInvocation): Promise<unknown> {
      const started = now();
      try {
        const result = await transport.invoke(call);
        record(call, started, null);
        return result;
      } catch (error) {
        record(call, started, error);
        throw error;
      }
    },
  });
}

/** The same runtime with every Bedrock call measured. */
export function observedRuntime(runtime: ProviderRuntime, labels: ProviderCallLabels, log: ProviderCallLog, now?: () => number): ProviderRuntime {
  return { ...runtime, bedrock: observedTransport(runtime.bedrock, labels, log, now) };
}
