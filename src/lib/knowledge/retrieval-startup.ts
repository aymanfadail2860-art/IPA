import { isDemoMode } from "@/dev/demo/demo-mode";
import { getSupabaseConfig } from "@/lib/supabase/config";

import { createReranker } from "./core/registry";

/**
 * Startup check (docs/07 §9.1 point 2): the registry is asked for the configured reranker when
 * the server starts, so a development-grade reranker in a production environment is reported
 * at startup and not first at the first call. Retrieval then stays disabled (fail-closed);
 * the rest of the platform keeps running.
 *
 * Only with a database connected — the demo without a database (B-003) has no retrieval.
 * The embedder depends on the active model in the database and is checked at the first call;
 * the ingestion worker checks every model at its own startup.
 */
export function checkRetrievalConfiguration(log: (message: string) => void = console.error): boolean {
  if (isDemoMode() || !getSupabaseConfig()) return true;
  try {
    createReranker();
    return true;
  } catch (error) {
    log(`[knowledge] Retrieval er slået fra: ${(error as Error).message}`);
    return false;
  }
}
