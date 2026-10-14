import { DOCUMENT_CONTEXT, EXTERNAL_FORMAT, type ExternalContract } from "../../core/instructions";
import type { ModelInput, SentPart } from "../../core/types";
import { ModelCallError } from "../../core/usage";

import type { ApiDocumentBlockParam, ApiMessageRequest, ApiTextBlockParam } from "./api-types";
import type { AnthropicEffort } from "./config";

/**
 * Builds the Messages API request for one gateway call (beta L4, docs/beta.md §16.6, §16.16).
 * Pure: every string in the body is either a text the gateway sent (and invoke.ts authorized) or
 * a reviewed constant — the transport checks exactly that before it sends (assertTransmittable).
 *
 *   * system   = the profile's system prompt + the external format instruction (both reviewed
 *                constants). Document text never goes here: it has no instruction authority.
 *   * user     = one custom-content document per document version, in the order the gateway sent
 *                the parts, each chunk one content block (citations enabled), then the user's
 *                context label and question as text blocks.
 *
 * Native citations of custom-content documents point at (document index, block range), and
 * `documents` maps both back to the evidence that was sent — nothing is cut or merged, so the
 * mapping is exact.
 */

export interface SentDocument {
  documentVersionId: string | null;
  /** Evidence id of each content block, by block index. */
  evidenceIds: string[];
}

export interface BuiltRequest {
  body: ApiMessageRequest;
  documents: SentDocument[];
}

export interface RequestOptions {
  modelId: string;
  maxOutputTokens: number;
  effort: AnthropicEffort | null;
  /** Mark the document prefix for prompt caching (cache-ready; not active in L4). */
  cache: boolean;
}

export function isExternalContract(contract: string): contract is ExternalContract {
  return Object.hasOwn(EXTERNAL_FORMAT, contract);
}

function documentContext(parts: readonly SentPart[]): string {
  const status = parts[0]!.evidence!.temporalStatus;
  const base = DOCUMENT_CONTEXT[status];
  return parts.some((part) => part.evidence!.inConflict) ? `${base} ${DOCUMENT_CONTEXT.conflict}` : base;
}

export function buildMessageRequest(input: ModelInput, options: RequestOptions): BuiltRequest {
  if (!isExternalContract(input.outputContract)) throw new ModelCallError("configuration", "contract_not_external");

  // Group the evidence parts by document version, keeping the order in which they were sent.
  const groups: { versionId: string | null; parts: SentPart[] }[] = [];
  for (const part of input.parts) {
    if (part.kind !== "evidence" || !part.evidence) continue;
    const versionId = part.evidence.documentVersionId ?? null;
    const group = versionId === null ? undefined : groups.find((entry) => entry.versionId === versionId);
    if (group) group.parts.push(part);
    else groups.push({ versionId, parts: [part] });
  }

  const documents: ApiDocumentBlockParam[] = groups.map((group) => {
    const title = group.parts.find((part) => part.sourceTitle)?.sourceTitle?.text;
    return {
      type: "document",
      source: { type: "content", content: group.parts.map((part): ApiTextBlockParam => ({ type: "text", text: part.text })) },
      ...(title ? { title } : {}),
      context: documentContext(group.parts),
      citations: { enabled: true },
    };
  });
  if (options.cache && documents.length > 0) documents[documents.length - 1] = { ...documents[documents.length - 1]!, cache_control: { type: "ephemeral" } };

  const texts: ApiTextBlockParam[] = [
    ...input.parts.filter((part) => part.kind === "context").map((part): ApiTextBlockParam => ({ type: "text", text: part.text })),
    ...input.parts.filter((part) => part.kind === "question").map((part): ApiTextBlockParam => ({ type: "text", text: part.text })),
  ];
  if (texts.length === 0) throw new ModelCallError("configuration", "no_question");

  const body: ApiMessageRequest = {
    model: options.modelId,
    max_tokens: options.maxOutputTokens,
    system: [
      { type: "text", text: input.system },
      { type: "text", text: EXTERNAL_FORMAT[input.outputContract] },
    ],
    messages: [{ role: "user", content: [...documents, ...texts] }],
    ...(options.effort ? { output_config: { effort: options.effort } } : {}),
  };
  return {
    body,
    documents: groups.map((group) => ({ documentVersionId: group.versionId, evidenceIds: group.parts.map((part) => part.evidence!.evidenceId) })),
  };
}

/** The same request for the provider's token count (count_tokens takes no max_tokens). */
export function countTokensBody(body: ApiMessageRequest) {
  return {
    model: body.model,
    system: body.system,
    messages: body.messages,
    ...(body.output_config ? { output_config: body.output_config } : {}),
  };
}
