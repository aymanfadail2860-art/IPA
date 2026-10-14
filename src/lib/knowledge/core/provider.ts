import { createHash } from "node:crypto";

import type { Grade } from "./grade.ts";

/**
 * The provider contract for embedding and reranking (docs/08b §2–§3, 8B-I2).
 *
 * Every implementation declares itself in a descriptor: provider, model, version, grade, where
 * data is processed, capabilities, limits and the settings that change its results. The domain
 * layer reads descriptors; it never branches on a provider name. Provider and model are data.
 *
 * The descriptor is also the fingerprint material for a retrieval configuration (§10.1): it
 * holds what changes results and nothing that does not (timeouts, retries, credentials and
 * clients are runtime details and are never part of it).
 *
 * Shared by the Next.js server, the ingestion worker and the evaluation engine: relative
 * imports with .ts, no path aliases, no server-only import.
 */

// ---------------------------------------------------------------------------------------------
// Descriptors
// ---------------------------------------------------------------------------------------------

/** Where the text is processed. Embed v4 is EU-geographic — never "Frankfurt-only" (D-1). */
export type ProcessingProfile =
  | { kind: "in_process" }
  | { kind: "in_region"; region: string }
  | { kind: "geographic"; geography: "EU"; sourceRegion: string; inferenceProfile: string };

export type ProviderSettings = Readonly<Record<string, string | number | boolean>>;

interface DescriptorBase {
  /** E.g. "aws-bedrock". Data, never a domain constant. */
  readonly provider: string;
  /** The provider's model id, e.g. "cohere.embed-v4:0". */
  readonly model: string;
  /**
   * OUR stable version label for the model as configured. Providers do not always give an
   * immutable model version, so this label is pinned by us and changes whenever the
   * configuration of the model changes.
   */
  readonly modelVersion: string;
  readonly grade: Grade;
  readonly processing: ProcessingProfile;
  /** Every setting that changes results (fingerprint material). */
  readonly settings: ProviderSettings;
}

export type EmbeddingInputType = "document" | "query";

export interface EmbeddingProviderDescriptor extends DescriptorBase {
  readonly kind: "embedding";
  readonly dimensions: number;
  /** "asymmetric": documents and queries are embedded differently (the provider is told which). */
  readonly inputTypes: "symmetric" | "asymmetric";
  readonly limits: { readonly maxTextsPerRequest: number; readonly maxCharsPerText: number; readonly maxCharsPerRequest: number };
}

export interface RerankingProviderDescriptor extends DescriptorBase {
  readonly kind: "reranking";
  /** The id recorded in evidence (`retrieval.reranker.id`) and selected by configuration. */
  readonly id: string;
  /** The version recorded in evidence. */
  readonly version: string;
  readonly limits: { readonly maxDocumentsPerRequest: number; readonly maxCharsPerDocument: number; readonly maxQueryChars: number };
}

// ---------------------------------------------------------------------------------------------
// Errors — typed, so observability can tell them apart (docs/08b §14)
// ---------------------------------------------------------------------------------------------

export const PROVIDER_ERROR_KINDS = [
  "unavailable",
  "throttled",
  "timeout",
  "credentials",
  "access_denied",
  "model_not_found",
  "invalid_request",
  "input_too_large",
  "invalid_response",
  "dimension_mismatch",
  "configuration",
] as const;
export type ProviderErrorKind = (typeof PROVIDER_ERROR_KINDS)[number];

/** Only these can be helped by trying again. Everything else fails at once. */
export const RETRYABLE_ERROR_KINDS: readonly ProviderErrorKind[] = ["unavailable", "throttled", "timeout"];

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly provider: string;
  readonly retryable: boolean;
  /** For input errors: the index of the offending text or document, so it can be isolated. */
  readonly inputIndex: number | null;
  readonly attempts: number;
  /** The provider's HTTP status, when it answered with one (8B-I8 C3). Never its message. */
  readonly httpStatus: number | null;
  constructor(kind: ProviderErrorKind, provider: string, message: string, options: { inputIndex?: number; attempts?: number; httpStatus?: number; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ProviderError";
    this.kind = kind;
    this.provider = provider;
    this.retryable = RETRYABLE_ERROR_KINDS.includes(kind);
    this.inputIndex = options.inputIndex ?? null;
    this.attempts = options.attempts ?? 1;
    this.httpStatus = options.httpStatus ?? null;
  }
}

/**
 * The provider error fields of an operational log line (docs/08b §14, 8B-I8 C3): the kind,
 * whether it was throttling (429) or a timeout, and the HTTP status — enough to compute the
 * provider error, throttling and timeout rates. Never the provider's message, a query or a text.
 */
export interface ProviderErrorFields {
  provider_error_kind: ProviderErrorKind | null;
  throttled: boolean;
  timeout: boolean;
  retryable: boolean | null;
  http_status: number | null;
  error_class: string;
}

export function providerErrorFields(error: unknown): ProviderErrorFields {
  if (error instanceof ProviderError) {
    return {
      provider_error_kind: error.kind,
      throttled: error.kind === "throttled" || error.httpStatus === 429,
      timeout: error.kind === "timeout",
      retryable: error.retryable,
      http_status: error.httpStatus,
      error_class: error.name,
    };
  }
  const name = typeof (error as { name?: unknown })?.name === "string" ? (error as { name: string }).name : "Error";
  return { provider_error_kind: null, throttled: false, timeout: false, retryable: null, http_status: null, error_class: name };
}

// ---------------------------------------------------------------------------------------------
// Timeouts and retries — provider-agnostic
// ---------------------------------------------------------------------------------------------

export interface RetryPolicy {
  /** Total attempts, including the first. */
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  /** Per attempt. The provider call is aborted when it is exceeded. */
  readonly attemptTimeoutMs: number;
}

export interface RetryDeps {
  sleep?: (ms: number) => Promise<void>;
  /** [0, 1). Injected in tests. */
  random?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Full jitter: a random delay in [0, min(max, base · 2^attempt)). */
export function backoffDelay(policy: RetryPolicy, attempt: number, random: () => number = Math.random): number {
  return Math.floor(random() * Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attempt));
}

/**
 * Runs one provider operation with a timeout per attempt and exponential backoff with jitter.
 * Only retryable ProviderErrors are retried; anything else is rethrown at once. A thrown value
 * that is not a ProviderError is a bug in the adapter and is classified as "invalid_response".
 */
export async function withRetry<T>(provider: string, policy: RetryPolicy, operation: (signal: AbortSignal) => Promise<T>, deps: RetryDeps = {}): Promise<T> {
  const sleep = deps.sleep ?? defaultSleep;
  for (let attempt = 1; ; attempt += 1) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ProviderError("timeout", provider, `Udbyderen svarede ikke inden for ${policy.attemptTimeoutMs} ms.`));
      }, policy.attemptTimeoutMs);
    });
    try {
      return await Promise.race([operation(controller.signal), timeout]);
    } catch (error) {
      const classified =
        error instanceof ProviderError ? error : new ProviderError("invalid_response", provider, "Uventet fejl i provider-adapteren.", { cause: error });
      if (!classified.retryable || attempt >= policy.maxAttempts) {
        throw new ProviderError(classified.kind, provider, classified.message, {
          inputIndex: classified.inputIndex ?? undefined,
          attempts: attempt,
          httpStatus: classified.httpStatus ?? undefined,
          cause: classified.cause ?? classified,
        });
      }
      await sleep(backoffDelay(policy, attempt, deps.random));
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Fingerprint material (docs/08b §10.1). The final P1–P9 logic is NOT here (later step).
// ---------------------------------------------------------------------------------------------

/** Canonical JSON: sorted keys, no undefined, finite numbers only. */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Ikke-endelige tal kan ikke indgå i en checksum.");
    return JSON.stringify(value);
  }
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => (entry === undefined ? "null" : canonicalJson(entry))).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  throw new Error(`Værdien kan ikke indgå i en checksum: ${typeof value}.`);
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export interface EmbeddingMaterial {
  provider: string;
  model: string;
  modelVersion: string;
  dimensions: number;
  processing: ProcessingProfile;
  settings: Record<string, string | number | boolean>;
}

export interface RerankerMaterial {
  provider: string;
  model: string;
  modelVersion: string;
  id: string;
  version: string;
  processing: ProcessingProfile;
  settings: Record<string, string | number | boolean>;
}

export interface RetrievalParams {
  candidateK: number;
  rerankN: number;
  topK: number;
  maxPerVersion: number;
  minScore: number;
  rrfK: number;
}

/**
 * The retrieval methods (B-035). "hybrid" is 8B's ranking search (vector ∥ lexical, RRF,
 * reranker). "product_documents" has no embedding and no reranker: the authorized, published and
 * valid document versions of ONE product, in full and in document order, within a budget.
 */
export type RetrievalMethod = "hybrid" | "product_documents";
export const PRODUCT_DOCUMENTS = "product_documents" as const;

/** The parameters of product_documents: the most characters one call may carry. Over it, the call is refused. */
export interface DocumentRetrievalParams {
  maxChars: number;
}

/** What defines a hybrid retrieval configuration (8B-I6). Everything that changes results; nothing else. */
export interface HybridRetrievalMaterial {
  embedding: EmbeddingMaterial | null;
  reranker: RerankerMaterial;
  algorithmVersion: string;
  params: RetrievalParams;
  chunkerVersions: string[];
}

/** What defines a product_documents configuration (B-035). No embedding, no reranker — by definition. */
export interface DocumentRetrievalMaterial {
  method: typeof PRODUCT_DOCUMENTS;
  embedding: null;
  reranker: null;
  algorithmVersion: string;
  params: DocumentRetrievalParams;
  chunkerVersions: string[];
}

/** The fingerprinted material. Hybrid material has no "method" field, so 8B fingerprints are unchanged. */
export type RetrievalFingerprintMaterial = HybridRetrievalMaterial | DocumentRetrievalMaterial;

/** The method a material describes (the database's knowledge.retrieval_material_method). */
export function retrievalMethodOf(material: RetrievalFingerprintMaterial): RetrievalMethod {
  return "method" in material && material.method === PRODUCT_DOCUMENTS ? PRODUCT_DOCUMENTS : "hybrid";
}

export function isDocumentMaterial(material: RetrievalFingerprintMaterial): material is DocumentRetrievalMaterial {
  return retrievalMethodOf(material) === PRODUCT_DOCUMENTS;
}

/**
 * The database's rule for product_documents material (knowledge.document_retrieval_material_problem),
 * mirrored for the publisher's own check. Null = valid.
 */
export function documentMaterialProblem(material: unknown): string | null {
  if (typeof material !== "object" || material === null || Array.isArray(material)) return "materialet har ikke de definerende felter";
  const m = material as Record<string, unknown>;
  const keys = Object.keys(m).sort();
  if (keys.join(",") !== "algorithmVersion,chunkerVersions,embedding,method,params,reranker") return "materialet har ikke de definerende felter";
  if (m.method !== PRODUCT_DOCUMENTS) return "ukendt retrieval-metode";
  if (m.embedding !== null) return "metoden product_documents har ingen embedding-model";
  if (m.reranker !== null) return "metoden product_documents har ingen reranker";
  if (typeof m.algorithmVersion !== "string" || !/^product-documents-[0-9]{1,6}$/.test(m.algorithmVersion)) return "algoritmeversionen er ugyldig";
  const params = m.params as Record<string, unknown> | null;
  if (typeof params !== "object" || params === null || Object.keys(params).join(",") !== "maxChars") return "parametrene er ufuldstændige";
  if (!Number.isInteger(params.maxChars) || (params.maxChars as number) < 10_000 || (params.maxChars as number) > 2_000_000) return "parameteren maxChars er ugyldig";
  const versions = m.chunkerVersions;
  if (!Array.isArray(versions) || versions.length === 0 || !versions.every((v) => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:/@+-]{0,99}$/.test(v))) {
    return "chunker-versionerne er ugyldige";
  }
  return null;
}

/** The material of a product_documents configuration. */
export function documentRetrievalMaterial(input: {
  algorithmVersion: string;
  params: DocumentRetrievalParams;
  chunkerVersions: readonly string[];
}): DocumentRetrievalMaterial {
  return {
    method: PRODUCT_DOCUMENTS,
    embedding: null,
    reranker: null,
    algorithmVersion: input.algorithmVersion,
    params: { maxChars: input.params.maxChars },
    chunkerVersions: [...input.chunkerVersions],
  };
}

export function embeddingMaterial(descriptor: EmbeddingProviderDescriptor): EmbeddingMaterial {
  return {
    provider: descriptor.provider,
    model: descriptor.model,
    modelVersion: descriptor.modelVersion,
    dimensions: descriptor.dimensions,
    processing: { ...descriptor.processing },
    settings: { ...descriptor.settings },
  };
}

export function rerankerMaterial(descriptor: RerankingProviderDescriptor): RerankerMaterial {
  return {
    provider: descriptor.provider,
    model: descriptor.model,
    modelVersion: descriptor.modelVersion,
    id: descriptor.id,
    version: descriptor.version,
    processing: { ...descriptor.processing },
    settings: { ...descriptor.settings },
  };
}

export function retrievalFingerprintMaterial(input: {
  embedding: EmbeddingProviderDescriptor | null;
  reranker: RerankingProviderDescriptor;
  algorithmVersion: string;
  params: RetrievalParams;
  chunkerVersions: readonly string[];
}): HybridRetrievalMaterial {
  return {
    embedding: input.embedding ? embeddingMaterial(input.embedding) : null,
    reranker: rerankerMaterial(input.reranker),
    algorithmVersion: input.algorithmVersion,
    params: { ...input.params },
    chunkerVersions: [...input.chunkerVersions],
  };
}

/** The fingerprint. Chunker versions are a set: their order never matters. */
export function retrievalFingerprint(material: RetrievalFingerprintMaterial): string {
  return sha256(canonicalJson({ ...material, chunkerVersions: [...new Set(material.chunkerVersions)].sort() }));
}

/** The label an embedder records in evidence: provider:model@version (as modelLabel). */
export function embeddingLabel(material: Pick<EmbeddingMaterial, "provider" | "model" | "modelVersion">): string {
  return `${material.provider}:${material.model}@${material.modelVersion}`;
}
