import type { SecurityGate } from "../../../workers/ingestion/gate.ts";
import type { OriginalStore, ScanTools, WorkerDb } from "../../../workers/ingestion/pipeline.ts";

/**
 * ⚠ TEST FAKES for the ingestion worker's unit tests — never used outside tests.
 *
 * releasedGate() stands in for the database's release gate when a test is about something
 * else (the loop, the lease, the pipeline steps) and the version is assumed to be released.
 * The gate itself is tested against the database (pgTAP upload_security) and in
 * worker-security.test.ts.
 */

export const TEST_VERDICT_ID = "00000000-0000-4000-a000-0000000000aa";

export function releasedGate(): SecurityGate {
  return {
    id: "test-released",
    admit: async () => ({ cleared: true, verdictId: TEST_VERDICT_ID }),
    inspect: async () => ({ cleared: true, verdictId: TEST_VERDICT_ID }),
  };
}

export function blockedGate(code = "security_not_released"): SecurityGate {
  return {
    id: "test-blocked",
    admit: async () => ({ cleared: false, code, message: "Ikke frigivet." }),
    inspect: async () => ({ cleared: false, code, message: "Ikke frigivet." }),
  };
}

/** The I5 members of WorkerDb for tests that do not exercise them. */
export function securityDbDefaults(): Pick<WorkerDb, "securityScanContext" | "recordSecurityVerdict" | "securityClearance"> {
  return {
    securityScanContext: async () => {
      throw new Error("securityScanContext is not part of this test");
    },
    recordSecurityVerdict: async () => {
      throw new Error("recordSecurityVerdict is not part of this test");
    },
    securityClearance: async () => ({ cleared: true, reason: null, verdict_id: TEST_VERDICT_ID, policy_version: "pdf-v1" }),
  };
}

/** Originals that always return these bytes; moving is not part of a processing test. */
export function staticOriginals(bytes: Uint8Array | (() => Uint8Array) = new Uint8Array()): OriginalStore {
  return {
    download: async () => (typeof bytes === "function" ? bytes() : bytes),
    move: async () => {
      throw new Error("move is not part of this test");
    },
  };
}

/** Scan tools that must never be used (process-job tests). */
export function unusedScanTools(): ScanTools {
  const refuse = async (): Promise<never> => {
    throw new Error("the scanner is not part of this test");
  };
  return { scanner: { info: refuse, scan: refuse }, inspector: { inspect: refuse } };
}
