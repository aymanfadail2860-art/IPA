import { ProcessingBlocked } from "./gate.ts";
import { OriginalTooLarge } from "./originals.ts";
import { abortKind, isIdentityError, isLeaseLost, JobAborted, type JobOutcome } from "./job-control.ts";
import type { ClaimedJob, PipelineDeps } from "./pipeline.ts";
import type { WorkerQualityReport } from "./quality.ts";
import { effectiveLimits } from "./security/limits.ts";
import { examineOriginal } from "./security/scan.ts";

/**
 * A "scan" job — the security examination of an original in quarantine (docs/08b §21.6):
 *
 *   claim → context (policy, limits) → ticket → download from quarantine
 *     → structural validation → ClamAV → PDF security inspection (isolated child process)
 *     → measurements to the database, which DERIVES the verdict
 *     → safe:     release (the storage function moves the file to knowledge-originals and
 *                 confirms it with the checksum of the bytes it moved) → process job queued
 *     → rejected: move to knowledge-quarantine (no read access for anyone)
 *     → technical scan failure: retry, fail closed
 *
 * Nothing in this job parses the document for ingestion, chunks or embeds: pdfjs, the chunker
 * and the embedders are not reachable from here (architecture test). The bytes never leave the
 * process except to the ClamAV sidecar and the inspection child process, and are never logged.
 */

const TECHNICAL_FAILURE = "Sikkerhedsscanningen kunne ikke gennemføres. Der forsøges igen automatisk.";

export async function runScanJob(job: ClaimedJob, deps: PipelineDeps): Promise<JobOutcome> {
  const { db, log } = deps;
  const started = Date.now();
  const checkAborted = () => {
    const kind = abortKind(deps.signal);
    if (kind) throw new JobAborted(kind);
  };
  const step = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
    checkAborted();
    const begin = Date.now();
    const result = await run();
    log({ job: job.job_id, version: job.version_id, step: name, ms: Date.now() - begin });
    return result;
  };
  const finish = async (): Promise<JobOutcome> => {
    checkAborted();
    await db.complete(job.job_id, {} as WorkerQualityReport);
    log({ job: job.job_id, version: job.version_id, outcome: "succeeded", kind: "scan", ms: Date.now() - started });
    return "succeeded";
  };
  const quarantine = async (): Promise<JobOutcome> => {
    const moved = await step("quarantine", () => deps.originals.move(job, "quarantine_original"));
    if (moved !== "quarantined") throw new Error("Flytningen til karantæne blev ikke bekræftet.");
    return finish();
  };

  try {
    if (job.kind !== "scan") throw new ProcessingBlocked("unknown_job_kind", "Ukendt jobtype.");
    const context = await step("security_context", () => db.securityScanContext(job.job_id));
    // An earlier attempt rejected the file but did not finish moving it: finish that only.
    if (context.security_state === "rejected") return await quarantine();
    if (context.security_state !== "scanning") throw new ProcessingBlocked("security_state_unexpected", "Versionen er ikke under sikkerhedskontrol.");
    if (!deps.scan) throw Object.assign(new Error("Ingen scanner er konfigureret."), { name: "ScannerNotConfigured" });

    const limits = effectiveLimits(context.limits);
    let bytes: Uint8Array;
    try {
      bytes = await step("download", () => deps.originals.download(job, "scan_original", limits.maxBytes));
    } catch (error) {
      // Larger than the policy allows: examined (and rejected) on what was received.
      if (!(error instanceof OriginalTooLarge)) throw error;
      bytes = error.received;
    }
    const measurements = await step("security_examination", () => examineOriginal(bytes, context, deps.scan!));
    const recorded = await step("security_verdict", () => db.recordSecurityVerdict(job.job_id, measurements));
    log({ job: job.job_id, version: job.version_id, step: "security_verdict", final: recorded.final, failure_code: recorded.failure_code, verdict: recorded.verdict_id });

    if (recorded.next === "release") {
      const moved = await step("release", () => deps.originals.move(job, "release_original"));
      if (moved === "invalidated") {
        // The bytes moved were not the bytes scanned: the verdict is void and the version is
        // back in quarantine. Scan again.
        return await failOrLost("checksum_changed", TECHNICAL_FAILURE, true);
      }
      if (moved !== "released" && moved !== "already_released") throw new Error("Frigivelsen blev ikke bekræftet.");
      return await finish();
    }
    if (recorded.next === "quarantine") return await quarantine();
    return await failOrLost(recorded.failure_code ?? "scan_failed", TECHNICAL_FAILURE, true);
  } catch (error) {
    const aborted = abortKind(deps.signal) ?? (error instanceof JobAborted ? error.kind : null);
    if (aborted) {
      const outcome: JobOutcome = aborted === "lease_lost" ? "lost" : "abandoned";
      log({ job: job.job_id, version: job.version_id, outcome, reason: aborted });
      return outcome;
    }
    if (isIdentityError(error)) throw error;
    if (isLeaseLost(error)) {
      log({ job: job.job_id, version: job.version_id, outcome: "lost" });
      return "lost";
    }
    if (error instanceof ProcessingBlocked) {
      const outcome = await failOrLost(error.code, error.message, false);
      log({ job: job.job_id, version: job.version_id, outcome, code: error.code });
      return outcome;
    }
    // A technical failure is never a pass: the version stays unreleased ("Teknisk scanfejl").
    const name = (error as { name?: string }).name ?? "Error";
    const code = typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : undefined;
    const outcome = await failOrLost("scan_error", TECHNICAL_FAILURE, true);
    log({ job: job.job_id, version: job.version_id, outcome, error: name, ...(code ? { code } : {}) });
    return outcome;
  }

  async function failOrLost(code: string, message: string, retryable: boolean): Promise<JobOutcome> {
    try {
      return await db.fail(job.job_id, code, message, retryable);
    } catch (failure) {
      if (isLeaseLost(failure)) return "lost";
      throw failure;
    }
  }
}
