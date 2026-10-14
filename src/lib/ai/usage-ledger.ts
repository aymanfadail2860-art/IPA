import type { SupabaseClient } from "@supabase/supabase-js";

import { UsageLimitError, usageLimitCode, type Closing, type ProviderUsage, type Reservation, type UsageLedger, type UsageLimits } from "./core/usage";

/**
 * The usage ledger for ONE user's client (beta L4, docs/beta.md §16.8): the database functions
 * of supabase/migrations/20261014000100_ai_usage_limits.sql, called as the signed-in user. Not
 * server-only, so integration tests can run it against the real database.
 *
 * Every failure is thrown — a ledger that cannot be reached never lets a call through.
 */

interface LimitsRow {
  max_input_tokens: number;
  max_output_tokens: number;
  user_calls_per_minute: number;
  user_calls_per_day: number;
  global_calls_per_minute: number;
  user_active_calls: number;
  global_active_calls: number;
  global_daily_budget_usd: number | string;
  global_monthly_budget_usd: number | string;
  user_daily_budget_usd: number | string;
  reservation_ttl_seconds: number;
  max_attempts: number;
}

class LedgerError extends Error {
  constructor(operation: string, code: string | undefined) {
    super(`usage_ledger_${operation}: ${code ?? "error"}`);
    this.name = "LedgerError";
  }
}

function fail(operation: string, error: { code?: string; message?: string }): never {
  const code = usageLimitCode(error.message);
  if (code) throw new UsageLimitError(code);
  throw new LedgerError(operation, error.code);
}

export function createUsageLedger(client: SupabaseClient): UsageLedger {
  const ai = client.schema("ai");
  const closing = (reservation: Reservation, value: Closing) => ({
    p_reservation: reservation.id,
    p_token: reservation.token,
    p_counted_input_tokens: value.countedInputTokens,
    p_outcome_code: value.outcome,
  });
  return {
    async limits(): Promise<UsageLimits> {
      const { data, error } = await ai.from("usage_limits").select("*").maybeSingle<LimitsRow>();
      if (error || !data) throw new LedgerError("limits", error?.code ?? "missing");
      return {
        maxInputTokens: data.max_input_tokens,
        maxOutputTokens: data.max_output_tokens,
        userCallsPerMinute: data.user_calls_per_minute,
        userCallsPerDay: data.user_calls_per_day,
        globalCallsPerMinute: data.global_calls_per_minute,
        userActiveCalls: data.user_active_calls,
        globalActiveCalls: data.global_active_calls,
        globalDailyBudgetUsd: Number(data.global_daily_budget_usd),
        globalMonthlyBudgetUsd: Number(data.global_monthly_budget_usd),
        userDailyBudgetUsd: Number(data.user_daily_budget_usd),
        reservationTtlSeconds: data.reservation_ttl_seconds,
        maxAttempts: data.max_attempts,
      };
    },
    async reserve(request) {
      const { data, error } = await ai.rpc("reserve_usage", {
        p_request_id: request.requestId,
        p_model_id: request.modelId,
        p_profile_id: request.profileId,
        p_action: request.action,
        p_max_output_tokens: request.maxOutputTokens,
        p_cache_writes: request.cacheWrites,
      });
      if (error) fail("reserve", error);
      const row = ((data ?? []) as { reservation_id: string; reservation_token: string; max_input_tokens: number; max_output_tokens: number; reserved_cost_usd: number | string; expires_at: string }[])[0];
      if (!row) throw new LedgerError("reserve", "empty");
      return {
        id: row.reservation_id,
        token: row.reservation_token,
        maxInputTokens: row.max_input_tokens,
        maxOutputTokens: row.max_output_tokens,
        reservedCostUsd: Number(row.reserved_cost_usd),
        expiresAt: row.expires_at,
      };
    },
    async beginAttempt(reservation) {
      const { data, error } = await ai.rpc("begin_attempt", { p_reservation: reservation.id, p_token: reservation.token });
      if (error) fail("attempt", error);
      return Number(data);
    },
    async settle(reservation, usage: ProviderUsage, value) {
      const { data, error } = await ai.rpc("settle_usage", {
        p_reservation: reservation.id,
        p_token: reservation.token,
        p_counted_input_tokens: value.countedInputTokens,
        p_input_tokens: usage.inputTokens,
        p_output_tokens: usage.outputTokens,
        p_cache_creation_input_tokens: usage.cacheCreationInputTokens,
        p_cache_read_input_tokens: usage.cacheReadInputTokens,
        p_outcome_code: value.outcome,
      });
      if (error) fail("settle", error);
      return Number(data);
    },
    async release(reservation, value) {
      const { error } = await ai.rpc("release_usage", closing(reservation, value));
      if (error) fail("release", error);
    },
    async markUncertain(reservation, value) {
      const { error } = await ai.rpc("mark_usage_uncertain", closing(reservation, value));
      if (error) fail("uncertain", error);
    },
  };
}
