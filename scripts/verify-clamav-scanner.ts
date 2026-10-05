import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { clamdScanner, type MalwareScanner } from "../workers/ingestion/security/scanner.ts";

/**
 * Verification of a CANDIDATE scanner image before it is pushed and deployed (8B-I5.5,
 * .github/workflows/clamav-signatures.yml). The candidate container is started locally in CI and
 * checked over the clamd protocol — the same client the worker uses:
 *
 *   * the engine is ClamAV at the pinned version;
 *   * the signature version and time are known, not in the future and FRESH (at most
 *     maxBuildAgeSeconds old — well inside the 24-hour release limit);
 *   * the EICAR test file is detected and a clean file is not.
 *
 * Any failure exits non-zero: nothing is pushed, nothing is deployed, the running scanner stays,
 * and the workflow failure is the alarm. The output names the scanner revision
 * (ipa-clamav:<engine>-<signature version>) — the immutable ECR tag that verdicts trace back to.
 *
 *   node scripts/verify-clamav-scanner.ts --host 127.0.0.1 --port 3310 [--engine <version>]
 *
 * The expected engine defaults to the APPROVED production engine in deploy/clamav/engine.json
 * (8B-I5.6); --engine is used only by the engine-candidate workflow.
 */

/** The approved engine (deploy/clamav/engine.json): the single, versioned source of truth. */
export function approvedEngine(read: (path: string) => string = (path) => readFileSync(path, "utf8")): { production: string; approved: string[]; ltsLine: string } {
  const file = JSON.parse(read(fileURLToPath(new URL("../deploy/clamav/engine.json", import.meta.url)))) as { production: string; approved: string[]; lts_line: string };
  return { production: file.production, approved: file.approved, ltsLine: file.lts_line };
}

export interface VerifyOptions {
  expectedEngineVersion: string;
  maxBuildAgeSeconds: number;
  now?: () => number;
}

export type VerifyResult =
  | { ok: true; revision: string; engineVersion: string; signatureVersion: string; signatureTime: string; signatureAgeSeconds: number }
  | { ok: false; problems: string[] };

const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** The scanner revision a verdict traces back to (= the ECR tag). Mirrors the database column. */
export function scannerRevision(engineVersion: string, signatureVersion: string): string {
  return `ipa-clamav:${engineVersion}-${signatureVersion}`;
}

/** EICAR, assembled at run time (never stored whole). */
function eicar(): Uint8Array {
  return new TextEncoder().encode(["X5O!P%@AP[4\\PZX54(P^)7CC)7}", "$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!", "$H+H*"].join(""));
}

const CLEAN = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n");

export async function verifyScanner(scanner: MalwareScanner, options: VerifyOptions): Promise<VerifyResult> {
  const now = (options.now ?? Date.now)();
  const problems: string[] = [];
  const info = await scanner.info();
  if ("error" in info) return { ok: false, problems: [`scanner: ${info.error}`] };
  if (info.engine !== "ClamAV") problems.push(`engine is ${info.engine}, not ClamAV`);
  if (info.engineVersion !== options.expectedEngineVersion) problems.push(`engine version ${info.engineVersion ?? "unknown"} is not the pinned ${options.expectedEngineVersion}`);
  if (!info.signatureVersion) problems.push("signature version unknown");
  if (!info.signatureTime) problems.push("signature time unknown");
  else {
    const age = now - info.signatureTime.getTime();
    if (age < -CLOCK_SKEW_MS) problems.push("signature time is in the future");
    if (age > options.maxBuildAgeSeconds * 1000) problems.push(`signatures are ${Math.round(age / 3600_000)} h old (limit ${options.maxBuildAgeSeconds / 3600} h)`);
  }
  const infected = await scanner.scan(eicar(), 30_000);
  if (infected.result !== "infected") problems.push(`EICAR not detected (${infected.result})`);
  const clean = await scanner.scan(CLEAN, 30_000);
  if (clean.result !== "clean") problems.push(`a clean file was not reported clean (${clean.result})`);
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    revision: scannerRevision(info.engineVersion!, info.signatureVersion!),
    engineVersion: info.engineVersion!,
    signatureVersion: info.signatureVersion!,
    signatureTime: info.signatureTime!.toISOString(),
    signatureAgeSeconds: Math.round((now - info.signatureTime!.getTime()) / 1000),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (name: string, fallback: string) => {
    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
  };
  const result = await verifyScanner(clamdScanner({ host: arg("host", "127.0.0.1"), port: Number(arg("port", "3310")) }), {
    expectedEngineVersion: arg("engine", approvedEngine().production),
    maxBuildAgeSeconds: Number(arg("max-age-hours", "8")) * 3600,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(result.ok ? 0 : 1);
}
