import type { CallUsageReport } from "./types";

/**
 * Usage limits for external AI (beta L4, docs/beta.md §16.7–§16.8). Pure — the database
 * implementation is ../usage-ledger.ts, and the limits themselves live in the database
 * (ai.usage_limits, ai.model_prices), so they change without code changes.
 *
 * The ledger is the ONLY way an external model may spend: before anything is sent, it reserves
 * the maximum cost of the call in one database transaction; afterwards it settles the reservation
 * with the provider's actual usage, releases it when the provider definitely did not process the
 * call, or marks it uncertain (counted in full) when the provider may have.
 */

/** The limits in force (ai.usage_limits). */
export interface UsageLimits {
  maxInputTokens: number;
  maxOutputTokens: number;
  userCallsPerMinute: number;
  userCallsPerDay: number;
  globalCallsPerMinute: number;
  userActiveCalls: number;
  globalActiveCalls: number;
  globalDailyBudgetUsd: number;
  globalMonthlyBudgetUsd: number;
  userDailyBudgetUsd: number;
  reservationTtlSeconds: number;
  maxAttempts: number;
}

/** An open reservation. `token` is the secret only the gateway holds (never logged). */
export interface Reservation {
  id: string;
  token: string;
  /** The effective input ceiling: our limit, the price's validity and the context window. */
  maxInputTokens: number;
  maxOutputTokens: number;
  reservedCostUsd: number;
  expiresAt: string;
}

export interface ReserveRequest {
  requestId: string;
  modelId: string;
  profileId: string;
  action: string;
  maxOutputTokens: number;
  /** Prompt caching writes: the input is reserved at the cache-write price. */
  cacheWrites: boolean;
}

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface Closing {
  countedInputTokens: number | null;
  /** A machine code (e.g. "answer", "provider_rejected"). */
  outcome: string;
}

export interface UsageLedger {
  limits(): Promise<UsageLimits>;
  /** Throws UsageLimitError when a limit refuses the call. */
  reserve(request: ReserveRequest): Promise<Reservation>;
  /** One attempt at the provider. Throws when the reservation is closed, expired or exhausted. */
  beginAttempt(reservation: Reservation): Promise<number>;
  /** Returns the actual cost (USD). */
  settle(reservation: Reservation, usage: ProviderUsage, closing: Closing): Promise<number>;
  release(reservation: Reservation, closing: Closing): Promise<void>;
  markUncertain(reservation: Reservation, closing: Closing): Promise<void>;
}

/** The refusals of the database (ai.usage_refuse) — machine codes. */
export const USAGE_LIMIT_CODES = [
  "limits_missing",
  "model_not_approved",
  "output_budget",
  "input_budget",
  "rate_user_minute",
  "rate_user_day",
  "rate_global_minute",
  "active_user",
  "active_global",
  "budget_user_day",
  "budget_global_day",
  "budget_global_month",
  "duplicate_request",
  "reservation_unknown",
  "reservation_closed",
  "reservation_expired",
  "attempts_exhausted",
  "usage_out_of_bounds",
] as const;
export type UsageLimitCode = (typeof USAGE_LIMIT_CODES)[number];

export class UsageLimitError extends Error {
  readonly code: UsageLimitCode;
  constructor(code: UsageLimitCode) {
    super(`ai_limit:${code}`);
    this.name = "UsageLimitError";
    this.code = code;
  }
}

/** Reads "ai_limit:<code>" from a database error message; null for anything else. */
export function usageLimitCode(message: unknown): UsageLimitCode | null {
  const match = typeof message === "string" ? /^ai_limit:([a-z_]+)$/.exec(message) : null;
  return match && (USAGE_LIMIT_CODES as readonly string[]).includes(match[1]!) ? (match[1] as UsageLimitCode) : null;
}

/**
 * Why an external model call did not give an answer. `code` is a machine code for the log; the
 * gateway shows the user a fixed Danish message for the category — never a provider's message.
 */
export type ModelCallCategory =
  | "rate_limit"
  | "budget"
  | "token_budget"
  | "configuration"
  | "provider_rejected"
  | "provider_unavailable"
  | "provider_uncertain"
  | "output"
  | "usage_unavailable";

export class ModelCallError extends Error {
  readonly code: string;
  readonly category: ModelCallCategory;
  readonly usage: CallUsageReport | null;
  constructor(category: ModelCallCategory, code: string, usage: CallUsageReport | null = null) {
    super(code);
    this.name = "ModelCallError";
    this.code = code;
    this.category = category;
    this.usage = usage;
  }
}

/** The category of a database limit refusal. */
export function limitCategory(code: UsageLimitCode): ModelCallCategory {
  if (code.startsWith("rate_") || code.startsWith("active_")) return "rate_limit";
  if (code.startsWith("budget_")) return "budget";
  if (code === "output_budget" || code === "input_budget") return "token_budget";
  if (code === "model_not_approved" || code === "limits_missing") return "configuration";
  return "usage_unavailable";
}

/** What the user is told (Danish) — fixed texts, never a provider's or database's message. */
export const MODEL_CALL_MESSAGES: Readonly<Record<ModelCallCategory, string>> = Object.freeze({
  rate_limit: "Du har nået grænsen for antal AI-kald lige nu. Vent lidt, og prøv igen.",
  budget: "AI-budgettet for perioden er brugt. Prøv igen senere, eller kontakt en administrator.",
  token_budget: "Dokumentgrundlaget er for stort til ét AI-kald. Intet er afkortet eller udeladt; afgræns spørgsmålet til færre dokumenter.",
  configuration: "AI-modellen er ikke konfigureret til brug.",
  provider_rejected: "AI-tjenesten afviste kaldet. Prøv igen senere.",
  provider_unavailable: "AI-tjenesten er overbelastet eller utilgængelig lige nu. Prøv igen om lidt.",
  provider_uncertain: "Forbindelsen til AI-tjenesten blev afbrudt. Kaldet er ikke gentaget automatisk.",
  output: "AI-modellen gav ikke et fuldstændigt svar, der kan vises.",
  usage_unavailable: "Forbruget af AI kunne ikke kontrolleres, og kaldet er derfor ikke foretaget.",
});

/**
 * A LOCAL ESTIMATE of the tokens in a text — never the provider's count. Optimistic on purpose
 * (4 characters per token; Danish insurance text is nearer 3): it only refuses a basis that is
 * clearly too large before anything leaves the platform. The exact limit is enforced with the
 * provider's own, model-specific count (count_tokens) once the API connection is active.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** A usage report for a call that reserved nothing. */
export function noUsage(provider: string): CallUsageReport {
  return {
    provider,
    reservationId: null,
    status: "none",
    reservedCostUsd: null,
    actualCostUsd: null,
    countedInputTokens: null,
    inputTokens: null,
    outputTokens: null,
    cacheCreationInputTokens: null,
    cacheReadInputTokens: null,
    attempts: 0,
    transmitted: false,
    providerRequestId: null,
    stopReason: null,
  };
}
