/**
 * The provider's failures, normalized by the transport (beta L4, docs/beta.md §16.3). The adapter
 * decides from these alone — never from a provider's message, which is not logged or shown.
 *
 *   definitive  the provider answered with an HTTP error: it did not process the call (no answer,
 *               no tokens) — the reservation may be released.
 *   uncertain   no answer (network error, timeout, abort): the provider MAY have processed and
 *               billed the call — the reservation is kept in full and the call is not repeated.
 *   retryable   429 and 5xx/529 may be retried, within the reservation's attempts and only after
 *               the provider's retry-after.
 */

export type ProviderFailure =
  | "auth"
  | "permission"
  | "billing"
  | "rejected"
  | "rate_limited"
  | "overloaded"
  | "server_error"
  | "timeout"
  | "network"
  | "aborted"
  | "unknown";

const DEFINITIVE: readonly ProviderFailure[] = ["auth", "permission", "billing", "rejected", "rate_limited", "overloaded", "server_error"];
const RETRYABLE: readonly ProviderFailure[] = ["rate_limited", "overloaded", "server_error"];

export class ProviderError extends Error {
  readonly failure: ProviderFailure;
  readonly status: number | null;
  /** The provider's retry-after, when it gave one. */
  readonly retryAfterMs: number | null;
  constructor(failure: ProviderFailure, status: number | null = null, retryAfterMs: number | null = null) {
    super(`provider_${failure}`);
    this.name = "ProviderError";
    this.failure = failure;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }

  get definitive(): boolean {
    return DEFINITIVE.includes(this.failure);
  }

  get retryable(): boolean {
    return RETRYABLE.includes(this.failure);
  }

  get code(): string {
    return `provider_${this.failure}`;
  }
}

/** The failure for an HTTP status (401, 403, 402, 429, 529, 5xx, other 4xx). */
export function failureForStatus(status: number): ProviderFailure {
  if (status === 401) return "auth";
  if (status === 403) return "permission";
  if (status === 402) return "billing";
  if (status === 429) return "rate_limited";
  if (status === 529) return "overloaded";
  if (status >= 500) return "server_error";
  return "rejected";
}

/** retry-after in seconds (or an HTTP date) → milliseconds; null when absent or unreadable. */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}
