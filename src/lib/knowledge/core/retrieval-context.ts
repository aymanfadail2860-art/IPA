import type { EmbeddingModelSpec } from "./embedding.ts";
import { retrievalFingerprint, type RetrievalFingerprintMaterial, type RetrievalParams } from "./provider.ts";

/**
 * The retrieval context (docs/08b §9–§10, 8B-I6): what the database says, at the moment of a
 * retrieval, about the active embedding model, the retrieval configuration in service and the
 * identity the call runs as. Read by the retrieval layer through knowledge.retrieval_context()
 * with the SAME client that searches, so it describes exactly that call.
 *
 * Parsing is strict and fail-closed: anything malformed or missing gives null, and a missing
 * context can only ever lead to development grade (P1, P3, P6, P9 cannot be established).
 *
 * Shared by the Next.js server and the evaluation engine: relative imports with .ts.
 */

export type ConfigurationStatus = "active" | "suspended";

/** Why the configuration in service cannot carry production evidence now (from the database). */
export type NotReadyReason = "suspended" | "active_count" | "evaluation" | "gate_set" | "development" | "model" | "scope";

export interface ConfigurationInService {
  id: string;
  label: string;
  version: number;
  fingerprint: string;
  status: ConfigurationStatus;
  /** The fingerprinted material, exactly as approved. */
  material: RetrievalFingerprintMaterial;
  embeddingModelId: string;
  rerankerId: string;
  rerankerVersion: string;
  algorithmVersion: string;
  params: RetrievalParams;
  chunkerVersions: string[];
  tier: "pilot" | "standard" | null;
  evaluation: { runId: string; reportChecksum: string; gateSetChecksum: string; verdict: string; passed: boolean; evaluatedDocumentTypes: string[] } | null;
  /** The database's own verdict on P3: active, exactly one, approved run passed, not suspended, scope covered. */
  productionReady: boolean;
  notReady: NotReadyReason[];
}

export interface RetrievalContext {
  /** The database identity the call ran as (P6). */
  executedAs: { role: string; userId: string | null };
  activeModel: EmbeddingModelSpec | null;
  configuration: ConfigurationInService | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64 = /^[0-9a-f]{64}$/;
const NOT_READY: readonly NotReadyReason[] = ["suspended", "active_count", "evaluation", "gate_set", "development", "model", "scope"];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);
const isInteger = (value: unknown): value is number => Number.isInteger(value);

function parseModel(value: unknown): EmbeddingModelSpec | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const { id, provider, model_name, model_version, dimensions } = value;
  if (!isString(id) || !UUID.test(id) || !isString(provider) || !isString(model_name) || !isString(model_version) || !isInteger(dimensions)) return undefined;
  return { id, provider, model_name, model_version, dimensions };
}

function parseParams(value: unknown): RetrievalParams | undefined {
  if (!isRecord(value)) return undefined;
  const keys = ["candidateK", "rerankN", "topK", "maxPerVersion", "minScore", "rrfK"] as const;
  if (!keys.every((key) => typeof value[key] === "number" && Number.isFinite(value[key]))) return undefined;
  return Object.fromEntries(keys.map((key) => [key, value[key]])) as unknown as RetrievalParams;
}

function parseConfiguration(value: unknown): ConfigurationInService | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const v = value;
  const params = parseParams(v.params);
  const material = v.material;
  if (
    !isString(v.id) || !UUID.test(v.id) || !isString(v.label) || !isInteger(v.version) ||
    !isString(v.fingerprint) || !HEX64.test(v.fingerprint) ||
    (v.status !== "active" && v.status !== "suspended") ||
    !isRecord(material) || !isString(v.embeddingModelId) || !UUID.test(v.embeddingModelId) ||
    !isString(v.rerankerId) || !isString(v.rerankerVersion) || !isString(v.algorithmVersion) || !params ||
    !isStringArray(v.chunkerVersions) || (v.tier !== null && v.tier !== "pilot" && v.tier !== "standard") ||
    typeof v.productionReady !== "boolean" || !isStringArray(v.notReady) || !v.notReady.every((reason) => (NOT_READY as readonly string[]).includes(reason))
  ) {
    return undefined;
  }
  const evaluation = v.evaluation;
  let parsedEvaluation: ConfigurationInService["evaluation"] = null;
  if (evaluation !== null) {
    if (!isRecord(evaluation) || !isString(evaluation.runId) || !isString(evaluation.reportChecksum) || !isString(evaluation.gateSetChecksum) ||
        !isString(evaluation.verdict) || typeof evaluation.passed !== "boolean" || !isStringArray(evaluation.evaluatedDocumentTypes)) {
      return undefined;
    }
    parsedEvaluation = {
      runId: evaluation.runId,
      reportChecksum: evaluation.reportChecksum,
      gateSetChecksum: evaluation.gateSetChecksum,
      verdict: evaluation.verdict,
      passed: evaluation.passed,
      evaluatedDocumentTypes: [...evaluation.evaluatedDocumentTypes],
    };
  }
  let fingerprint: string;
  try {
    fingerprint = retrievalFingerprint(material as unknown as RetrievalFingerprintMaterial);
  } catch {
    return undefined;
  }
  // The stored fingerprint must be the fingerprint of the stored material (checked again here).
  if (fingerprint !== v.fingerprint) return undefined;
  return {
    id: v.id,
    label: v.label,
    version: v.version,
    fingerprint: v.fingerprint,
    status: v.status,
    material: structuredClone(material) as unknown as RetrievalFingerprintMaterial,
    embeddingModelId: v.embeddingModelId,
    rerankerId: v.rerankerId,
    rerankerVersion: v.rerankerVersion,
    algorithmVersion: v.algorithmVersion,
    params,
    chunkerVersions: [...v.chunkerVersions],
    tier: v.tier as ConfigurationInService["tier"],
    evaluation: parsedEvaluation,
    productionReady: v.productionReady,
    notReady: [...v.notReady] as NotReadyReason[],
  };
}

/** Parses knowledge.retrieval_context(). Null when the answer cannot be trusted as a whole. */
export function parseRetrievalContext(data: unknown): RetrievalContext | null {
  if (!isRecord(data) || !isRecord(data.executedAs)) return null;
  const { role, userId } = data.executedAs;
  if (!isString(role) || (userId !== null && !(isString(userId) && UUID.test(userId)))) return null;
  const activeModel = parseModel(data.activeModel);
  const configuration = parseConfiguration(data.configuration);
  if (activeModel === undefined || configuration === undefined) return null;
  return { executedAs: { role, userId }, activeModel, configuration };
}
