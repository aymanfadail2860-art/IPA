import type { EmbeddingModelSpec } from "./core/embedding";
import type { Grade, RuntimeEnv } from "./core/grade";
import { runtimeEnv } from "./core/grade";
import { assessProduction, type ProductionCondition } from "./core/production-conditions";
import { createEmbedder, createReranker } from "./core/registry";
import type { RetrievalContext } from "./core/retrieval-context";
import { providersForContext, type ProviderRuntime } from "./providers/configured";

/**
 * Whether retrieval can run at all — a state the rest of the system can read, not only a log
 * line (docs/07 §9.1 point 2, §20.2).
 *
 * docs/04 §16: "Insufficient" and "Error" must never look alike. "Der findes ikke
 * tilstrækkelig dokumentation" is a competent answer; "Retrieval er utilgængelig" is a system
 * failure. Everything that shows retrieval results decides how to show them with
 * presentRetrieval(), which can only map an unavailable retrieval to an error.
 *
 * 8B-I6: with the retrieval context, the state also says whether production evidence is
 * available (P1–P4, P6, P9 — the conditions that do not depend on a query's items) and why not:
 * no configuration, a suspended one, or "Konfigurationen er ikke godkendt" when the runtime does
 * not match the active configuration (docs/08b §10.2).
 */

export type RetrievalAvailability =
  | {
      state: "available";
      reranker: { id: string; grade: Grade };
      embeddingModel: { label: string; grade: Grade } | null;
      /** Production only when P1–P4, P6 and P9 hold for the runtime (docs/08b §9). */
      grade: Grade;
      configuration: { id: string; label: string; version: number; fingerprint: string; status: "active" | "suspended"; tier: "pilot" | "standard" | null } | null;
      /** Why production evidence is unavailable; null when it is available. */
      productionUnavailable: string | null;
    }
  | { state: "unavailable"; reason: string };

export interface AvailabilityInput {
  demo: boolean;
  databaseConfigured: boolean;
  /** The active embedding model; null = none active; undefined = could not be read. */
  activeModel: EmbeddingModelSpec | null | undefined;
  /** knowledge.retrieval_context(); undefined = not read (startup check), null = unreadable. */
  context?: RetrievalContext | null;
  runtime?: () => ProviderRuntime;
  rerankerId?: string;
  environment?: RuntimeEnv;
}

const RUNTIME_MISSING = (): ProviderRuntime => {
  throw new Error("Der er ingen forbindelse til Bedrock.");
};

/** The conditions that can be assessed without a query. */
const STATIC_CONDITIONS: readonly ProductionCondition[] = ["P1", "P2", "P3", "P4", "P6", "P9"];

export function productionUnavailableReason(unmet: readonly ProductionCondition[], context: RetrievalContext | null): string | null {
  const relevant = unmet.filter((condition) => STATIC_CONDITIONS.includes(condition));
  if (relevant.length === 0) return null;
  const configuration = context?.configuration ?? null;
  if (!configuration) return "Der er ingen aktiv, godkendt retrieval-konfiguration. Evidensen er udviklingsgrad.";
  if (configuration.status === "suspended") {
    return "Konfigurationen er suspenderet. Production-evidens er utilgængelig, indtil en ny bestået kørsel er godkendt og aktiveret.";
  }
  if (relevant.includes("P4")) return "Konfigurationen er ikke godkendt: runtime matcher ikke den aktive konfigurations fingeraftryk.";
  if (configuration.notReady.includes("scope")) return "Korpusset indeholder dokumenttyper, den godkendte kørsel ikke evaluerede. Det kræver en ny kørsel.";
  return `Production-evidens er utilgængelig (ikke opfyldt: ${relevant.join(", ")}).`;
}

export function assessRetrieval(input: AvailabilityInput): RetrievalAvailability {
  if (input.demo) return { state: "unavailable", reason: "Retrieval kræver en database og er ikke tilgængelig i demoen." };
  if (!input.databaseConfigured) return { state: "unavailable", reason: "Der er ingen forbindelse til vidensgrundlaget (databasen er ikke konfigureret)." };
  if (input.activeModel === undefined) return { state: "unavailable", reason: "Den aktive embedding-model kunne ikke læses fra databasen." };
  if (input.context === null) return { state: "unavailable", reason: "Retrieval-konfigurationen kunne ikke læses fra databasen." };
  const environment = input.environment ?? runtimeEnv();

  if (input.context) {
    let providers;
    try {
      providers = providersForContext(input.context, input.runtime ?? RUNTIME_MISSING, environment);
    } catch (error) {
      return { state: "unavailable", reason: (error as Error).message };
    }
    const configuration = input.context.configuration;
    const params = configuration?.params ?? { candidateK: 0, rerankN: 0, topK: 0, maxPerVersion: 0, minScore: 0, rrfK: 0 };
    const assessment = assessProduction({
      context: input.context,
      embedding: providers.embedding,
      reranker: providers.reranker,
      algorithmVersion: configuration?.algorithmVersion ?? "",
      params,
      query: { text: "", mode: "current", asOf: "", language: "da", filters: {} },
      items: [],
      devOverride: false,
      schemaVersion: 2,
    });
    const reason = productionUnavailableReason(assessment.unmet, input.context);
    return {
      state: "available",
      reranker: { id: providers.reranker.id, grade: providers.reranker.grade },
      embeddingModel: providers.embedding ? { label: providers.embedding.embedder.id, grade: providers.embedding.embedder.grade } : null,
      grade: reason === null ? "production" : "development",
      configuration: configuration
        ? { id: configuration.id, label: configuration.label, version: configuration.version, fingerprint: configuration.fingerprint, status: configuration.status, tier: configuration.tier }
        : null,
      productionUnavailable: reason,
    };
  }

  // Without a context (the startup check): only whether the registry can construct the
  // configured implementations. Never production.
  let reranker;
  try {
    reranker = createReranker(input.rerankerId ?? (process.env.IPA_RERANKER || "none"), environment);
  } catch (error) {
    return { state: "unavailable", reason: (error as Error).message };
  }
  let embedder = null;
  if (input.activeModel) {
    try {
      embedder = createEmbedder(input.activeModel, environment);
    } catch (error) {
      return { state: "unavailable", reason: (error as Error).message };
    }
  }
  return {
    state: "available",
    reranker: { id: reranker.id, grade: reranker.grade },
    embeddingModel: embedder ? { label: embedder.id, grade: embedder.grade } : null,
    grade: "development",
    configuration: null,
    productionUnavailable: "Der er ingen aktiv, godkendt retrieval-konfiguration. Evidensen er udviklingsgrad.",
  };
}
