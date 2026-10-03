/**
 * Classification and provenance of text that may leave the platform (8B-I2.5, D-13/K-9).
 *
 * The categories are 8A's data categories (docs/03 §9, docs/08 §5.1), extended with exactly two
 * egress-only values: "evaluation_synthetic" (synthetic evaluation and test material) and
 * "unknown". They are one model — `ai/core/types.ts` re-exports DATA_CATEGORIES from here.
 *
 * A ClassifiedText is text that carries its provenance inseparably. It can only be made by the
 * constructors below; each is frozen and recorded, so a hand-built object or a copy is never
 * accepted as classified (the egress policy refuses it). Which code may call which constructor
 * is fixed by guardrail tests: knowledge text only from the retrieval layer, the worker and the
 * gateway's evidence parts; user text only from the gateway and the Admin retrieval tool;
 * synthetic text only from the evaluation engine and tests.
 *
 * Shared by the Next.js server, the ingestion worker and the evaluation engine: relative
 * imports with .ts, no path aliases, no server-only import.
 */

/** The data categories of docs/03 §9 (docs/08 §5.1). The matrix (ai.data_category_policy) uses these. */
export const DATA_CATEGORIES = ["knowledge", "user_question", "learning", "training_fictional", "customer_identifiable", "audit_access"] as const;
export type DataCategory = (typeof DATA_CATEGORIES)[number];

/** The categories at the external-AI boundary: 8A's categories plus two egress-only values. */
export const EGRESS_CATEGORIES = [...DATA_CATEGORIES, "evaluation_synthetic", "unknown"] as const;
export type EgressCategory = (typeof EGRESS_CATEGORIES)[number];

/** Where the text comes from. "missing" means a caller supplied no provenance at all. */
export const EGRESS_SOURCES = ["knowledge_engine", "user_input", "customer_case", "evaluation_set", "unknown", "missing"] as const;
export type EgressSource = (typeof EGRESS_SOURCES)[number];

export interface Provenance {
  readonly category: EgressCategory;
  readonly source: EgressSource;
  /** The text belongs to a call with a customer case reference, or comes from a case. */
  readonly caseBound: boolean;
  /** The text has been through redaction without error. Never makes customer text allowed. */
  readonly redacted: boolean;
}

export interface ClassifiedText {
  readonly text: string;
  readonly provenance: Provenance;
}

const classified = new WeakSet<object>();

function make(text: string, provenance: Provenance): ClassifiedText {
  if (typeof text !== "string") throw new TypeError("Kun tekst kan klassificeres.");
  const value = Object.freeze({ text, provenance: Object.freeze({ ...provenance }) });
  classified.add(value);
  return value;
}

/** True only for a ClassifiedText made by a constructor here (not a copy, not a hand-built object). */
export function isClassified(value: unknown): value is ClassifiedText {
  return typeof value === "object" && value !== null && classified.has(value);
}

/** Knowledge Engine content: chunks, evidence excerpts, the heading chain of a passage. */
export function knowledgeText(text: string): ClassifiedText {
  return make(text, { category: "knowledge", source: "knowledge_engine", caseBound: false, redacted: false });
}

/**
 * A user's own free text. In a call with a customer case reference it IS customer data
 * (docs/08b §8.1): it is classified customer_identifiable, whatever redaction did.
 */
export function userText(text: string, options: { caseBound: boolean; redacted: boolean }): ClassifiedText {
  return options.caseBound
    ? make(text, { category: "customer_identifiable", source: "user_input", caseBound: true, redacted: options.redacted })
    : make(text, { category: "user_question", source: "user_input", caseBound: false, redacted: options.redacted });
}

/** Any field or text from a customer case. */
export function customerCaseText(text: string): ClassifiedText {
  return make(text, { category: "customer_identifiable", source: "customer_case", caseBound: true, redacted: false });
}

/** Text whose origin cannot be shown. Never leaves the platform. */
export function unknownText(text: string): ClassifiedText {
  return make(text, { category: "unknown", source: "unknown", caseBound: false, redacted: false });
}

/** A plain string that arrived without provenance (e.g. an old caller): marked as such. */
export function missingProvenance(text: string): ClassifiedText {
  return make(text, { category: "unknown", source: "missing", caseBound: false, redacted: false });
}

/**
 * The same provenance for a narrower text (e.g. trimmed). Only a part of the original text can
 * be derived — never new text, so provenance cannot be laundered onto other content.
 */
export function narrowed(source: ClassifiedText, text: string): ClassifiedText {
  if (!isClassified(source)) return missingProvenance(text);
  if (!source.text.includes(text)) throw new Error("En afledt tekst skal være en del af den oprindelige tekst.");
  return make(text, source.provenance);
}

/** Internal: the synthetic constructor lives in synthetic.ts so its importers can be restricted. */
export function makeSyntheticInternal(text: string): ClassifiedText {
  return make(text, { category: "evaluation_synthetic", source: "evaluation_set", caseBound: false, redacted: false });
}

/** The text of a value for IN-PROCESS use only (no egress): a ClassifiedText or a plain string. */
export function plainText(value: ClassifiedText | string): string {
  return typeof value === "string" ? value : value.text;
}
