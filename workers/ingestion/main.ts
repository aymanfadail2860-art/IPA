import { hostname } from "node:os";

import { createClient } from "@supabase/supabase-js";

import { supabaseOriginals, supabaseWorkerDb } from "./db.ts";
import { processJob } from "./pipeline.ts";

/**
 * ⚠ Ingestion worker — development-only access in phase 7 (docs/07 §14.1, B-16).
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
 *   IPA_WORKER_ID               optional, defaults to ingestion-<host>-<pid>
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
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
