import { isDemoMode } from "@/dev/demo/demo-mode";
import { getSupabaseConfig } from "@/lib/supabase/config";

import { assessRetrieval, type RetrievalAvailability } from "./retrieval-availability";

/**
 * Startup check (docs/07 §9.1 point 2): when the server starts, the registry is asked for the
 * configured reranker, so a development-grade reranker in a production environment is reported
 * at startup and not first at the first call. The result is the same availability state Admin
 * and the result views read (getRetrievalAvailability); retrieval then stays unavailable
 * (fail-closed) and every caller gets a system error, while the rest of the platform keeps
 * running. The active embedding model is read per request (it lives in the database).
 *
 * Only with a database connected — the demo without a database (B-003) has no retrieval.
 */
export function checkRetrievalConfiguration(log: (message: string) => void = console.error): RetrievalAvailability | null {
  if (isDemoMode() || !getSupabaseConfig()) return null;
  const availability = assessRetrieval({ demo: false, databaseConfigured: true, activeModel: null });
  if (availability.state === "unavailable") log(`[knowledge] Retrieval er utilgængelig: ${availability.reason}`);
  return availability;
}
