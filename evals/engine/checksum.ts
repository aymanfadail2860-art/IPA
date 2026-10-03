import { createHash } from "node:crypto";

import type { ConfigurationInput, EvalSet, GateSet } from "./types.ts";

/**
 * Canonical JSON and checksums (docs/08b §4.5, §10.1). Object keys are sorted, arrays keep
 * their order, `undefined` is dropped and non-finite numbers are refused — so the same content
 * always gives the same checksum, independent of key order or formatting in the file.
 */

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Ikke-endelige tal kan ikke indgå i en checksum.");
    return JSON.stringify(value);
  }
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => (entry === undefined ? "null" : canonicalJson(entry))).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  throw new Error(`Værdien kan ikke indgå i en checksum: ${typeof value}.`);
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

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

/** The fingerprint of a retrieval configuration (docs/08b §10.1). Chunker versions are a set. */
export function configurationFingerprint(configuration: ConfigurationInput): string {
  return checksumOf({ ...configuration, chunkerVersions: [...new Set(configuration.chunkerVersions)].sort() });
}
