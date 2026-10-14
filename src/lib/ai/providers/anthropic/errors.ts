/**
 * The provider's failures, normalized by the transport (beta L4, docs/beta.md §16.3). The adapter
 * decides from these alone — never from a provider's message, which is not logged or shown.
 *
 *   not processed  the provider refused the request itself before any model ran — 400, 401, 402,
 *                  403, 404, 413 and 422 (a malformed, unauthenticated, unpaid, forbidden, unknown,
 *                  too large or invalid request). Only these release the reservation.
 *   uncertain      everything else: 429, 5xx and 529, any other HTTP status, a network error, a
 *                  timeout or an abort. The adapter cannot establish that nothing was billed, so the
 *                  reservation is kept in full and marked for reconciliation (B-039, clarified
 *                  14 October 2026).
 *
 * No failure is ever retried by the adapter: a retry is a new paid call the user did not ask for.
 */

export type ProviderFailure =
  | "auth"
  | "permission"
  | "billing"
  | "rejected"
  | "rate_limited"
  | "overloaded"
  | "server_error"
  | "http_other"
  | "timeout"
  | "network"
  | "aborted"
  | "unknown";

/** The HTTP statuses at which the provider refused the request before processing it. */
export const NOT_PROCESSED_STATUSES: readonly number[] = [400, 401, 402, 403, 404, 413, 422];

export class ProviderError extends Error {
  readonly failure: ProviderFailure;
  readonly status: number | null;
  /** The provider's retry-after, when it gave one. Reported only — the adapter never retries. */
  readonly retryAfterMs: number | null;
  constructor(failure: ProviderFailure, status: number | null = null, retryAfterMs: number | null = null) {
    super(`provider_${failure}`);
    this.name = "ProviderError";
    this.failure = failure;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }

  /** True only when the provider certainly did not process (and bill) the request. */
  get notProcessed(): boolean {
    return this.status !== null && NOT_PROCESSED_STATUSES.includes(this.status);
  }

  get code(): string {
    return `provider_${this.failure}`;
  }
}

/** The failure for an HTTP status (401, 403, 402, other listed 4xx, 429, 529, 5xx, anything else). */
export function failureForStatus(status: number): ProviderFailure {
  if (status === 401) return "auth";
  if (status === 403) return "permission";
  if (status === 402) return "billing";
  if (status === 429) return "rate_limited";
  if (status === 529) return "overloaded";
  if (status >= 500) return "server_error";
  if (NOT_PROCESSED_STATUSES.includes(status)) return "rejected";
  return "http_other";
}

/** retry-after in seconds (or an HTTP date) → milliseconds; null when absent or unreadable. */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}
