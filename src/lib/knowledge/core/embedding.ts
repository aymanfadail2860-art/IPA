import { createHash } from "node:crypto";

import type { ClassifiedText } from "../../egress/classification.ts";

import type { Grade } from "./grade.ts";
import type { EmbeddingInputType, EmbeddingProviderDescriptor } from "./provider.ts";

/**
 * Embedder interface (docs/07 §7). The provider is NOT locked: a concrete provider is chosen
 * before real documents are ingested, and plugs in behind this interface without changes to
 * the domain model. Every embedding carries the model it was made with.
 */

export interface EmbeddingModelSpec {
  id: string;
  provider: string;
  model_name: string;
  model_version: string;
  dimensions: number;
}

export interface EmbedOptions {
  /**
   * Whether the texts are document passages or a user's query (docs/07 §7, K-2). Part of the
   * contract: an asymmetric model embeds them differently; a symmetric one ignores it.
   */
  inputType: EmbeddingInputType;
}

export interface Embedder {
  /** provider:model@version — stored on every embedding (via the model id) and in evidence. */
  readonly id: string;
  readonly grade: Grade;
  readonly dimensions: number;
  /**
   * The texts WITH their provenance (8B-I2.5). An external provider authorizes them at the
   * egress boundary before sending; an in-process one only reads `.text`.
   */
  embed(texts: readonly ClassifiedText[], options: EmbedOptions): Promise<number[][]>;
}

/** An embedder that declares itself (8B-I2). Every real implementation is one. */
export interface EmbeddingProvider extends Embedder {
  readonly descriptor: EmbeddingProviderDescriptor;
}

export function modelLabel(model: Pick<EmbeddingModelSpec, "provider" | "model_name" | "model_version">): string {
  return `${model.provider}:${model.model_name}@${model.model_version}`;
}

export interface EmbeddableChunk {
  text: string;
  lead_in: string | null;
  heading_path: string[];
}

/**
 * The text that is embedded: heading chain, repeated lead-in and the chunk's own text
 * (docs/07 §6 — the heading chain is part of the embedding input, not of `text`).
 */
export function embeddingInput(chunk: EmbeddableChunk): string {
  return [chunk.heading_path.join(" › "), chunk.lead_in ?? "", chunk.text].filter((part) => part.length > 0).join("\n");
}

/** Idempotency key for an embedding: model + exact input. */
export function inputHash(embedderId: string, input: string): string {
  return createHash("sha256").update(`${embedderId}\n${input}`).digest("hex");
}
