import type { ClassifiedText } from "../../../egress/classification.ts";
import { authorizeEgress, type EgressLog } from "../../../egress/policy.ts";
import { modelLabel, type EmbedOptions, type EmbeddingProvider } from "../../core/embedding.ts";
import { ProviderError, withRetry, type EmbeddingProviderDescriptor, type RetryDeps, type RetryPolicy } from "../../core/provider.ts";

import { BEDROCK_PROVIDER, type BedrockTransport } from "./transport.ts";

/**
 * Cohere Embed v4 on AWS Bedrock (docs/08b §2.3, D-1, D-2), grade "production".
 *
 * Processing is EU-GEOGRAPHIC: the call goes to the source region eu-central-1 through the EU
 * cross-region inference profile, and Bedrock may route it to another EU region. It is never
 * "Frankfurt-only".
 *
 * What is sent (data boundary, docs/08b §2.3, §8):
 *   document → the embedding input of a chunk: heading chain, repeated lead-in and the chunk's
 *              own text (core/embedding.ts embeddingInput) — nothing else
 *   query    → the normalized retrieval query — nothing else
 * plus fixed settings. No ids, titles, user, case or tenant data are ever part of the request.
 *
 * External-AI boundary (8B-I2.5): ALL texts are authorized by the central egress policy before
 * the first call — documents as "embed_document", queries as "embed_query". Customer-case text,
 * unknown or missing provenance and unredacted user text deny the whole request: no call is
 * made. EU processing does not change that.
 */

/** Bedrock model and inference profile. Provider facts from 2026-10-02/03, to be re-verified (Å-1). */
export const COHERE_EMBED_V4_MODEL = "cohere.embed-v4:0";
export const COHERE_EMBED_V4_EU_PROFILE = "eu.cohere.embed-v4:0";
export const EU_SOURCE_REGION = "eu-central-1";
/** Output dimensions the model offers. Only 1024 is configured (D-1). */
export const COHERE_EMBED_V4_DIMENSIONS = [256, 512, 1024, 1536] as const;

const INPUT_TYPES = { document: "search_document", query: "search_query" } as const;

/**
 * The configured model, pinned under our own version label: provider, model, EU profile,
 * 1024 float dimensions and the input-type mapping. Any change to these gets a new label.
 */
export const EMBED_V4_EU_1024_DESCRIPTOR: EmbeddingProviderDescriptor = Object.freeze({
  kind: "embedding" as const,
  provider: BEDROCK_PROVIDER,
  model: COHERE_EMBED_V4_MODEL,
  modelVersion: "eu-1024-v1",
  grade: "production" as const,
  dimensions: 1024,
  processing: Object.freeze({ kind: "geographic" as const, geography: "EU" as const, sourceRegion: EU_SOURCE_REGION, inferenceProfile: COHERE_EMBED_V4_EU_PROFILE }),
  inputTypes: "asymmetric" as const,
  settings: Object.freeze({
    embeddingType: "float",
    outputDimension: 1024,
    truncate: "NONE",
    inputTypeDocument: INPUT_TYPES.document,
    inputTypeQuery: INPUT_TYPES.query,
  }),
  // Conservative limits of OUR adapter, below the provider's (96 texts per call; context far
  // above our ~800-token chunks). truncate NONE: an over-long text is refused, never cut.
  limits: Object.freeze({ maxTextsPerRequest: 96, maxCharsPerText: 8_000, maxCharsPerRequest: 400_000 }),
});

export const EMBED_RETRY_POLICY: RetryPolicy = Object.freeze({ maxAttempts: 3, baseDelayMs: 250, maxDelayMs: 4_000, attemptTimeoutMs: 15_000 });

export interface CohereEmbedV4Options {
  transport: BedrockTransport;
  descriptor?: EmbeddingProviderDescriptor;
  retry?: RetryPolicy;
  retryDeps?: RetryDeps;
  /** The log for egress denials (technical metadata only). Tests inject it. */
  egressLog?: EgressLog;
}

/** The exact request body for one batch. Exported so the data boundary can be tested. */
export function embedRequestBody(texts: readonly string[], inputType: EmbedOptions["inputType"], descriptor: EmbeddingProviderDescriptor = EMBED_V4_EU_1024_DESCRIPTOR): Record<string, unknown> {
  return {
    texts: [...texts],
    input_type: INPUT_TYPES[inputType],
    embedding_types: ["float"],
    output_dimension: descriptor.dimensions,
    truncate: "NONE",
  };
}

/** Splits into batches within the per-request limits, keeping order. */
export function batchTexts(texts: readonly string[], limits: EmbeddingProviderDescriptor["limits"]): { start: number; texts: string[] }[] {
  const batches: { start: number; texts: string[] }[] = [];
  let current: { start: number; texts: string[] } | null = null;
  let chars = 0;
  texts.forEach((text, i) => {
    if (!current || current.texts.length >= limits.maxTextsPerRequest || chars + text.length > limits.maxCharsPerRequest) {
      current = { start: i, texts: [] };
      batches.push(current);
      chars = 0;
    }
    current.texts.push(text);
    chars += text.length;
  });
  return batches;
}

function parseVectors(response: unknown, expected: number, dimensions: number): number[][] {
  const fail = (message: string, kind: "invalid_response" | "dimension_mismatch" = "invalid_response") => {
    throw new ProviderError(kind, BEDROCK_PROVIDER, message);
  };
  if (typeof response !== "object" || response === null) fail("Embed-svaret er ikke et objekt.");
  const embeddings = (response as { embeddings?: unknown }).embeddings;
  if (typeof embeddings !== "object" || embeddings === null || Array.isArray(embeddings)) fail("Embed-svaret har ingen embeddings pr. type.");
  const floats = (embeddings as { float?: unknown }).float;
  if (!Array.isArray(floats)) fail('Embed-svaret har ingen "float"-embeddings.');
  const vectors = floats as unknown[];
  if (vectors.length !== expected) fail(`Embed-svaret har ${vectors.length} vektorer, forventet ${expected}.`);
  return vectors.map((vector) => {
    if (!Array.isArray(vector)) fail("En embedding er ikke en liste.");
    const values = vector as unknown[];
    if (values.length !== dimensions) fail(`En embedding har ${values.length} dimensioner, forventet ${dimensions}.`, "dimension_mismatch");
    if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) fail("En embedding indeholder andet end endelige tal.");
    if (values.every((value) => value === 0)) fail("En embedding er nulvektoren.");
    return values as number[];
  });
}

export function createCohereEmbedV4(options: CohereEmbedV4Options): EmbeddingProvider {
  const descriptor = options.descriptor ?? EMBED_V4_EU_1024_DESCRIPTOR;
  const processing = descriptor.processing;
  if (
    descriptor.provider !== BEDROCK_PROVIDER ||
    descriptor.model !== COHERE_EMBED_V4_MODEL ||
    !(COHERE_EMBED_V4_DIMENSIONS as readonly number[]).includes(descriptor.dimensions) ||
    processing.kind !== "geographic" ||
    processing.inferenceProfile !== COHERE_EMBED_V4_EU_PROFILE ||
    processing.sourceRegion !== options.transport.region
  ) {
    throw new ProviderError("configuration", BEDROCK_PROVIDER, `Konfigurationen af ${descriptor.model} (${descriptor.dimensions} dimensioner, profil ${"inferenceProfile" in processing ? processing.inferenceProfile : processing.kind}, region ${options.transport.region}) understøttes ikke.`);
  }
  const retry = options.retry ?? EMBED_RETRY_POLICY;
  const id = modelLabel({ provider: descriptor.provider, model_name: descriptor.model, model_version: descriptor.modelVersion });

  return Object.freeze({
    id,
    grade: descriptor.grade,
    dimensions: descriptor.dimensions,
    descriptor,
    async embed(classifiedTexts: readonly ClassifiedText[], embedOptions: EmbedOptions): Promise<number[][]> {
      const inputType = embedOptions?.inputType;
      if (inputType !== "document" && inputType !== "query") {
        throw new ProviderError("configuration", BEDROCK_PROVIDER, "Input-typen (document eller query) skal angives.");
      }
      if (classifiedTexts.length === 0) return [];
      // The external-AI boundary first: every text, or none (throws EgressPolicyError).
      const egress = authorizeEgress(
        {
          provider: BEDROCK_PROVIDER,
          operation: inputType === "document" ? "embed_document" : "embed_query",
          module: "bedrock.embed-v4",
          parts: classifiedTexts.map((content) => ({ role: inputType, content })),
        },
        { log: options.egressLog },
      );
      const texts = egress.texts;
      // Validate every text before any call: a defective text is reported by index and nothing
      // is sent, so a batch never ends half-embedded.
      texts.forEach((text, i) => {
        if (typeof text !== "string" || text.trim().length === 0) throw new ProviderError("invalid_request", BEDROCK_PROVIDER, `Tekst ${i} er tom.`, { inputIndex: i });
        if (text.length > descriptor.limits.maxCharsPerText) {
          throw new ProviderError("input_too_large", BEDROCK_PROVIDER, `Tekst ${i} er ${text.length} tegn (højst ${descriptor.limits.maxCharsPerText}).`, { inputIndex: i });
        }
      });
      const vectors: number[][] = [];
      for (const batch of batchTexts(texts, descriptor.limits)) {
        const body = embedRequestBody(batch.texts, inputType, descriptor);
        const result = await withRetry(
          BEDROCK_PROVIDER,
          retry,
          async (signal) => parseVectors(await options.transport.invoke({ modelId: COHERE_EMBED_V4_EU_PROFILE, egress, body, signal }), batch.texts.length, descriptor.dimensions),
          options.retryDeps,
        );
        vectors.push(...result);
      }
      return vectors;
    },
  });
}
