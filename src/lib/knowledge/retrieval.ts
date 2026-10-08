import "server-only";

import { isDemoMode } from "@/dev/demo/demo-mode";
import { getServerSession } from "@/lib/auth/server-session";
import { AlertConfigError, createAlertSink, logAlertSink, type AlertSink } from "@/lib/observability/alerts";
import { createRetrievalTelemetry } from "@/lib/observability/retrieval-telemetry";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import type { EvidenceSet } from "./core/evidence";
import { applicationProviderRuntime, providersForContext } from "./providers/configured";
import { assessRetrieval, type RetrievalAvailability } from "./retrieval-availability";
import {
  DEFAULT_RETRIEVAL_CONFIG,
  readRetrievalContext,
  RetrievalError,
  runRetrieval,
  type ClassifiedRetrievalRequest,
  type RetrievalObserver,
  type RetrievalRequest,
} from "./retrieval-core";
import type { RetrievalOutcome } from "./result-presentation";

/**
 * retrieveEvidence (docs/07 §8.2) — server-only, no HTTP route. Later modules call it
 * server-side; the Admin tool "Afprøv retrieval" calls exactly this function with exactly
 * this configuration.
 *
 *   * Runs as the signed-in user: the database filters by that user's document access (RLS
 *     and the access filter in knowledge.search_chunks). There is no way to search as someone
 *     else, and no admin shortcut. Advisors and leaders reach knowledge only through document
 *     grants (docs/07 §4.3), so no role permission is required here — the database decides.
 *   * The embedder, the reranker and the parameters come from the retrieval configuration in
 *     service (knowledge.retrieval_context(), 8B-I6) — or, without one, from the fail-closed
 *     registry (docs/07 §9.1). They are never parameters, so a caller cannot choose a provider
 *     or set the evidence grade. The grade is derived from P1–P9 for every set (docs/08b §9).
 *   * The query is not stored or logged. Telemetry (8B-I7) logs only the outcome, the grade and
 *     the duration of each step, and raises the alarms for unavailable retrieval and a
 *     configuration mismatch (src/lib/observability/retrieval-telemetry.ts).
 */

export { RetrievalError, type ClassifiedRetrievalRequest, type RetrievalAvailability, type RetrievalRequest };

/**
 * Whether retrieval can run right now (docs/07 §20.2), and whether production evidence is
 * available (docs/08b §10.2): readable by everything that shows results and by Admin — not
 * only a line in the server log.
 */
export async function getRetrievalAvailability(): Promise<RetrievalAvailability> {
  if (isDemoMode() || !getSupabaseConfig()) return assessRetrieval({ demo: isDemoMode(), databaseConfigured: false, activeModel: null });
  const knowledge = (await createSupabaseServerClient()).schema("knowledge");
  const context = await readRetrievalContext(knowledge);
  return assessRetrieval({ demo: false, databaseConfigured: true, activeModel: context?.activeModel ?? undefined, context, runtime: applicationProviderRuntime });
}

let applicationSink: AlertSink | null = null;

/** The application's alarm channel (D-15). A misconfigured channel falls back to the log — never silence. */
function alertSink(): AlertSink {
  if (!applicationSink) {
    try {
      applicationSink = createAlertSink(process.env, "app");
    } catch (error) {
      process.stdout.write(`${JSON.stringify({ event: "alert_config_invalid", reason: error instanceof AlertConfigError ? error.message : "unknown" })}\n`);
      applicationSink = logAlertSink("app");
    }
  }
  return applicationSink;
}

/** Development tools for one call — refused outside IPA_RUNTIME_ENV=local/test (B-009). */
export interface RetrievalDevOptions {
  devForceInsufficient?: boolean;
}

export async function retrieveEvidence(request: ClassifiedRetrievalRequest, dev: RetrievalDevOptions = {}): Promise<EvidenceSet> {
  if (isDemoMode()) throw new RetrievalError("unavailable", "Retrieval kræver en database og er ikke tilgængelig i demoen.");
  const telemetry = createRetrievalTelemetry({ sink: alertSink() });
  try {
    const set = await retrieveObserved(request, dev, telemetry.observe);
    await telemetry.succeeded(set);
    return set;
  } catch (error) {
    // Access and invalid requests are not system failures; everything else is.
    await telemetry.failed(error instanceof RetrievalError ? error.code : "error");
    throw error;
  }
}

async function retrieveObserved(request: ClassifiedRetrievalRequest, dev: RetrievalDevOptions, observe: RetrievalObserver): Promise<EvidenceSet> {
  if (isDemoMode()) throw new RetrievalError("unavailable", "Retrieval kræver en database og er ikke tilgængelig i demoen.");
  // An active platform user is required. WHICH documents the user may read is decided by the
  // database (docs/07 §4.1): administrators through the role, advisors and leaders through
  // document grants — never through a role permission, so the role is not checked here.
  if (!(await getServerSession())) throw new RetrievalError("denied", "Du har ikke adgang til vidensgrundlaget.");

  const knowledge = (await createSupabaseServerClient()).schema("knowledge");
  const context = await readRetrievalContext(knowledge);
  const availability = assessRetrieval({ demo: false, databaseConfigured: true, activeModel: context?.activeModel ?? undefined, context, runtime: applicationProviderRuntime });
  // Unavailable is a system failure, never an empty (= "insufficient") result.
  if (availability.state === "unavailable") throw new RetrievalError("unavailable", availability.reason);
  if (!context) throw new RetrievalError("unavailable", "Retrieval-konfigurationen kunne ikke læses fra databasen.");
  const providers = providersForContext(context, applicationProviderRuntime);
  // The configuration's own parameters; without one, the defaults (development).
  const config = context.configuration?.params ?? DEFAULT_RETRIEVAL_CONFIG;
  return runRetrieval(request, {
    db: knowledge,
    embedding: providers.embedding,
    reranker: providers.reranker,
    config,
    devForceInsufficient: dev.devForceInsufficient === true,
    observe,
  });
}

/** retrieveEvidence as an explicit outcome for the UI: a failure is never an empty result. */
export async function retrieveEvidenceOutcome(request: ClassifiedRetrievalRequest, dev: RetrievalDevOptions = {}): Promise<RetrievalOutcome> {
  try {
    return { kind: "evidence", set: await retrieveEvidence(request, dev) };
  } catch (error) {
    if (error instanceof RetrievalError) {
      if (error.code === "invalid_request") return { kind: "invalid_request", message: error.message };
      if (error.code === "denied") return { kind: "denied", message: error.message };
      return { kind: "unavailable", message: error.message };
    }
    return { kind: "unavailable", message: "Søgningen kunne ikke gennemføres." };
  }
}
