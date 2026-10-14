import type { AuthorizedEgress } from "@/lib/egress/policy";

import type { Grade, ModelInput, ModelOutput } from "./types";
import type { UsageLedger } from "./usage";

/**
 * Per-call context for an external model (beta L4): the gateway's request id and the usage
 * ledger of the signed-in user (budget, rate limits, reservations). An external model refuses to
 * call out without a ledger.
 */
export interface ModelCallContext {
  requestId: string;
  usage: UsageLedger | null;
}

/**
 * Model interface (docs/08 §3.1). Generation is with the Claude API (docs/03 §2, locked); the
 * adapter is built in the beta's L4 (src/lib/ai/providers/anthropic). Model versions are configuration.
 *
 * `grade` is a property of the implementation — the caller never sets it. Only invoke.ts
 * calls `generate` (guardrail test), and it enforces the pairing rule of B-012.
 */
export interface Model<G extends Grade = Grade> {
  readonly id: string;
  readonly version: string;
  readonly grade: G;
  /**
   * `egress` is the authorization of exactly the parts in `input` (8B-I2.5). invokeModel always
   * passes it for an external model; an external adapter MUST hand it to its transport, which
   * refuses to transmit without it (assertTransmittable). An in-process model ignores it.
   * `call` carries the usage ledger an external model must reserve with before it sends anything.
   */
  generate(input: ModelInput, egress?: AuthorizedEgress, call?: ModelCallContext): Promise<ModelOutput>;
}
