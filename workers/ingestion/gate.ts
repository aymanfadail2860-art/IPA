import { createHash } from "node:crypto";

import type { WorkerDb } from "./pipeline.ts";

/**
 * The release gate (docs/08b §21.6). It replaces the I4 gate that was closed until 8B-I5.
 *
 * A process or re-embedding job may only continue when the DATABASE says its version is
 * released (knowledge.worker_security_clearance → knowledge.security_block_reason):
 *
 *   * the version is released, with a verdict of its own that is safe, current (not
 *     superseded), released, made under the active security policy, and whose every part
 *     passed (structure, malware, PDF security, active content);
 *   * the verdict's checksum is the version's checksum, and its object path the version's path
 *     in knowledge-originals;
 *   * after download: the checksum of the bytes actually downloaded is that checksum.
 *
 * The gate asks twice: before anything is downloaded (admit), and with the downloaded bytes
 * before ANY parsing (inspect). There is no environment variable, flag or switch here — the
 * answer is the database's, and local development runs through the same gate (its verdicts come
 * from the development scanner that only the local seed allows).
 */

export type GateVerdict = { cleared: true; verdictId: string } | { cleared: false; code: string; message: string };

export interface SecurityGate {
  readonly id: string;
  /** Before download: may this job's version be processed at all? */
  admit(jobId: string): Promise<GateVerdict>;
  /** With the downloaded bytes, before any parsing: are these exactly the released bytes? */
  inspect(input: { jobId: string; bytes: Uint8Array }): Promise<GateVerdict>;
}

export const GATE_BLOCKED_CODE = "security_not_released";
export const GATE_BLOCKED_MESSAGE = "Behandlingen er spærret: filen har ikke et gyldigt, frigivet sikkerhedsverdict.";

/** A job stopped by the gate. Never retried; nothing is parsed or embedded. */
export class ProcessingBlocked extends Error {
  readonly code: string;
  constructor(code = GATE_BLOCKED_CODE, message = GATE_BLOCKED_MESSAGE) {
    super(message);
    this.name = "ProcessingBlocked";
    this.code = code;
  }
}

export interface Clearance {
  cleared: boolean;
  reason: string | null;
  verdict_id: string | null;
  policy_version: string | null;
}

function verdict(clearance: Clearance): GateVerdict {
  // Only an explicit true with a verdict id is a pass; anything else is a block.
  if (clearance.cleared === true && clearance.reason === null && typeof clearance.verdict_id === "string" && clearance.verdict_id) {
    return { cleared: true, verdictId: clearance.verdict_id };
  }
  return { cleared: false, code: GATE_BLOCKED_CODE, message: `${GATE_BLOCKED_MESSAGE} (${clearance.reason ?? "ukendt"})` };
}

export function databaseSecurityGate(db: Pick<WorkerDb, "securityClearance">): SecurityGate {
  return Object.freeze({
    id: "release-gate-v1",
    async admit(jobId: string) {
      return verdict(await db.securityClearance(jobId, null));
    },
    async inspect({ jobId, bytes }: { jobId: string; bytes: Uint8Array }) {
      // The checksum is computed here from the bytes themselves — never taken from anyone.
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      return verdict(await db.securityClearance(jobId, sha256));
    },
  });
}
