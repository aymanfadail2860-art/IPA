import type { AuthorizedEgress } from "../../../egress/policy.ts";
import { ProviderError, type ProviderErrorKind } from "../../core/provider.ts";

/**
 * The transport to AWS Bedrock InvokeModel, as an interface (8B-I2).
 *
 * The adapters (cohere-embed-v4.ts, cohere-rerank-3-5.ts) only know this interface, so tests run
 * them against a fake transport without the AWS SDK and without any network. The real
 * transport (sdk-transport.ts) wraps @aws-sdk/client-bedrock-runtime.
 *
 * External-AI data boundary (8B-I2.5): every invocation carries the AuthorizedEgress the
 * adapter obtained from the central policy. A transport MUST call assertTransmittable before
 * any network I/O — it refuses a body without a genuine authorization, or with any text that
 * was not authorized. A guardrail test keeps every network-capable module behind that check.
 */

export const BEDROCK_PROVIDER = "aws-bedrock";

export interface BedrockInvocation {
  /** A model id or an inference profile id. */
  modelId: string;
  /** The policy's authorization of exactly the texts in `body`. */
  egress: AuthorizedEgress;
  /** The JSON request body. Exactly this object is what leaves the platform. */
  body: Record<string, unknown>;
  signal: AbortSignal;
}

export interface BedrockTransport {
  /** The AWS region the client calls (the source region for an inference profile). */
  readonly region: string;
  /** Returns the parsed JSON response body, or throws a classified ProviderError. */
  invoke(call: BedrockInvocation): Promise<unknown>;
}

const BY_NAME: Record<string, ProviderErrorKind> = {
  ThrottlingException: "throttled",
  ServiceQuotaExceededException: "throttled",
  TooManyRequestsException: "throttled",
  ServiceUnavailableException: "unavailable",
  InternalServerException: "unavailable",
  ModelNotReadyException: "unavailable",
  ModelTimeoutException: "timeout",
  TimeoutError: "timeout",
  AbortError: "timeout",
  RequestTimeout: "timeout",
  ValidationException: "invalid_request",
  AccessDeniedException: "access_denied",
  ResourceNotFoundException: "model_not_found",
  ModelErrorException: "invalid_response",
  CredentialsProviderError: "credentials",
  ExpiredTokenException: "credentials",
  UnrecognizedClientException: "credentials",
  InvalidSignatureException: "credentials",
};

const NETWORK_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EPIPE", "ETIMEDOUT", "ENETUNREACH", "UND_ERR_SOCKET"]);

/**
 * Classifies an error from the AWS SDK (or the network below it) by its name, code and HTTP
 * status. Anything unrecognized is "unavailable" only for a 5xx status; otherwise it is an
 * invalid response — never silently a success, and never retried blindly.
 */
export function classifyBedrockError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  const record = (typeof error === "object" && error !== null ? error : {}) as { name?: string; code?: string; message?: string; $metadata?: { httpStatusCode?: number } };
  const name = record.name ?? "";
  const status = record.$metadata?.httpStatusCode;
  let kind: ProviderErrorKind | undefined = BY_NAME[name];
  if (!kind && record.code && NETWORK_CODES.has(record.code)) kind = record.code === "ETIMEDOUT" ? "timeout" : "unavailable";
  if (!kind && status === 429) kind = "throttled";
  if (!kind && status !== undefined && status >= 500) kind = "unavailable";
  if (!kind && (status === 401 || status === 403)) kind = "access_denied";
  kind ??= "invalid_response";
  // The provider's message may echo input; only the error's name and status are kept.
  return new ProviderError(kind, BEDROCK_PROVIDER, `Bedrock-kaldet fejlede (${name || "ukendt fejl"}${status ? `, HTTP ${status}` : ""}).`);
}

/**
 * Long-lived static keys are never used in production (docs/08b §6.1.1, D-11): credentials come
 * from federation (OIDC or the task role) and are temporary, so they always carry a session
 * token. In local/test the default chain is allowed as is.
 */
export function assertNoStaticKeys(env: Record<string, string | undefined>, runtime: "local" | "test" | "production"): void {
  if (runtime === "production" && env.AWS_ACCESS_KEY_ID && !env.AWS_SESSION_TOKEN) {
    throw new ProviderError("credentials", BEDROCK_PROVIDER, "Statiske AWS-nøgler må ikke bruges i produktion. Brug federerede, midlertidige credentials (OIDC eller task-rolle).");
  }
}
