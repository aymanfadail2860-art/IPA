import type { RuntimeEnv } from "../../src/lib/knowledge/core/grade.ts";

/**
 * The I5 processing gate (docs/08b §21.5). Until 8B-I5 (quarantine, file validation,
 * active-content enforcement and ClamAV scanning) is approved, a production worker may not take
 * a downloaded original into the parser, the chunker or the embedder.
 *
 *   * Production: the gate is CLOSED. The runtime stands by without claiming jobs, and the
 *     pipeline refuses any job before download and any downloaded bytes before parsing.
 *   * Local/test: a development gate lets fictional fixtures through. It cannot be created in
 *     production.
 *
 * There is no switch, flag or environment variable that opens the production gate. Opening it
 * is a code change that belongs to an approved 8B-I5.
 */

export type GateVerdict = { cleared: true; scanner: string } | { cleared: false; code: string; message: string };

export interface ProcessingGate {
  readonly id: string;
  /** False: no job may enter the pipeline at all. */
  readonly open: boolean;
  /** Called with the downloaded, checksum-verified original — before any parsing. */
  inspect(input: { jobId: string; bytes: Uint8Array }): Promise<GateVerdict>;
}

export const GATE_BLOCKED_CODE = "security_scan_unavailable";
export const GATE_BLOCKED_MESSAGE =
  "Behandlingen er spærret: virusscanning, karantæne og filvalidering er ikke på plads endnu (8B-I5).";

/** A job or document stopped by the gate. Never retried; nothing is parsed or embedded. */
export class ProcessingBlocked extends Error {
  readonly code: string;
  constructor(code = GATE_BLOCKED_CODE, message = GATE_BLOCKED_MESSAGE) {
    super(message);
    this.name = "ProcessingBlocked";
    this.code = code;
  }
}

export const CLOSED_UNTIL_I5: ProcessingGate = Object.freeze({
  id: "closed-until-8b-i5",
  open: false,
  async inspect(): Promise<GateVerdict> {
    return { cleared: false, code: GATE_BLOCKED_CODE, message: GATE_BLOCKED_MESSAGE };
  },
});

/** ⚠ Development-only: lets fictional local/test fixtures through without a scan. */
function developmentFixtureGate(env: Exclude<RuntimeEnv, "production">): ProcessingGate {
  return Object.freeze({
    id: `development-no-scan:${env}`,
    open: true,
    async inspect(): Promise<GateVerdict> {
      return { cleared: true, scanner: "none (development fixtures only)" };
    },
  });
}

export function processingGateFor(env: RuntimeEnv): ProcessingGate {
  return env === "local" || env === "test" ? developmentFixtureGate(env) : CLOSED_UNTIL_I5;
}
