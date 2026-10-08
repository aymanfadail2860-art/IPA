import { DOCUMENT_TYPES } from "../../src/lib/knowledge/document-types.ts";

import {
  CASE_MODES,
  CASE_OUTCOMES,
  CASE_SCHEMA_VERSION,
  CASE_SPLITS,
  CASE_TYPES,
  HARD_GATE_IDS,
  MANIFEST_SCHEMA_VERSION,
  QUALITY_GATE_IDS,
  type Comparator,
  type ConfigurationInput,
  type EvalCase,
  type EvalSet,
  type GateSet,
  type Manifest,
  type MetricId,
  type QualityGateId,
} from "./types.ts";

/**
 * Validation of the evaluation set and the gate set (docs/08b §4.4, §5.2–§5.6).
 *
 * The JSON Schemas in evals/retrieval/schema/ describe the same format for editors and
 * reviewers; this module is what the engine enforces (no schema library is needed for a
 * format this small — CLAUDE.md §2, minimal dependencies). A test keeps the two in sync.
 *
 * Validation is strict: unknown fields are errors, so a typo cannot silently drop a facit.
 */

export interface SchemaError {
  path: string;
  message: string;
}

export class EvalSetError extends Error {
  readonly errors: SchemaError[];
  constructor(errors: SchemaError[]) {
    super(`Evalueringssættet er ugyldigt:\n${errors.map((error) => `  ${error.path}: ${error.message}`).join("\n")}`);
    this.name = "EvalSetError";
    this.errors = errors;
  }
}

export class GateSetError extends Error {
  readonly errors: SchemaError[];
  constructor(errors: SchemaError[]) {
    super(`Gate-sættet er ugyldigt:\n${errors.map((error) => `  ${error.path}: ${error.message}`).join("\n")}`);
    this.name = "GateSetError";
    this.errors = errors;
  }
}

const KEY = /^[a-z0-9][a-z0-9_-]*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LANGUAGE = /^[a-z]{2}$/;
const SHA256 = /^[0-9a-f]{64}$/;
export const MAX_QUESTION_CHARS = 1000;
const DOCUMENT_TYPE_KEYS: readonly string[] = DOCUMENT_TYPES.map((type) => type.key);

export function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

class Checker {
  readonly errors: SchemaError[] = [];
  error(path: string, message: string): void {
    this.errors.push({ path, message });
  }
  object(value: unknown, path: string, required: readonly string[], optional: readonly string[]): value is Record<string, unknown> {
    if (!isObject(value)) {
      this.error(path, "skal være et objekt");
      return false;
    }
    for (const key of required) if (!(key in value)) this.error(`${path}.${key}`, "mangler");
    for (const key of Object.keys(value)) if (!required.includes(key) && !optional.includes(key)) this.error(`${path}.${key}`, "ukendt felt");
    return true;
  }
  string(value: unknown, path: string, options: { pattern?: RegExp; max?: number; min?: number } = {}): value is string {
    if (typeof value !== "string") {
      this.error(path, "skal være tekst");
      return false;
    }
    if (value.trim().length < (options.min ?? 1)) this.error(path, "må ikke være tom");
    if (options.max !== undefined && value.length > options.max) this.error(path, `må højst være ${options.max} tegn`);
    if (options.pattern && !options.pattern.test(value)) this.error(path, `har ugyldigt format (${options.pattern})`);
    return true;
  }
  oneOf<T>(value: unknown, path: string, allowed: readonly T[]): value is T {
    if (!allowed.includes(value as T)) {
      this.error(path, `skal være én af ${allowed.map((entry) => JSON.stringify(entry)).join(", ")}`);
      return false;
    }
    return true;
  }
  array(value: unknown, path: string, options: { min?: number } = {}): value is unknown[] {
    if (!Array.isArray(value)) {
      this.error(path, "skal være en liste");
      return false;
    }
    if (options.min !== undefined && value.length < options.min) this.error(path, `skal have mindst ${options.min} element(er)`);
    return true;
  }
  boolean(value: unknown, path: string): value is boolean {
    if (typeof value !== "boolean") {
      this.error(path, "skal være true eller false");
      return false;
    }
    return true;
  }
  date(value: unknown, path: string): void {
    if (!isDate(value)) this.error(path, "skal være en gyldig dato (ÅÅÅÅ-MM-DD)");
  }
  keys(value: unknown, path: string): value is string[] {
    if (!this.array(value, path, { min: 1 })) return false;
    value.forEach((entry, i) => this.string(entry, `${path}[${i}]`, { pattern: KEY }));
    return true;
  }
}

// ---------------------------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------------------------

/** A product id: a lowercase UUID, as knowledge.products.id. */
const PRODUCT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const MANIFEST_FIELDS = {
  required: ["schema", "setId", "version", "description", "products", "documents", "actors", "conflicts"],
  optional: [],
} as const;

function checkManifest(value: unknown, c: Checker): value is Manifest {
  if (!c.object(value, "manifest", MANIFEST_FIELDS.required, MANIFEST_FIELDS.optional)) return false;
  if (value.schema !== MANIFEST_SCHEMA_VERSION) c.error("manifest.schema", `skal være ${MANIFEST_SCHEMA_VERSION}`);
  c.string(value.setId, "manifest.setId", { pattern: KEY });
  if (!Number.isInteger(value.version) || (value.version as number) < 1) c.error("manifest.version", "skal være et positivt heltal");
  c.string(value.description, "manifest.description");

  const products = new Set<string>();
  if (c.array(value.products, "manifest.products", { min: 1 })) {
    value.products.forEach((product, i) => {
      const path = `manifest.products[${i}]`;
      if (!c.object(product, path, ["key", "name"], ["id"])) return;
      if (c.string(product.key, `${path}.key`, { pattern: KEY })) {
        if (products.has(product.key)) c.error(`${path}.key`, "er brugt før");
        products.add(product.key);
      }
      c.string(product.name, `${path}.name`);
      // The product's stable id in the platform (B-031): required in the evaluation environment.
      if (product.id !== undefined) c.string(product.id, `${path}.id`, { pattern: PRODUCT_ID });
    });
  }

  const documents = new Map<string, Set<string>>();
  if (c.array(value.documents, "manifest.documents", { min: 1 })) {
    value.documents.forEach((document, i) => {
      const path = `manifest.documents[${i}]`;
      if (!c.object(document, path, ["key", "title", "type", "product", "language", "fictional", "source", "versions"], [])) return;
      const key = c.string(document.key, `${path}.key`, { pattern: KEY }) ? document.key : `#${i}`;
      if (documents.has(key)) c.error(`${path}.key`, "er brugt før");
      c.string(document.title, `${path}.title`);
      c.oneOf(document.type, `${path}.type`, DOCUMENT_TYPE_KEYS);
      if (!products.has(document.product as string)) c.error(`${path}.product`, "findes ikke i manifest.products");
      c.string(document.language, `${path}.language`, { pattern: LANGUAGE });
      c.boolean(document.fictional, `${path}.fictional`);
      if (isObject(document.source) && document.source.kind === "fixture") {
        if (c.object(document.source, `${path}.source`, ["kind", "path"], [])) c.string(document.source.path, `${path}.source.path`, { pattern: /^[a-z0-9][a-z0-9/_.-]*\.json$/ });
      } else if (isObject(document.source) && document.source.kind === "public") {
        if (c.object(document.source, `${path}.source`, ["kind", "url", "sha256", "licence"], [])) {
          c.string(document.source.url, `${path}.source.url`, { pattern: /^https:\/\// });
          c.string(document.source.sha256, `${path}.source.sha256`, { pattern: SHA256 });
          c.string(document.source.licence, `${path}.source.licence`);
        }
      } else {
        c.error(`${path}.source.kind`, 'skal være "fixture" eller "public"');
      }
      // Fictional material must be a fixture; public material must not claim to be fictional.
      if (isObject(document.source) && document.source.kind === "fixture" && document.fictional !== true) {
        c.error(`${path}.fictional`, "materiale i fixtures skal være fiktivt");
      }
      const labels = new Set<string>();
      if (c.array(document.versions, `${path}.versions`, { min: 1 })) {
        document.versions.forEach((version, j) => {
          const vpath = `${path}.versions[${j}]`;
          if (!c.object(version, vpath, ["label", "validFrom", "validTo", "status"], [])) return;
          if (c.string(version.label, `${vpath}.label`, { pattern: KEY })) {
            if (labels.has(version.label)) c.error(`${vpath}.label`, "er brugt før");
            labels.add(version.label);
          }
          if (version.validFrom !== null) c.date(version.validFrom, `${vpath}.validFrom`);
          if (version.validTo !== null) c.date(version.validTo, `${vpath}.validTo`);
          if (isDate(version.validFrom) && isDate(version.validTo) && version.validTo <= version.validFrom) {
            c.error(`${vpath}.validTo`, "skal ligge efter validFrom");
          }
          c.oneOf(version.status, `${vpath}.status`, ["published", "withdrawn"]);
        });
      }
      documents.set(key, labels);
    });
  }

  const actors = new Set<string>();
  if (c.array(value.actors, "manifest.actors", { min: 1 })) {
    value.actors.forEach((actor, i) => {
      const path = `manifest.actors[${i}]`;
      if (!c.object(actor, path, ["id", "description", "grants"], [])) return;
      if (c.string(actor.id, `${path}.id`, { pattern: KEY })) {
        if (actors.has(actor.id)) c.error(`${path}.id`, "er brugt før");
        actors.add(actor.id);
      }
      c.string(actor.description, `${path}.description`);
      if (c.array(actor.grants, `${path}.grants`)) {
        actor.grants.forEach((grant, j) => {
          const gpath = `${path}.grants[${j}]`;
          if (!c.object(grant, gpath, ["document", "historical"], [])) return;
          if (!documents.has(grant.document as string)) c.error(`${gpath}.document`, "findes ikke i manifest.documents");
          c.boolean(grant.historical, `${gpath}.historical`);
        });
      }
    });
  }

  if (c.array(value.conflicts, "manifest.conflicts")) {
    const ids = new Set<string>();
    value.conflicts.forEach((conflict, i) => {
      const path = `manifest.conflicts[${i}]`;
      if (!c.object(conflict, path, ["id", "documents", "status"], [])) return;
      if (c.string(conflict.id, `${path}.id`, { pattern: KEY })) {
        if (ids.has(conflict.id)) c.error(`${path}.id`, "er brugt før");
        ids.add(conflict.id);
      }
      if (c.array(conflict.documents, `${path}.documents`) && conflict.documents.length !== 2) c.error(`${path}.documents`, "skal have præcis to dokumenter");
      if (Array.isArray(conflict.documents)) {
        for (const document of conflict.documents) if (!documents.has(document as string)) c.error(`${path}.documents`, `ukendt dokument ${JSON.stringify(document)}`);
        if (conflict.documents[0] === conflict.documents[1]) c.error(`${path}.documents`, "skal være to forskellige dokumenter");
      }
      c.oneOf(conflict.status, `${path}.status`, ["open", "resolved"]);
    });
  }
  return c.errors.length === 0;
}

// ---------------------------------------------------------------------------------------------
// Case (schema v1)
// ---------------------------------------------------------------------------------------------

export const CASE_FIELDS = {
  required: ["id", "schema", "type", "question", "language", "actor", "mode", "expected", "split", "author", "created", "notes"],
  optional: ["asOf", "filters", "tags", "retired", "retiredReason"],
} as const;

export const EXPECTED_FIELDS = {
  required: ["outcome", "passages"],
  optional: ["temporalStatus", "mustNotInclude", "conflict", "permissions", "distractors"],
} as const;

function checkRefs(value: unknown, path: string, c: Checker): void {
  if (!c.array(value, path, { min: 1 })) return;
  value.forEach((ref, i) => {
    if (!c.object(ref, `${path}[${i}]`, ["document"], ["version"])) return;
    c.string(ref.document, `${path}[${i}].document`, { pattern: KEY });
    if (ref.version !== undefined) c.string(ref.version, `${path}[${i}].version`, { pattern: KEY });
  });
}

/** Structural validation of one case, independent of the manifest. */
function checkCaseShape(value: unknown, path: string, c: Checker): value is EvalCase {
  const before = c.errors.length;
  if (!c.object(value, path, CASE_FIELDS.required, CASE_FIELDS.optional)) return false;
  c.string(value.id, `${path}.id`, { pattern: KEY });
  if (value.schema !== CASE_SCHEMA_VERSION) c.error(`${path}.schema`, `skal være ${CASE_SCHEMA_VERSION}`);
  c.oneOf(value.type, `${path}.type`, CASE_TYPES);
  c.string(value.question, `${path}.question`, { max: MAX_QUESTION_CHARS });
  c.string(value.language, `${path}.language`, { pattern: LANGUAGE });
  c.string(value.actor, `${path}.actor`, { pattern: KEY });
  c.oneOf(value.mode, `${path}.mode`, CASE_MODES);
  if (value.mode === "as_of") c.date(value.asOf, `${path}.asOf`);
  else if (value.asOf !== undefined) c.error(`${path}.asOf`, 'må kun angives med mode "as_of"');
  if (value.filters !== undefined && c.object(value.filters, `${path}.filters`, [], ["products", "documents", "documentTypes"])) {
    if (Object.keys(value.filters).length === 0) c.error(`${path}.filters`, "må ikke være tom — udelad feltet");
    if (value.filters.products !== undefined) c.keys(value.filters.products, `${path}.filters.products`);
    if (value.filters.documents !== undefined) c.keys(value.filters.documents, `${path}.filters.documents`);
    if (value.filters.documentTypes !== undefined && c.array(value.filters.documentTypes, `${path}.filters.documentTypes`, { min: 1 })) {
      value.filters.documentTypes.forEach((type, i) => c.oneOf(type, `${path}.filters.documentTypes[${i}]`, DOCUMENT_TYPE_KEYS));
    }
  }
  c.oneOf(value.split, `${path}.split`, CASE_SPLITS);
  c.string(value.author, `${path}.author`);
  c.date(value.created, `${path}.created`);
  c.string(value.notes, `${path}.notes`);
  if (value.tags !== undefined && c.array(value.tags, `${path}.tags`)) value.tags.forEach((tag, i) => c.string(tag, `${path}.tags[${i}]`));
  if (value.retired !== undefined && c.boolean(value.retired, `${path}.retired`) && value.retired) c.string(value.retiredReason, `${path}.retiredReason`);
  if (value.retiredReason !== undefined && value.retired !== true) c.error(`${path}.retiredReason`, "kræver retired: true");

  const e = value.expected;
  const ep = `${path}.expected`;
  if (c.object(e, ep, EXPECTED_FIELDS.required, EXPECTED_FIELDS.optional)) {
    c.oneOf(e.outcome, `${ep}.outcome`, CASE_OUTCOMES);
    if (c.array(e.passages, `${ep}.passages`)) {
      e.passages.forEach((passage, i) => {
        const pp = `${ep}.passages[${i}]`;
        if (!c.object(passage, pp, ["document", "version", "anchor", "grade"], [])) return;
        c.string(passage.document, `${pp}.document`, { pattern: KEY });
        c.string(passage.version, `${pp}.version`, { pattern: KEY });
        // An anchor must be distinctive: at least a few words, never a single character.
        c.string(passage.anchor, `${pp}.anchor`, { min: 8, max: 300 });
        c.oneOf(passage.grade, `${pp}.grade`, [1, 2, 3]);
      });
    }
    if (e.temporalStatus !== undefined) c.oneOf(e.temporalStatus, `${ep}.temporalStatus`, ["current", "historical"]);
    if (e.mustNotInclude !== undefined) checkRefs(e.mustNotInclude, `${ep}.mustNotInclude`, c);
    if (e.distractors !== undefined) checkRefs(e.distractors, `${ep}.distractors`, c);
    if (e.conflict !== undefined && e.conflict !== null && c.object(e.conflict, `${ep}.conflict`, ["documents"], [])) {
      if (c.keys(e.conflict.documents, `${ep}.conflict.documents`) && (e.conflict.documents.length !== 2 || e.conflict.documents[0] === e.conflict.documents[1])) {
        c.error(`${ep}.conflict.documents`, "skal være præcis to forskellige dokumenter");
      }
    }
    if (e.permissions !== undefined && c.object(e.permissions, `${ep}.permissions`, ["forbiddenDocuments"], [])) {
      c.keys(e.permissions.forbiddenDocuments, `${ep}.permissions.forbiddenDocuments`);
    }
  }
  if (c.errors.length > before) return false;
  checkTypeRules(value as unknown as EvalCase, path, c);
  return c.errors.length === before;
}

/** What each question type requires of its facit (docs/08b §5.3). */
function checkTypeRules(evalCase: EvalCase, path: string, c: Checker): void {
  const e = evalCase.expected;
  const grade3 = e.passages.filter((passage) => passage.grade === 3).length;
  const ep = `${path}.expected`;
  if (e.outcome === "insufficient" && e.passages.length > 0) c.error(`${ep}.passages`, 'skal være tom ved outcome "insufficient"');
  if (e.outcome === "evidence" && grade3 === 0) c.error(`${ep}.passages`, 'skal have mindst én passage med grad 3 ved outcome "evidence"');
  switch (evalCase.type) {
    case "direct":
      if (e.outcome !== "evidence") c.error(`${ep}.outcome`, 'skal være "evidence" for direct');
      break;
    case "multi_chunk":
      if (grade3 < 2) c.error(`${ep}.passages`, "multi_chunk kræver mindst to passager med grad 3");
      break;
    case "historical":
      if (evalCase.mode !== "as_of") c.error(`${path}.mode`, 'historical kræver mode "as_of"');
      if (e.temporalStatus !== "historical") c.error(`${ep}.temporalStatus`, 'historical kræver temporalStatus "historical"');
      if (!e.mustNotInclude?.length) c.error(`${ep}.mustNotInclude`, "historical kræver den gældende version i mustNotInclude");
      break;
    case "conflict":
      if (!e.conflict) c.error(`${ep}.conflict`, "conflict kræver de to dokumenter i konflikten");
      break;
    case "unanswerable":
      if (e.outcome !== "insufficient") c.error(`${ep}.outcome`, 'unanswerable kræver "insufficient"');
      break;
    case "distractor":
      if (e.outcome !== "evidence") c.error(`${ep}.outcome`, 'distractor kræver "evidence"');
      if (!e.distractors?.length) c.error(`${ep}.distractors`, "distractor kræver mindst én distraktor");
      break;
    case "permission":
      if (e.outcome !== "insufficient") c.error(`${ep}.outcome`, 'permission kræver "insufficient"');
      if (!e.permissions?.forbiddenDocuments.length) c.error(`${ep}.permissions`, "permission kræver de dokumenter, brugeren ikke må se");
      break;
    case "filter":
      if (!evalCase.filters) c.error(`${path}.filters`, "filter kræver mindst ét filter");
      if (e.outcome !== "evidence") c.error(`${ep}.outcome`, 'filter kræver "evidence"');
      break;
  }
}

/** Cross-checks a case against the manifest: identities, documents, versions and access. */
function checkCaseAgainstManifest(evalCase: EvalCase, manifest: Manifest, path: string, c: Checker): void {
  const documents = new Map(manifest.documents.map((document) => [document.key, document]));
  const actor = manifest.actors.find((entry) => entry.id === evalCase.actor);
  if (!actor) {
    c.error(`${path}.actor`, "findes ikke i manifestet");
    return;
  }
  const granted = new Set(actor.grants.map((grant) => grant.document));
  const ref = (document: string, version: string | undefined, where: string) => {
    const known = documents.get(document);
    if (!known) c.error(where, `ukendt dokument ${JSON.stringify(document)}`);
    else if (version !== undefined && !known.versions.some((entry) => entry.label === version)) c.error(where, `ukendt version ${JSON.stringify(version)} af ${document}`);
  };
  const ep = `${path}.expected`;
  evalCase.expected.passages.forEach((passage, i) => {
    ref(passage.document, passage.version, `${ep}.passages[${i}]`);
    // A facit the actor cannot see can never be met — that is a set error, not a retrieval error.
    if (!granted.has(passage.document)) c.error(`${ep}.passages[${i}]`, `${evalCase.actor} har ikke adgang til ${passage.document}`);
  });
  evalCase.expected.mustNotInclude?.forEach((entry, i) => ref(entry.document, entry.version, `${ep}.mustNotInclude[${i}]`));
  evalCase.expected.distractors?.forEach((entry, i) => ref(entry.document, entry.version, `${ep}.distractors[${i}]`));
  evalCase.expected.conflict?.documents.forEach((document) => ref(document, undefined, `${ep}.conflict`));
  if (evalCase.expected.conflict) {
    const [a, b] = evalCase.expected.conflict.documents;
    const declared = manifest.conflicts.some((conflict) => conflict.status === "open" && conflict.documents.includes(a) && conflict.documents.includes(b));
    if (!declared) c.error(`${ep}.conflict`, "konflikten er ikke erklæret som åben i manifestet");
  }
  evalCase.expected.permissions?.forbiddenDocuments.forEach((document, i) => {
    ref(document, undefined, `${ep}.permissions.forbiddenDocuments[${i}]`);
    if (granted.has(document)) c.error(`${ep}.permissions.forbiddenDocuments[${i}]`, `${evalCase.actor} har faktisk adgang til ${document}`);
  });
  evalCase.filters?.documents?.forEach((document, i) => ref(document, undefined, `${path}.filters.documents[${i}]`));
  evalCase.filters?.products?.forEach((product, i) => {
    if (!manifest.products.some((entry) => entry.key === product)) c.error(`${path}.filters.products[${i}]`, `ukendt produkt ${JSON.stringify(product)}`);
  });
}

/** Parses JSON Lines: one case per line, blank lines ignored, every line reported with its number. */
export function parseCasesJsonl(text: string): { cases: unknown[]; errors: SchemaError[] } {
  const cases: unknown[] = [];
  const errors: SchemaError[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.trim().length === 0) return;
    try {
      cases.push(JSON.parse(line));
    } catch {
      errors.push({ path: `linje ${i + 1}`, message: "er ikke gyldig JSON" });
    }
  });
  return { cases, errors };
}

/** Validates manifest and cases together. Throws EvalSetError with every problem found. */
export function validateEvalSet(manifest: unknown, cases: readonly unknown[]): EvalSet {
  const c = new Checker();
  const manifestOk = checkManifest(manifest, c);
  const ids = new Set<string>();
  cases.forEach((value, i) => {
    const path = `cases[${i}]`;
    if (!checkCaseShape(value, path, c)) return;
    if (ids.has(value.id)) c.error(`${path}.id`, `er brugt før (${value.id})`);
    ids.add(value.id);
    if (manifestOk) checkCaseAgainstManifest(value, manifest as Manifest, `${path} (${value.id})`, c);
  });
  if (cases.length === 0) c.error("cases", "sættet har ingen spørgsmål");
  if (c.errors.length > 0) throw new EvalSetError(c.errors);
  return { manifest: manifest as Manifest, cases: cases as EvalCase[] };
}

// ---------------------------------------------------------------------------------------------
// Gate set
// ---------------------------------------------------------------------------------------------

/**
 * What each quality gate measures and in which direction (docs/08b §4.4, D-6). Locked in code:
 * a gate set may only change the THRESHOLDS — never the metric or the direction, so a gate
 * cannot be loosened by flipping its comparator.
 */
export const LOCKED_QUALITY_GATES: Record<QualityGateId, { metric: MetricId; comparator: Comparator }> = {
  Q1: { metric: "source_recall_at_k", comparator: ">=" },
  Q2: { metric: "passage_recall_at_k", comparator: ">=" },
  Q3: { metric: "mrr_at_k", comparator: ">=" },
  Q4: { metric: "correct_abstention", comparator: ">=" },
  Q5: { metric: "false_abstention", comparator: "<=" },
  Q6: { metric: "distractor_intrusion", comparator: "<=" },
  Q7: { metric: "reranker_uplift", comparator: "not_lower" },
};

/** K is the configuration's topK (docs/08b §4.2). The locked gates are defined at K = 8. */
export const LOCKED_K = 8;

export const GATE_SET_FIELDS = { required: ["id", "version", "decision", "k", "quality"], optional: ["description"] } as const;

export function validateGateSet(value: unknown): GateSet {
  const c = new Checker();
  if (c.object(value, "gates", GATE_SET_FIELDS.required, GATE_SET_FIELDS.optional)) {
    c.string(value.id, "gates.id", { pattern: KEY });
    if (!Number.isInteger(value.version) || (value.version as number) < 1) c.error("gates.version", "skal være et positivt heltal");
    c.string(value.decision, "gates.decision", { pattern: /^B-\d{3}$/ });
    if (value.description !== undefined) c.string(value.description, "gates.description");
    if (value.k !== LOCKED_K) c.error("gates.k", `skal være ${LOCKED_K} (docs/08b §4.2)`);
    if (isObject(value.quality)) {
      // Hard gates are invariants with zero tolerance (hard-gates.ts) — never data.
      for (const key of Object.keys(value.quality)) {
        if ((HARD_GATE_IDS as readonly string[]).includes(key)) c.error(`gates.quality.${key}`, "hårde gates er invarianter i koden og kan ikke stå i et gate-sæt");
      }
      if (c.object(value.quality, "gates.quality", QUALITY_GATE_IDS, [])) {
        for (const id of QUALITY_GATE_IDS) {
          const gate = value.quality[id];
          const path = `gates.quality.${id}`;
          const locked = LOCKED_QUALITY_GATES[id];
          if (!c.object(gate, path, ["metric", "comparator"], ["threshold"])) continue;
          if (gate.metric !== locked.metric) c.error(`${path}.metric`, `skal være "${locked.metric}"`);
          if (gate.comparator !== locked.comparator) c.error(`${path}.comparator`, `skal være "${locked.comparator}"`);
          if (locked.comparator === "not_lower") {
            if (gate.threshold !== undefined) c.error(`${path}.threshold`, "Q7 sammenligner med kørslen uden reranker og har ingen tærskel");
          } else if (typeof gate.threshold !== "number" || !Number.isFinite(gate.threshold) || gate.threshold < 0 || gate.threshold > 1) {
            c.error(`${path}.threshold`, "skal være et tal mellem 0 og 1");
          }
        }
      }
    } else {
      c.error("gates.quality", "skal være et objekt");
    }
  }
  if (c.errors.length > 0) throw new GateSetError(c.errors);
  return Object.freeze(structuredClone(value)) as GateSet;
}

// ---------------------------------------------------------------------------------------------
// Declared configuration (docs/08b §10.1). Provider and model are data, never code.
// ---------------------------------------------------------------------------------------------

export interface DeclaredConfiguration {
  schema: 2;
  label: string;
  description: string;
  configuration: ConfigurationInput;
}

const SETTING_KEY = /^[a-zA-Z][a-zA-Z0-9_]*$/;

function checkProcessing(value: unknown, path: string, c: Checker): void {
  if (!isObject(value)) {
    c.error(path, "skal være et objekt");
    return;
  }
  if (value.kind === "in_process") c.object(value, path, ["kind"], []);
  else if (value.kind === "in_region") {
    if (c.object(value, path, ["kind", "region"], [])) c.string(value.region, `${path}.region`);
  } else if (value.kind === "geographic") {
    if (c.object(value, path, ["kind", "geography", "sourceRegion", "inferenceProfile"], [])) {
      c.oneOf(value.geography, `${path}.geography`, ["EU"]);
      c.string(value.sourceRegion, `${path}.sourceRegion`);
      c.string(value.inferenceProfile, `${path}.inferenceProfile`);
    }
  } else c.error(`${path}.kind`, 'skal være "in_process", "in_region" eller "geographic"');
}

function checkSettings(value: unknown, path: string, c: Checker): void {
  if (!isObject(value)) {
    c.error(path, "skal være et objekt");
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (!SETTING_KEY.test(key)) c.error(`${path}.${key}`, "ugyldigt navn");
    if (!["string", "number", "boolean"].includes(typeof entry) || (typeof entry === "number" && !Number.isFinite(entry))) c.error(`${path}.${key}`, "skal være tekst, tal eller sand/falsk");
  }
}

export function validateDeclaredConfiguration(value: unknown): DeclaredConfiguration {
  const c = new Checker();
  if (c.object(value, "configuration", ["schema", "label", "description", "configuration"], [])) {
    if (value.schema !== 2) c.error("configuration.schema", "skal være 2 (fingerprint-materialet fra provider-kontrakten, 8B-I2)");
    c.string(value.label, "configuration.label", { pattern: KEY });
    c.string(value.description, "configuration.description");
    const input = value.configuration;
    const path = "configuration.configuration";
    if (c.object(input, path, ["embedding", "reranker", "algorithmVersion", "params", "chunkerVersions"], [])) {
      if (input.embedding !== null && c.object(input.embedding, `${path}.embedding`, ["provider", "model", "modelVersion", "dimensions", "processing", "settings"], [])) {
        for (const key of ["provider", "model", "modelVersion"] as const) c.string(input.embedding[key], `${path}.embedding.${key}`);
        const dimensions = input.embedding.dimensions;
        if (!Number.isInteger(dimensions) || (dimensions as number) < 1 || (dimensions as number) > 2000) c.error(`${path}.embedding.dimensions`, "skal være et heltal mellem 1 og 2000");
        checkProcessing(input.embedding.processing, `${path}.embedding.processing`, c);
        checkSettings(input.embedding.settings, `${path}.embedding.settings`, c);
      }
      if (c.object(input.reranker, `${path}.reranker`, ["provider", "model", "modelVersion", "id", "version", "processing", "settings"], [])) {
        for (const key of ["provider", "model", "modelVersion", "id", "version"] as const) c.string(input.reranker[key], `${path}.reranker.${key}`);
        checkProcessing(input.reranker.processing, `${path}.reranker.processing`, c);
        checkSettings(input.reranker.settings, `${path}.reranker.settings`, c);
      }
      c.string(input.algorithmVersion, `${path}.algorithmVersion`);
      if (c.object(input.params, `${path}.params`, ["candidateK", "rerankN", "topK", "maxPerVersion", "minScore", "rrfK"], [])) {
        for (const key of ["candidateK", "rerankN", "topK", "maxPerVersion", "rrfK"] as const) {
          if (!Number.isInteger(input.params[key]) || (input.params[key] as number) < 1) c.error(`${path}.params.${key}`, "skal være et positivt heltal");
        }
        const minScore = input.params.minScore;
        if (typeof minScore !== "number" || minScore < 0 || minScore > 1) c.error(`${path}.params.minScore`, "skal være et tal mellem 0 og 1");
      }
      if (c.array(input.chunkerVersions, `${path}.chunkerVersions`, { min: 1 })) input.chunkerVersions.forEach((version, i) => c.string(version, `${path}.chunkerVersions[${i}]`));
    }
  }
  if (c.errors.length > 0) throw new EvalSetError(c.errors);
  return value as unknown as DeclaredConfiguration;
}
