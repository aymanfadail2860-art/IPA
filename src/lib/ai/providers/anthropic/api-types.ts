/**
 * The parts of the Messages API this adapter uses (beta L4). Declared here, structurally
 * compatible with the official SDK's types, so that only transport.ts imports the SDK — the egress
 * architecture test allows exactly one module to reach Anthropic.
 */

export interface ApiCacheControl {
  type: "ephemeral";
}

export interface ApiTextBlockParam {
  type: "text";
  text: string;
  cache_control?: ApiCacheControl;
}

/** A custom-content document: each content block is one citable unit (no further chunking). */
export interface ApiDocumentBlockParam {
  type: "document";
  source: { type: "content"; content: ApiTextBlockParam[] };
  title?: string;
  /** Passed to the model, never citable. */
  context?: string;
  citations: { enabled: boolean };
  cache_control?: ApiCacheControl;
}

export interface ApiMessageRequest {
  model: string;
  max_tokens: number;
  system: ApiTextBlockParam[];
  messages: { role: "user"; content: (ApiDocumentBlockParam | ApiTextBlockParam)[] }[];
  output_config?: { effort: "low" | "medium" | "high" };
}

export interface ApiCitation {
  type: string;
  document_index?: number;
  start_block_index?: number;
  end_block_index?: number;
  cited_text?: string;
}

export interface ApiContentBlock {
  type: string;
  text?: string;
  citations?: ApiCitation[] | null;
}

export interface ApiUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export interface ApiMessage {
  content: ApiContentBlock[];
  stop_reason: string | null;
  usage: ApiUsage;
}
