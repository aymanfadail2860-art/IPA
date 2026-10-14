import { EgressPolicyError, type AuthorizedEgress } from "@/lib/egress/policy";

import type { Model, ModelCallContext } from "../../core/model";
import type { CallUsageReport, ModelInput, ModelOutput } from "../../core/types";
import {
  limitCategory,
  ModelCallError,
  noUsage,
  UsageLimitError,
  type ModelCallCategory,
  type Reservation,
  type UsageLedger,
  type UsageLimits,
} from "../../core/usage";

import type { ApiMessage } from "./api-types";
import { PROMPT_CACHING_ACTIVE, type AnthropicConfig } from "./config";
import { ProviderError } from "./errors";
import { buildMessageRequest, isExternalContract } from "./request";
import { convertMessage } from "./response";
import type { AnthropicTransport } from "./transport";

/**
 * The Claude model (beta L4, docs/beta.md §16). Grade "production": invokeModel only calls it with
 * production evidence and an authorization of exactly the parts it sends (B-012, 8B-I2.5).
 *
 * One call, in this order — a step that refuses stops the call:
 *
 *   1. the output contract must have an external format (Advise and Assessment have none);
 *   2. the request is built and checked against the authorization (assertTransmittable) — nothing
 *      is reserved for a body that may not be sent;
 *   3. the usage ledger reserves the maximum cost in the database (rate limits, active calls and
 *      UTC budgets). A refusal, or a ledger that cannot be reached, stops the call: no ledger, no
 *      spending;
 *   4. the provider counts the request's tokens (free). Over the reservation's input ceiling the
 *      call is refused — the basis is never cut;
 *   5. ONE attempt, opened in the database under the reservation. Nothing is ever retried: a retry
 *      is a new paid call the user did not ask for;
 *   6. the reservation is settled with the provider's usage (cache reads and writes included),
 *      released only when the provider certainly did not process the call (it refused the request
 *      itself: 400, 401, 402, 403, 404, 413, 422 — errors.ts), or else marked uncertain and counted
 *      in full until reconciled. 429, 5xx and 529 are uncertain: the adapter cannot establish that
 *      nothing was billed (B-039, clarified 14 October 2026).
 *
 * No fallback to another model and no fallback to the stub — a failure is a failure.
 */

export interface AnthropicModelOptions {
  config: AnthropicConfig;
  transport: AnthropicTransport;
  /** Prompt caching (cache-ready). Defaults to PROMPT_CACHING_ACTIVE, which is false in L4. */
  cache?: boolean;
}

function categoryOf(error: ProviderError): ModelCallCategory {
  switch (error.failure) {
    case "auth":
    case "permission":
      return "configuration";
    case "billing":
      // The organisation's own spend limit or credit (Anthropic Console): a budget stop.
      return "budget";
    case "rejected":
      return "provider_rejected";
    case "rate_limited":
    case "overloaded":
    case "server_error":
    case "http_other":
      return "provider_unavailable";
    default:
      return "provider_uncertain";
  }
}

export function createAnthropicModel(options: AnthropicModelOptions): Model<"production"> {
  const { config, transport } = options;
  const cache = options.cache ?? PROMPT_CACHING_ACTIVE;

  async function generate(input: ModelInput, egress?: AuthorizedEgress, call?: ModelCallContext): Promise<ModelOutput> {
    if (!isExternalContract(input.outputContract)) throw new ModelCallError("configuration", "contract_not_external");
    const ledger: UsageLedger | null = call?.usage ?? null;
    if (!egress) {
      throw new EgressPolicyError({ correlationId: "none", module: "anthropic", provider: config.modelId, operation: "generate", reason: "unauthorized_transmission", category: null, role: null, partIndex: null });
    }
    if (!ledger || !call) throw new ModelCallError("usage_unavailable", "no_usage_ledger");

    let limits: UsageLimits;
    try {
      limits = await ledger.limits();
    } catch {
      throw new ModelCallError("usage_unavailable", "usage_limits_unreadable");
    }
    const built = buildMessageRequest(input, { modelId: config.modelId, maxOutputTokens: limits.maxOutputTokens, effort: config.effort, cache });
    // 2. The authorization covers exactly this body — before anything is reserved or sent.
    transport.authorize(egress, built.body);

    // 3. Reserve the maximum cost in the database.
    let reservation: Reservation;
    try {
      reservation = await ledger.reserve({
        requestId: call.requestId,
        modelId: config.modelId,
        profileId: input.profile.id,
        action: input.action,
        maxOutputTokens: limits.maxOutputTokens,
        cacheWrites: cache,
      });
    } catch (error) {
      if (error instanceof UsageLimitError) throw new ModelCallError(limitCategory(error.code), error.code);
      throw new ModelCallError("usage_unavailable", "usage_unreachable");
    }
    const report: CallUsageReport = { ...noUsage("anthropic"), reservationId: reservation.id, status: "pending", reservedCostUsd: reservation.reservedCostUsd };

    const release = async (code: string) => {
      try {
        await ledger.release(reservation, { countedInputTokens: report.countedInputTokens, outcome: code });
        report.status = "released";
      } catch {
        // Not released: it stays open and counts in full — never less.
      }
    };
    const uncertain = async (code: string) => {
      try {
        await ledger.markUncertain(reservation, { countedInputTokens: report.countedInputTokens, outcome: code });
        report.status = "uncertain";
      } catch {
        // Still open: it counts in full either way.
      }
    };

    // 4. The provider's own, model-specific token count. Free — a failure releases. The content
    // reaches the provider from here on.
    report.transmitted = true;
    try {
      report.countedInputTokens = await transport.countTokens(egress, built.body);
    } catch (error) {
      const failure = error instanceof ProviderError ? error : new ProviderError("unknown");
      await release(`count_${failure.code}`);
      if (error instanceof EgressPolicyError) throw error;
      throw new ModelCallError(categoryOf(failure), `count_${failure.code}`, report);
    }
    if (report.countedInputTokens > reservation.maxInputTokens) {
      await release("input_token_budget_exceeded");
      throw new ModelCallError("token_budget", "input_token_budget_exceeded", report);
    }

    // 5. One attempt under the reservation — never a second.
    try {
      report.attempts = await ledger.beginAttempt(reservation);
    } catch (error) {
      // Nothing was sent for a message: the reservation can be released.
      const code = error instanceof UsageLimitError ? error.code : "attempt_refused";
      await release(code);
      throw new ModelCallError("usage_unavailable", code, report);
    }

    let message: ApiMessage;
    try {
      const sent = await transport.create(egress, built.body);
      message = sent.message;
      report.providerRequestId = sent.requestId;
    } catch (error) {
      if (error instanceof EgressPolicyError) {
        await release("egress_refused");
        throw error;
      }
      const failure = error instanceof ProviderError ? error : new ProviderError("unknown");
      if (failure.notProcessed) {
        await release(failure.code);
      } else {
        // The provider may have processed (and billed) the call: keep the reservation in full,
        // marked for reconciliation. No retry.
        await uncertain(failure.code);
      }
      throw new ModelCallError(categoryOf(failure), failure.code, report);
    }

    // 6. Billed: settle with the provider's usage, whatever the answer turns out to be.
    const usage = message.usage;
    report.inputTokens = usage.input_tokens;
    report.outputTokens = usage.output_tokens;
    report.cacheCreationInputTokens = usage.cache_creation_input_tokens ?? 0;
    report.cacheReadInputTokens = usage.cache_read_input_tokens ?? 0;
    report.stopReason = message.stop_reason;
    try {
      report.actualCostUsd = await ledger.settle(
        reservation,
        {
          inputTokens: report.inputTokens,
          outputTokens: report.outputTokens,
          cacheCreationInputTokens: report.cacheCreationInputTokens,
          cacheReadInputTokens: report.cacheReadInputTokens,
        },
        { countedInputTokens: report.countedInputTokens, outcome: `stop_${message.stop_reason ?? "none"}` },
      );
      report.status = "settled";
    } catch {
      // Not settled: the reservation stays open and counts at its full reserved cost.
    }

    // Only a finished answer can be shown: a cut-off, refused or otherwise stopped answer is not.
    if (message.stop_reason !== "end_turn") throw new ModelCallError("output", `stop_${message.stop_reason ?? "none"}`, report);
    const converted = convertMessage(message, built.documents, input.outputContract);
    return { raw: converted.raw, citations: converted.citations, usage: report };
  }

  return Object.freeze({ id: config.modelId, version: config.modelId, grade: "production" as const, generate });
}
