/**
 * Redaction (docs/08 §7). Rule-based and deterministic. Identifiers in free text are replaced by
 * typed placeholders before anything leaves the platform — and before retrieval, so the search
 * runs on the professional question and not on the customer's identity (docs/03 §9, Advise).
 *
 * What is NOT found (residual risk, §7.2): names and addresses in free text that are not known
 * from context, and policy numbers (format unknown, [AFKLARES] Q-8). That is why
 * customer_identifiable is "deny" by default.
 *
 * The placeholder→value mapping lives only in memory for one call. It is never logged.
 */

export type RedactionType = "cpr" | "cvr" | "email" | "telefon" | "konto" | "virksomhed" | "person";

const PLACEHOLDER: Record<RedactionType, string> = {
  cpr: "CPR",
  cvr: "CVR",
  email: "EMAIL",
  telefon: "TELEFON",
  konto: "KONTO",
  virksomhed: "VIRKSOMHED",
  person: "PERSON",
};

export interface KnownName {
  type: "virksomhed" | "person";
  value: string;
}

export interface Redaction {
  text: string;
  /** Number of replaced occurrences per type — the only thing that is logged. */
  counts: Partial<Record<RedactionType, number>>;
  /** placeholder → original value. In memory only. */
  mapping: ReadonlyMap<string, string>;
}

interface Span {
  start: number;
  end: number;
  type: RedactionType;
}

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function validCprDate(day: number, month: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= DAYS_IN_MONTH[month - 1]!;
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Detectors in priority order. Each returns spans of the identifier itself. */
function detect(text: string, knownNames: readonly KnownName[]): Span[] {
  const spans: Span[] = [];
  const add = (start: number, end: number, type: RedactionType) => spans.push({ start, end, type });

  // E-mail.
  for (const m of text.matchAll(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu)) add(m.index!, m.index! + m[0].length, "email");

  // DK-IBAN and reg.nr. + kontonummer (4 + 6–10 cifre).
  for (const m of text.matchAll(/\bDK\d{2}(?: ?\d{4}){3} ?\d{2}\b/g)) add(m.index!, m.index! + m[0].length, "konto");
  for (const m of text.matchAll(/(?<![\d-])\d{4}[ -]\d{6,10}(?![\d-])/g)) add(m.index!, m.index! + m[0].length, "konto");

  // CPR: ddmmåå-xxxx / ddmmååxxxx with a valid day and month.
  for (const m of text.matchAll(/(?<![\d-])(\d{2})(\d{2})(\d{2})-?(\d{4})(?![\d-])/g)) {
    if (validCprDate(Number(m[1]), Number(m[2]))) add(m.index!, m.index! + m[0].length, "cpr");
  }

  // CVR: 8 digits ONLY with "CVR" nearby, so amounts and section numbers are never hit.
  for (const m of text.matchAll(/\bcvr(?:[- ]?(?:nr|nummer))?\.?\s*:?\s*(\d{2} ?\d{2} ?\d{2} ?\d{2})(?!\d)/giu)) {
    const start = m.index! + m[0].length - m[1]!.length;
    add(start, m.index! + m[0].length, "cvr");
  }

  // Telephone: +45 prefix, grouped 2-2-2-2, or with a "tlf/telefon/mobil" context word.
  for (const m of text.matchAll(/\+45[ -]?\d{2}[ -]?\d{2}[ -]?\d{2}[ -]?\d{2}(?!\d)/g)) add(m.index!, m.index! + m[0].length, "telefon");
  for (const m of text.matchAll(/(?<![\d,.-])\d{2} \d{2} \d{2} \d{2}(?![\d,.])/g)) add(m.index!, m.index! + m[0].length, "telefon");
  for (const m of text.matchAll(/\b(?:tlf|telefon|mobil|telefonnummer)\.?(?:nr\.?)?\s*:?\s*(\d{8})(?!\d)/giu)) {
    const start = m.index! + m[0].length - m[1]!.length;
    add(start, m.index! + m[0].length, "telefon");
  }

  // Known names from context the gateway fetched itself (case company, the user's own name).
  for (const name of knownNames) {
    const value = name.value.trim();
    if (value.length < 2) continue;
    for (const m of text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${escape(value)}(?![\\p{L}\\p{N}])`, "giu"))) {
      add(m.index!, m.index! + m[0].length, name.type);
    }
  }
  return spans;
}

/** Keeps the earliest, then longest span; drops overlaps. */
function resolve(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Span[] = [];
  for (const span of sorted) {
    const last = kept.at(-1);
    if (last && span.start < last.end) continue;
    kept.push(span);
  }
  return kept;
}

/**
 * Replaces identifiers. The same value gets the same placeholder within one call (`state`
 * is shared between the texts of one call).
 */
export function createRedactor(knownNames: readonly KnownName[] = []) {
  const byValue = new Map<string, string>();
  const mapping = new Map<string, string>();
  const counters: Partial<Record<RedactionType, number>> = {};
  const counts: Partial<Record<RedactionType, number>> = {};

  function placeholder(type: RedactionType, value: string): string {
    const key = `${type}:${value.toLocaleLowerCase("da")}`;
    const existing = byValue.get(key);
    if (existing) return existing;
    counters[type] = (counters[type] ?? 0) + 1;
    const created = `[${PLACEHOLDER[type]}-${counters[type]}]`;
    byValue.set(key, created);
    mapping.set(created, value);
    return created;
  }

  return {
    redact(text: string): string {
      let out = "";
      let cursor = 0;
      for (const span of resolve(detect(text, knownNames))) {
        out += text.slice(cursor, span.start) + placeholder(span.type, text.slice(span.start, span.end));
        counts[span.type] = (counts[span.type] ?? 0) + 1;
        cursor = span.end;
      }
      return out + text.slice(cursor);
    },
    result(text: string): Redaction {
      return { text, counts: { ...counts }, mapping };
    },
    get counts() {
      return { ...counts };
    },
    get mapping(): ReadonlyMap<string, string> {
      return mapping;
    },
  };
}

/** Puts the original values back — only in the answer to the user, never in a log. */
export function reidentify(text: string, mapping: ReadonlyMap<string, string>): string {
  if (mapping.size === 0) return text;
  return text.replace(/\[(?:CPR|CVR|EMAIL|TELEFON|KONTO|VIRKSOMHED|PERSON)-\d+\]/g, (placeholder) => mapping.get(placeholder) ?? placeholder);
}
