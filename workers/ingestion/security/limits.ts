/**
 * Resource limits of the PDF security pipeline (docs/08b §21.6). The active security policy in
 * the database (knowledge.security_policies, "pdf-v1") carries the server-side values; the
 * HARD caps below can never be exceeded, whatever a policy row says. Nothing in the UI or the
 * environment can raise them.
 */

export interface SecurityLimits {
  /** Bucket limit (50 MB, docs/07 §5.4 / docs/08b §6.4). */
  maxBytes: number;
  /** docs/07 (2.000 pages). */
  maxPages: number;
  /** Indirect objects in the file (incl. those in object streams). */
  maxObjects: number;
  /** Decompressed size of ONE object stream. */
  maxObjectStreamBytes: number;
  /** Decompressed size of all object streams together. */
  maxTotalInflatedBytes: number;
  /** Decompressed/compressed ratio of an object stream (decompression bombs). */
  maxInflateRatio: number;
  /** Nesting of dictionaries/arrays. */
  maxNestingDepth: number;
  /** Wall clock of the inspection child process. */
  inspectTimeoutMs: number;
  /** Heap of the inspection child process. */
  inspectMemoryMb: number;
  /** One ClamAV scan (docs/08b §6.4: 120 s). */
  scanTimeoutMs: number;
}

export const HARD_LIMITS: SecurityLimits = Object.freeze({
  maxBytes: 52_428_800,
  maxPages: 2_000,
  maxObjects: 200_000,
  maxObjectStreamBytes: 20 * 1024 * 1024,
  maxTotalInflatedBytes: 100 * 1024 * 1024,
  maxInflateRatio: 200,
  maxNestingDepth: 64,
  inspectTimeoutMs: 60_000,
  inspectMemoryMb: 512,
  scanTimeoutMs: 120_000,
});

const POLICY_KEYS: Record<keyof SecurityLimits, string> = {
  maxBytes: "max_bytes",
  maxPages: "max_pages",
  maxObjects: "max_objects",
  maxObjectStreamBytes: "max_object_stream_bytes",
  maxTotalInflatedBytes: "max_total_inflated_bytes",
  maxInflateRatio: "max_inflate_ratio",
  maxNestingDepth: "max_nesting_depth",
  inspectTimeoutMs: "inspect_timeout_ms",
  inspectMemoryMb: "inspect_memory_mb",
  scanTimeoutMs: "scan_timeout_ms",
};

/** The policy's limits, each capped by the hard limit; a missing or invalid value uses the cap. */
export function effectiveLimits(policy: Record<string, unknown> | null | undefined): SecurityLimits {
  const out = { ...HARD_LIMITS };
  for (const [key, policyKey] of Object.entries(POLICY_KEYS) as [keyof SecurityLimits, string][]) {
    const value = policy?.[policyKey];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) out[key] = Math.min(value, HARD_LIMITS[key]);
  }
  return Object.freeze(out);
}
