import { checkFile, type StructuralCode } from "./file-checks.ts";
import type { PdfInspector } from "./inspector.ts";
import { effectiveLimits, type SecurityLimits } from "./limits.ts";
import type { Finding, PdfSecurityCode } from "./pdf-inspect.ts";
import type { MalwareScanner, ScannerErrorCode } from "./scanner.ts";

/**
 * The security examination of one original in quarantine (docs/08b §21.6), in the policy's
 * order:
 *
 *   1. structural validation — byte level only: size, checksum, magic bytes, extension, MIME,
 *      polyglot (file-checks.ts);
 *   2. malware scan — ClamAV (scanner.ts), with the signature age checked;
 *   3. PDF security inspection — only for a structurally valid, clean file, in an isolated
 *      child process (inspector.ts).
 *
 * The result is a set of MEASUREMENTS. The worker never decides "safe": the database derives
 * the final verdict from them (knowledge.worker_record_security_verdict) and checks them again.
 * Nothing here logs or returns file content; the malware name is a sanitized signature name.
 */

/** What knowledge.worker_security_scan_context returns. */
export interface ScanContext {
  security_state: string;
  storage_bucket: string;
  policy_version: string;
  max_signature_age_seconds: number;
  limits: Record<string, unknown>;
  checksum_sha256: string;
  byte_size: number | null;
  upload_mime: string | null;
  original_filename: string | null;
}

export type MalwareCode = ScannerErrorCode | "stale_signatures" | "signature_unknown";

/** The input of knowledge.worker_record_security_verdict (strictly validated there). */
export interface SecurityMeasurements {
  policy_version: string;
  checksum_sha256: string;
  byte_size: number;
  detected_mime: string;
  structural: { result: "pass" | "fail"; code: StructuralCode | null };
  malware: { result: "clean" | "infected" | "error" | "not_scanned"; code: MalwareCode | null; name: string | null };
  scanner: { engine: string | null; engine_version: string | null; signature_version: string | null; signature_time: string | null };
  pdf_security: { result: "pass" | "fail" | "error" | "not_run"; code: PdfSecurityCode | null };
  active_content: { result: "pass" | "fail" | "not_run"; findings: Finding[] };
}

export interface ExamineDeps {
  scanner: MalwareScanner;
  inspector: PdfInspector;
  now?: () => number;
}

/** Signatures newer than this are "from the future": the clock or the database is wrong. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

export function signatureAgeProblem(signatureTime: Date | null, maxAgeSeconds: number, now: number): "stale_signatures" | "signature_unknown" | null {
  if (!signatureTime || !Number.isFinite(signatureTime.getTime())) return "signature_unknown";
  const age = now - signatureTime.getTime();
  if (age < -CLOCK_SKEW_MS || age > maxAgeSeconds * 1000) return "stale_signatures";
  return null;
}

export async function examineOriginal(bytes: Uint8Array, context: ScanContext, deps: ExamineDeps): Promise<SecurityMeasurements> {
  const now = deps.now ?? Date.now;
  const limits: SecurityLimits = effectiveLimits(context.limits);

  // 1. Structural validation (no parser).
  const structural = checkFile(
    bytes,
    { checksum: context.checksum_sha256, byteSize: context.byte_size, mime: context.upload_mime, filename: context.original_filename },
    limits,
  );

  // 2. Malware. Every file that fits the limit is scanned — also one that already failed
  // validation, so a malware find is recorded as such. Too large: not scanned (and rejected).
  let malware: SecurityMeasurements["malware"] = { result: "not_scanned", code: null, name: null };
  let scanner: SecurityMeasurements["scanner"] = { engine: null, engine_version: null, signature_version: null, signature_time: null };
  if (structural.code !== "too_large") {
    const info = await deps.scanner.info();
    if ("error" in info) {
      malware = { result: "error", code: info.error, name: null };
    } else {
      scanner = {
        engine: info.engine,
        engine_version: info.engineVersion,
        signature_version: info.signatureVersion,
        signature_time: info.signatureTime ? info.signatureTime.toISOString() : null,
      };
      const result = await deps.scanner.scan(bytes, limits.scanTimeoutMs);
      const ageProblem = signatureAgeProblem(info.signatureTime, context.max_signature_age_seconds, now());
      if (result.result === "infected") malware = { result: "infected", code: null, name: result.name };
      else if (result.result === "error") malware = { result: "error", code: result.code, name: null };
      // "Clean" according to outdated or unknown signatures is not clean.
      else if (ageProblem) malware = { result: "error", code: ageProblem, name: null };
      else malware = { result: "clean", code: null, name: null };
    }
  }

  // 3. PDF security — only a valid PDF that the scanner found clean.
  let pdfSecurity: SecurityMeasurements["pdf_security"] = { result: "not_run", code: null };
  let activeContent: SecurityMeasurements["active_content"] = { result: "not_run", findings: [] };
  if (structural.result === "pass" && malware.result === "clean") {
    const inspection = await deps.inspector.inspect(bytes, limits);
    pdfSecurity = inspection.pdfSecurity.result === "pass" ? { result: "pass", code: null } : { result: inspection.pdfSecurity.result, code: inspection.pdfSecurity.code };
    activeContent = { result: inspection.activeContent.result, findings: [...inspection.activeContent.findings] };
  }

  return {
    policy_version: context.policy_version,
    checksum_sha256: structural.checksum,
    byte_size: bytes.byteLength,
    detected_mime: structural.detectedMime,
    structural: { result: structural.result, code: structural.code ?? null },
    malware,
    scanner,
    pdf_security: pdfSecurity,
    active_content: activeContent,
  };
}
