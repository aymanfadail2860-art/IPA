import { hostname } from "node:os";

import { createClient } from "@supabase/supabase-js";

import { runtimeEnv } from "../../src/lib/knowledge/core/grade.ts";
import { createEmbedder } from "../../src/lib/knowledge/core/registry.ts";

import { supabaseOriginals, supabaseWorkerDb } from "./db.ts";
import { processJob } from "./pipeline.ts";

/**
 * ⚠ Ingestion worker — development-only access in phase 7 (docs/07 §14.1, B-16). The
 * service-role key is refused outside IPA_RUNTIME_ENV=local/test (8B-I3).
 *
 * A standalone Node process outside the Next.js app; it never shares runtime with user
 * requests (docs/03 §8, §14). Where it is hosted is not locked. Locally:
 *
 *   npm run worker:ingestion            # polls the queue
 *   npm run worker:ingestion -- --once  # processes available jobs and exits
 *
 * Environment (never committed; see .env.example):
 *   NEXT_PUBLIC_SUPABASE_URL    Supabase API URL
 *   SUPABASE_SERVICE_ROLE_KEY   development-only worker access; never in src/ or the browser
 *   IPA_RUNTIME_ENV             local | test — required for the test embedder (development
 *                               grade). Missing or anything else = production (fail-closed).
 *   IPA_WORKER_ID               optional, defaults to ingestion-<host>-<pid>
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
// The service role is never the production worker's credential (docs/08b §6.1.1 pkt. 6,
// 8B-I3): outside local/test the worker refuses to start with it.
if (key && runtimeEnv() === "production") {
  console.error("worker: service-rollen må kun bruges lokalt og i test (IPA_RUNTIME_ENV=local/test). Workeren starter ikke.");
  process.exit(1);
}
if (!url || !key) {
  console.error("worker: NEXT_PUBLIC_SUPABASE_URL og SUPABASE_SERVICE_ROLE_KEY skal være sat.");
  process.exit(1);
}

const once = process.argv.includes("--once");
const workerId = process.env.IPA_WORKER_ID ?? `ingestion-${hostname()}-${process.pid}`;
const pollMs = Number(process.env.IPA_WORKER_POLL_MS ?? 5000);

const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const db = supabaseWorkerDb(client, workerId);
const originals = supabaseOriginals(client);
// Structured log lines: job, version, step and duration — never document content.
const log = (event: Record<string, unknown>) => console.log(JSON.stringify({ worker: workerId, ...event }));

// Fail fast at startup (docs/07 §9.1): every active/candidate model must have an allowed
// implementation in this environment — e.g. the test embedder only in local/test.
for (const model of await db.embeddingModels()) {
  try {
    createEmbedder(model);
  } catch (error) {
    console.error(`worker: ${(error as Error).message}`);
    process.exit(1);
  }
}

let stopping = false;
process.on("SIGTERM", () => (stopping = true));
process.on("SIGINT", () => (stopping = true));

while (!stopping) {
  const job = await db.claim();
  if (job) {
    await processJob(job, { db, originals, log });
    continue;
  }
  if (once) break;
  await new Promise((resolve) => setTimeout(resolve, pollMs));
}
