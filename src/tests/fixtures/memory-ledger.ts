import { UsageLimitError, type Closing, type ProviderUsage, type Reservation, type UsageLedger, type UsageLimitCode, type UsageLimits } from "@/lib/ai/core/usage";

/**
 * An in-memory usage ledger for unit tests (beta L4). It follows the database's rules
 * (ai.reserve_usage and friends) closely enough to test the adapter's use of them; the rules
 * themselves are proven against the real database (pgTAP and integration tests).
 */

export const APPROVED_LIMITS: UsageLimits = Object.freeze({
  maxInputTokens: 100_000,
  maxOutputTokens: 3_000,
  userCallsPerMinute: 3,
  userCallsPerDay: 20,
  globalCallsPerMinute: 10,
  userActiveCalls: 1,
  globalActiveCalls: 3,
  globalDailyBudgetUsd: 10,
  globalMonthlyBudgetUsd: 30,
  userDailyBudgetUsd: 2,
  reservationTtlSeconds: 300,
  maxAttempts: 3,
});

/** Test prices (USD per million tokens) — fictional, like the fake model. */
export const TEST_PRICE = { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.4 };

export interface MemoryReservation extends Reservation {
  status: "pending" | "settled" | "released" | "uncertain";
  attempts: number;
  actualCostUsd: number | null;
  countedInputTokens: number | null;
  outcome: string | null;
  requestId: string;
}

export function memoryLedger(options: { limits?: Partial<UsageLimits>; approved?: boolean; unreachable?: boolean; reserveFails?: boolean; refuse?: UsageLimitCode } = {}) {
  const limits: UsageLimits = { ...APPROVED_LIMITS, ...options.limits };
  const reservations: MemoryReservation[] = [];
  const events: string[] = [];
  const find = (reservation: Reservation) => {
    const found = reservations.find((entry) => entry.id === reservation.id && entry.token === reservation.token);
    if (!found) throw new UsageLimitError("reservation_unknown");
    if (found.status !== "pending") throw new UsageLimitError("reservation_closed");
    return found;
  };
  const spent = () => reservations.reduce((sum, r) => sum + (r.status === "settled" ? r.actualCostUsd! : r.status === "released" ? 0 : r.reservedCostUsd), 0);
  const close = (reservation: Reservation, status: MemoryReservation["status"], closing: Closing) => {
    const found = find(reservation);
    found.status = status;
    found.countedInputTokens = closing.countedInputTokens;
    found.outcome = closing.outcome;
    events.push(`${status}:${closing.outcome}`);
  };

  const ledger: UsageLedger = {
    async limits() {
      if (options.unreachable) throw new Error("ledger unreachable");
      return limits;
    },
    async reserve(request) {
      if (options.unreachable) throw new Error("ledger unreachable");
      events.push("reserve");
      if (options.reserveFails) throw new Error("ledger failed during the reservation");
      if (options.refuse) throw new UsageLimitError(options.refuse);
      if (options.approved === false) throw new UsageLimitError("model_not_approved");
      if (request.maxOutputTokens > limits.maxOutputTokens) throw new UsageLimitError("output_budget");
      if (reservations.length >= limits.userCallsPerMinute) throw new UsageLimitError("rate_user_minute");
      if (reservations.filter((r) => r.status === "pending").length >= limits.userActiveCalls) throw new UsageLimitError("active_user");
      const input = request.cacheWrites ? Math.max(TEST_PRICE.input, TEST_PRICE.cacheWrite) : TEST_PRICE.input;
      const cost = (limits.maxInputTokens * input + request.maxOutputTokens * TEST_PRICE.output) / 1_000_000;
      if (spent() + cost > limits.userDailyBudgetUsd) throw new UsageLimitError("budget_user_day");
      if (reservations.some((r) => r.requestId === request.requestId)) throw new UsageLimitError("duplicate_request");
      const reservation: MemoryReservation = {
        id: `00000000-0000-4000-8000-${String(reservations.length + 1).padStart(12, "0")}`,
        token: `token-${reservations.length + 1}`,
        maxInputTokens: limits.maxInputTokens,
        maxOutputTokens: request.maxOutputTokens,
        reservedCostUsd: cost,
        expiresAt: new Date(Date.now() + limits.reservationTtlSeconds * 1000).toISOString(),
        status: "pending",
        attempts: 0,
        actualCostUsd: null,
        countedInputTokens: null,
        outcome: null,
        requestId: request.requestId,
      };
      reservations.push(reservation);
      return { id: reservation.id, token: reservation.token, maxInputTokens: reservation.maxInputTokens, maxOutputTokens: reservation.maxOutputTokens, reservedCostUsd: cost, expiresAt: reservation.expiresAt };
    },
    async beginAttempt(reservation) {
      const found = find(reservation);
      if (found.attempts >= limits.maxAttempts) throw new UsageLimitError("attempts_exhausted");
      found.attempts += 1;
      events.push(`attempt:${found.attempts}`);
      return found.attempts;
    },
    async settle(reservation, usage: ProviderUsage, closing) {
      const found = find(reservation);
      const cost =
        (usage.inputTokens * TEST_PRICE.input + usage.cacheCreationInputTokens * TEST_PRICE.cacheWrite + usage.cacheReadInputTokens * TEST_PRICE.cacheRead + usage.outputTokens * TEST_PRICE.output) /
        1_000_000;
      close(reservation, "settled", closing);
      found.actualCostUsd = cost;
      return cost;
    },
    async release(reservation, closing) {
      close(reservation, "released", closing);
    },
    async markUncertain(reservation, closing) {
      close(reservation, "uncertain", closing);
    },
  };
  return { ledger, reservations, events, spent };
}
