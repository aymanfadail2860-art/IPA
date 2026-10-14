import { CONTRACTS, type Paragraph, type Segment } from "../../core/contracts";
import { COPILOT_MARKERS, FICTIONAL_EXAMPLE_MARKER } from "../../core/instructions";
import type { NativeCitation } from "../../core/types";

import type { ApiContentBlock, ApiMessage } from "./api-types";
import type { SentDocument } from "./request";

type TextBlock = ApiContentBlock & { type: "text"; text: string };

/**
 * Converts a Messages API response to the output contract — deterministically, without a second
 * model (beta L4, docs/beta.md §16.16). Native citations and strict JSON output cannot be combined
 * in one call, so the model answers in plain text with native citations, and this module:
 *
 *   * keeps every native citation (NativeCitation) and maps it to the evidence that was sent:
 *     (document index, block range) → the evidence ids of exactly those content blocks;
 *   * builds the contract's paragraphs from the text blocks — a citation becomes a `cite`
 *     segment right after the text it supports;
 *   * marks a citation that does not point into a sent document (wrong type, index or range) as an
 *     unknown citation, so the contract check (contracts.ts) refuses the answer — it is never
 *     shown, and never silently dropped.
 *
 * The contract check itself is unchanged: an uncited paragraph, a missing historical marker or an
 * unflagged conflict makes the answer "unverifiable" exactly as for any other model.
 * This conversion is provisional; the final answer contract is L5's.
 */

/** A cite id no evidence can have: the contract check reports it as an unknown citation. */
const UNKNOWN_CITATION = "ukendt-kilde";

export interface Converted {
  raw: unknown;
  citations: NativeCitation[];
}

function mapCitation(citation: unknown, documents: readonly SentDocument[]): NativeCitation | null {
  const c = citation as { type?: unknown; document_index?: unknown; start_block_index?: unknown; end_block_index?: unknown; cited_text?: unknown };
  if (c?.type !== "content_block_location") return null;
  const doc = typeof c.document_index === "number" && Number.isInteger(c.document_index) ? documents[c.document_index] : undefined;
  const start = c.start_block_index;
  const end = c.end_block_index;
  if (!doc || typeof start !== "number" || typeof end !== "number" || !Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start < 0 || end <= start || end > doc.evidenceIds.length) return null;
  return {
    documentIndex: c.document_index as number,
    startBlockIndex: start,
    endBlockIndex: end,
    documentVersionId: doc.documentVersionId,
    evidenceIds: doc.evidenceIds.slice(start, end),
    citedText: typeof c.cited_text === "string" ? c.cited_text : "",
  };
}

/** Text blocks → paragraphs of segments. A blank line starts a new paragraph. */
function paragraphsOf(blocks: readonly TextBlock[], documents: readonly SentDocument[], citations: NativeCitation[]): Paragraph[] {
  const paragraphs: Paragraph[] = [[]];
  for (const block of blocks) {
    const pieces = block.text.split(/\n[ \t]*\n/);
    pieces.forEach((piece, i) => {
      if (i > 0) paragraphs.push([]);
      if (piece.trim().length > 0) paragraphs[paragraphs.length - 1]!.push({ text: piece });
    });
    const current = paragraphs[paragraphs.length - 1]!;
    for (const citation of block.citations ?? []) {
      const mapped = mapCitation(citation, documents);
      if (!mapped) {
        current.push({ cite: UNKNOWN_CITATION });
        continue;
      }
      citations.push(mapped);
      for (const id of mapped.evidenceIds) {
        const last = current[current.length - 1];
        if (!(last && "cite" in last && last.cite === id)) current.push({ cite: id });
      }
    }
  }
  return paragraphs.filter((paragraph) => paragraph.length > 0);
}

const textOf = (paragraph: Paragraph) =>
  paragraph
    .filter((segment): segment is Extract<Segment, { text: string }> => "text" in segment)
    .map((segment) => segment.text)
    .join("")
    .trim();

/** The Copilot marker line: the first line of the answer. */
function copilotHead(paragraphs: Paragraph[]): { kind: string | null; historical: boolean; rest: Paragraph[] } {
  const first = paragraphs[0];
  const firstText = first && "text" in first[0]! ? first[0].text : "";
  const newline = firstText.indexOf("\n");
  const line = (newline === -1 ? firstText : firstText.slice(0, newline)).trim();
  const tokens = line.split(/\s+/).filter(Boolean);
  const kinds = { [COPILOT_MARKERS.answer]: "answer", [COPILOT_MARKERS.conflict]: "conflict", [COPILOT_MARKERS.insufficient]: "insufficient" } as Record<string, string>;
  const kind = tokens.length > 0 && Object.hasOwn(kinds, tokens[0]!) ? kinds[tokens[0]!]! : null;
  const extra = tokens.slice(1);
  if (kind === null || extra.some((token) => token !== COPILOT_MARKERS.historical)) return { kind: null, historical: false, rest: paragraphs };
  const remainder = newline === -1 ? "" : firstText.slice(newline + 1);
  const head = [...(remainder.trim() ? [{ text: remainder }] : []), ...first!.slice(1)];
  return { kind, historical: extra.length > 0, rest: [...(head.length > 0 ? [head] : []), ...paragraphs.slice(1)] };
}

export function convertMessage(message: Pick<ApiMessage, "content">, documents: readonly SentDocument[], contract: string): Converted {
  const blocks = message.content.filter((block): block is TextBlock => block.type === "text" && typeof block.text === "string");
  // Anything but text and the model's own reasoning (tools, server tools) is not an answer.
  const unexpected = message.content.some((block) => block.type !== "text" && block.type !== "thinking" && block.type !== "redacted_thinking");
  const citations: NativeCitation[] = [];
  const paragraphs = paragraphsOf(blocks, documents, citations);
  if (unexpected || blocks.length === 0) return { raw: { unexpected: true }, citations };

  switch (contract) {
    case CONTRACTS.copilotAnswer: {
      const head = copilotHead(paragraphs);
      if (head.kind === null) return { raw: { kind: "unmarked", historical: false, paragraphs: head.rest }, citations };
      return { raw: { kind: head.kind, historical: head.historical, paragraphs: head.kind === "insufficient" ? [] : head.rest }, citations };
    }
    case CONTRACTS.learnExplain: {
      const examples = paragraphs.filter((paragraph) => textOf(paragraph).startsWith(FICTIONAL_EXAMPLE_MARKER));
      return {
        raw: {
          paragraphs: paragraphs.filter((paragraph) => !examples.includes(paragraph)),
          examples: examples.map((paragraph) => ({ text: textOf(paragraph).slice(FICTIONAL_EXAMPLE_MARKER.length).trim(), fictional: true })),
        },
        citations,
      };
    }
    case CONTRACTS.practiceTurn: {
      const reply = blocks.map((block) => block.text).join("").trim();
      // A roleplay line carries no citations: one is kept, so the contract refuses it.
      return { raw: citations.length > 0 || paragraphs.some((p) => p.some((s) => "cite" in s)) ? { reply, cite: true } : { reply }, citations };
    }
    case CONTRACTS.practiceFeedback:
      return { raw: { points: paragraphs }, citations };
    default:
      return { raw: { unsupported: contract }, citations };
  }
}
