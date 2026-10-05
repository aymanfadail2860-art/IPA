import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Liveness for a queue worker without an HTTP server (docs/08b §21.5). The loop and the lease
 * keeper touch a file in the writable temp volume; the container health check
 * (healthcheck.ts) fails when the file is older than the allowed age. A loop that hangs (or a
 * job that stalled and stopped heartbeating) stops touching it, and ECS replaces the task.
 */

export function createLiveness(path: string | null, now: () => number = Date.now, minIntervalMs = 5_000): () => void {
  if (!path) return () => {};
  let last = 0;
  mkdirSync(dirname(path), { recursive: true });
  return () => {
    const at = now();
    if (at - last < minIntervalMs) return;
    last = at;
    writeFileSync(path, String(at));
  };
}

/** True when the file was touched within maxAgeMs. */
export function isAlive(path: string, maxAgeMs: number, now: () => number = Date.now): boolean {
  try {
    const at = Number(readFileSync(path, "utf8"));
    return Number.isFinite(at) && now() - at <= maxAgeMs;
  } catch {
    return false;
  }
}
