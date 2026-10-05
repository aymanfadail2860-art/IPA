import { isAlive } from "./liveness.ts";

/**
 * Container health check (ECS healthCheck command): exit 0 when the worker loop touched its
 * liveness file recently, 1 otherwise. No network, no database, no credentials.
 */

const path = process.env.IPA_WORKER_LIVENESS_FILE ?? "/tmp/ipa-worker/alive";
const maxAgeMs = Number(process.env.IPA_WORKER_LIVENESS_MAX_AGE_MS ?? 180_000);
process.exit(isAlive(path, maxAgeMs) ? 0 : 1);
