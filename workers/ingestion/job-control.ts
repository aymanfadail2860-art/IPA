/**
 * Job control shared by every kind of job (docs/08b §21.5–21.6): outcomes, aborts and the
 * database errors that end a job or the process. Deliberately free of any parser, chunker or
 * embedder, so the security examination (scan-job.ts) can use it without reaching them.
 */

/** Why a job was aborted by the runtime. */
export type AbortKind = "lease_lost" | "stalled" | "shutdown";

export type JobOutcome = "succeeded" | "retry" | "failed" | "lost" | "abandoned";

/** The database refused the job: another worker holds it (lease expired). Stop silently. */
export function isLeaseLost(error: unknown): boolean {
  return (error as { code?: string }).code === "55P03";
}

/** The worker's identity was refused or revoked (e.g. emergency revoke): fatal for the process. */
export function isIdentityError(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return code === "42501" || code === "28P01" || code === "28000";
}

export class JobAborted extends Error {
  readonly kind: AbortKind;
  constructor(kind: AbortKind) {
    super(`Jobbet blev afbrudt (${kind}).`);
    this.name = "JobAborted";
    this.kind = kind;
  }
}

export function abortKind(signal: AbortSignal | undefined): AbortKind | null {
  if (!signal?.aborted) return null;
  const kind = (signal.reason as { kind?: AbortKind } | undefined)?.kind;
  return kind ?? "shutdown";
}
