import { canonicalJson, retrievalFingerprint, sha256 } from "../../src/lib/knowledge/core/provider.ts";

import type { ConfigurationInput, EvalSet, GateSet } from "./types.ts";

export { canonicalJson, sha256 };

/**
 * Checksums (docs/08b §4.5, §10.1). Canonical JSON (sorted keys, no undefined, finite numbers)
 * comes from the provider contract, so the evaluation and the retrieval layer fingerprint the
 * same way.
 */

export function checksumOf(value: unknown): string {
  return sha256(canonicalJson(value));
}

/** The evaluation set: manifest plus every case (retired ones included), sorted by id. */
export function evalSetChecksum(set: EvalSet): string {
  return checksumOf({ manifest: set.manifest, cases: [...set.cases].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) });
}

export function gateSetChecksum(gates: GateSet): string {
  return checksumOf(gates);
}

/** The fingerprint of a retrieval configuration (docs/08b §10.1), from the provider contract. */
export function configurationFingerprint(configuration: ConfigurationInput): string {
  return retrievalFingerprint(configuration);
}
