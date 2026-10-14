import { randomUUID } from "node:crypto";

import { REVIEWED_INSTRUCTIONS } from "../ai/core/instructions.ts";
import { isClassified, type ClassifiedText, type EgressCategory } from "./classification.ts";

/**
 * The external-AI data boundary (8B-I2.5, D-13/K-9 extended).
 *
 *   Customer-identifiable data may not leave the platform's approved trust boundary to an
 *   external AI provider without a later, explicitly approved policy.
 *
 * This holds for EVERY external AI call — model generation, query embedding, document
 * embedding and reranking (query and passages) — not only for invokeModel:
 *
 *   application/domain → classified texts → authorizeEgress (this module) → AuthorizedEgress
 *     → provider transport (assertTransmittable) → external service
 *
 *   * authorizeEgress checks every part BEFORE anything is sent. One part that may not leave
 *     denies the whole request: nothing is sent, not even the allowed parts.
 *   * The rules are code. No database row, administrator setting, environment variable or
 *     provider descriptor is read, so none can loosen them. EU hosting does not change them.
 *     Redaction does not make customer text allowed.
 *   * A transport only transmits a body whose texts were authorized (assertTransmittable).
 *   * In-process implementations (the test embedder, "none", the stub model) send nothing and
 *     are outside this boundary.
 *   * Generation is allowed per purpose (profile and action), never generally (beta L4,
 *     docs/beta.md §16.5): GENERATE_PURPOSES lists exactly the purposes the beta sends to Claude.
 *     A purpose that is not listed — Advise, Assessment, anything new — sends nothing.
 *
 * Denials are logged as technical metadata — never the text.
 */

export const EGRESS_OPERATIONS = ["embed_document", "embed_query", "rerank", "generate"] as const;
export type EgressOperation = (typeof EGRESS_OPERATIONS)[number];

export type EgressRole = "document" | "query" | "question" | "context" | "evidence" | "scenario";

/** Never sent to an external provider — whatever the operation, provider, region or setting. */
export const NEVER_EXTERNAL: readonly EgressCategory[] = Object.freeze(["customer_identifiable", "audit_access", "unknown"]);

/**
 * What each operation may send, per role. Anything not listed is denied. A future provider
 * interface needs its own row here — a reviewed code change.
 */
export const EGRESS_ALLOWED: Readonly<Record<EgressOperation, Readonly<Partial<Record<EgressRole, readonly EgressCategory[]>>>>> = Object.freeze({
  // Knowledge Engine documents. Customer documents are customer_identifiable and never get the
  // rights of Knowledge Engine material.
  embed_document: Object.freeze({ document: Object.freeze(["knowledge", "evaluation_synthetic"] as const) }),
  embed_query: Object.freeze({ query: Object.freeze(["user_question", "evaluation_synthetic"] as const) }),
  rerank: Object.freeze({
    query: Object.freeze(["user_question", "evaluation_synthetic"] as const),
    document: Object.freeze(["knowledge", "evaluation_synthetic"] as const),
  }),
  // Generation has no general row: what may be sent depends on the purpose (GENERATE_PURPOSES).
  generate: Object.freeze({}),
});

const GROUNDED_QUESTION = Object.freeze({
  question: Object.freeze(["user_question"] as const),
  context: Object.freeze(["user_question"] as const),
  evidence: Object.freeze(["knowledge"] as const),
});

/**
 * What generation may send, per purpose (`<profile>.<action>`) and role — the beta's explicit
 * rows (docs/beta.md §16.5). There is no general permission for a user's free text: the user's own
 * text is only allowed redacted, as the question (and the page's label) of these four purposes, and
 * never case-bound (checkPart). Advise (deferred) and Assessment (scoring is never left to a model)
 * have no row and send nothing.
 */
export const GENERATE_PURPOSES: Readonly<Record<string, Readonly<Partial<Record<EgressRole, readonly EgressCategory[]>>>>> = Object.freeze({
  // Copilot: a product question on the authorized, approved documents of one product.
  "copilot.answer_question": GROUNDED_QUESTION,
  // Learn: an explanation grounded in the authorized documents.
  "learn.explain": GROUNDED_QUESTION,
  // Practice roleplay: the advisor's line and FICTIONAL scenario content only — no documents, no
  // label. The approved fictional scenarios come from the database (L7).
  "practice.roleplay_turn": Object.freeze({
    question: Object.freeze(["user_question"] as const),
    scenario: Object.freeze(["training_fictional"] as const),
  }),
  // Practice feedback: the advisor's text assessed against the authorized documents.
  "practice.feedback": GROUNDED_QUESTION,
});

export type EgressDenialReason =
  | "missing_provenance"
  | "unclassified"
  | "invalid_text"
  | "never_external"
  | "case_bound"
  | "not_redacted"
  | "category_not_allowed"
  | "unknown_operation"
  | "purpose_not_allowed"
  | "no_parts"
  | "unauthorized_transmission";

export interface EgressPart {
  role: EgressRole;
  content: ClassifiedText;
}

export interface EgressRequest {
  provider: string;
  operation: EgressOperation;
  /** The calling module, for the log (e.g. "knowledge.retrieval", "ai.gateway"). */
  module: string;
  /** Generation only: `<profile>.<action>` (GENERATE_PURPOSES). Required for "generate". */
  purpose?: string;
  correlationId?: string;
  parts: readonly EgressPart[];
}

/** Technical metadata of a denial. Never the text, never PII, never the raw query. */
export interface EgressDenialLogEntry {
  event: "external_ai_egress_denied";
  at: string;
  correlationId: string;
  module: string;
  provider: string;
  operation: string;
  reason: EgressDenialReason;
  category: EgressCategory | null;
  role: EgressRole | null;
  partIndex: number | null;
}

export type EgressLog = (entry: EgressDenialLogEntry) => void;

export const defaultEgressLog: EgressLog = (entry) => console.warn(JSON.stringify(entry));

export class EgressPolicyError extends Error {
  readonly reason: EgressDenialReason;
  readonly operation: string;
  readonly provider: string;
  readonly module: string;
  readonly correlationId: string;
  readonly category: EgressCategory | null;
  readonly partIndex: number | null;
  constructor(entry: Omit<EgressDenialLogEntry, "event" | "at">) {
    super(`Data må ikke sendes til en ekstern AI-udbyder (${entry.reason}).`);
    this.name = "EgressPolicyError";
    this.reason = entry.reason;
    this.operation = entry.operation;
    this.provider = entry.provider;
    this.module = entry.module;
    this.correlationId = entry.correlationId;
    this.category = entry.category;
    this.partIndex = entry.partIndex;
  }
}

/** Proof that a set of texts passed the policy for one provider and operation. */
export interface AuthorizedEgress {
  readonly provider: string;
  readonly operation: EgressOperation;
  readonly module: string;
  /** Generation only: the purpose the texts were authorized for. */
  readonly purpose: string | null;
  readonly correlationId: string;
  /** The authorized texts, in part order. Exactly these may be transmitted. */
  readonly texts: readonly string[];
}

const authorized = new WeakSet<object>();

type Check = { reason: EgressDenialReason; category: EgressCategory | null } | null;

function allowedFor(operation: EgressOperation, purpose: string | undefined, role: EgressRole): readonly EgressCategory[] | undefined {
  if (operation !== "generate") return EGRESS_ALLOWED[operation][role];
  if (typeof purpose !== "string" || !Object.hasOwn(GENERATE_PURPOSES, purpose)) return undefined;
  const rows = GENERATE_PURPOSES[purpose]!;
  return Object.hasOwn(rows, role) ? rows[role] : undefined;
}

function checkPart(operation: EgressOperation, purpose: string | undefined, part: EgressPart | undefined): Check {
  if (!part || typeof part !== "object") return { reason: "missing_provenance", category: null };
  const content: unknown = part.content;
  if (content === undefined || content === null || typeof content === "string") return { reason: "missing_provenance", category: null };
  if (!isClassified(content)) return { reason: "unclassified", category: null };
  const { provenance, text } = content;
  if (typeof text !== "string" || text.length === 0) return { reason: "invalid_text", category: provenance.category };
  if (provenance.source === "missing") return { reason: "missing_provenance", category: provenance.category };
  // Text from a customer case context never leaves — redacted or not (no redaction bypass).
  if (provenance.caseBound) return { reason: "case_bound", category: provenance.category };
  if (NEVER_EXTERNAL.includes(provenance.category)) return { reason: "never_external", category: provenance.category };
  if (provenance.category === "user_question" && provenance.redacted !== true) return { reason: "not_redacted", category: provenance.category };
  const allowed = allowedFor(operation, purpose, part.role);
  if (!allowed || !allowed.includes(provenance.category)) return { reason: "category_not_allowed", category: provenance.category };
  return null;
}

/**
 * Authorizes ALL parts of one external request, or none. Throws EgressPolicyError (after
 * logging the denial) on the first part that may not leave; nothing may then be sent.
 */
export function authorizeEgress(request: EgressRequest, options: { log?: EgressLog; now?: () => Date } = {}): AuthorizedEgress {
  const log = options.log ?? defaultEgressLog;
  const correlationId = request.correlationId ?? randomUUID();
  const deny = (reason: EgressDenialReason, category: EgressCategory | null, role: EgressRole | null, partIndex: number | null): never => {
    const entry: EgressDenialLogEntry = {
      event: "external_ai_egress_denied",
      at: (options.now ?? (() => new Date()))().toISOString(),
      correlationId,
      module: String(request.module),
      provider: String(request.provider),
      operation: String(request.operation),
      reason,
      category,
      role,
      partIndex,
    };
    log(entry);
    throw new EgressPolicyError(entry);
  };

  if (!(EGRESS_OPERATIONS as readonly string[]).includes(request.operation)) deny("unknown_operation", null, null, null);
  if (request.operation === "generate" && (typeof request.purpose !== "string" || !Object.hasOwn(GENERATE_PURPOSES, request.purpose))) {
    deny("purpose_not_allowed", null, null, null);
  }
  if (!Array.isArray(request.parts) || request.parts.length === 0) deny("no_parts", null, null, null);
  request.parts.forEach((part, i) => {
    const failure = checkPart(request.operation, request.purpose, part);
    if (failure) deny(failure.reason, failure.category, part && typeof part === "object" ? part.role : null, i);
  });

  const token: AuthorizedEgress = Object.freeze({
    provider: request.provider,
    operation: request.operation,
    module: request.module,
    purpose: request.operation === "generate" ? request.purpose! : null,
    correlationId,
    texts: Object.freeze(request.parts.map((part) => part.content.text)),
  });
  authorized.add(token);
  return token;
}

/**
 * The protocol values a request body may contain besides the authorized texts — reviewed
 * constants, not data. A new provider adds its constants here (a reviewed change), never in its
 * own adapter. Model and profile ids are checked separately as machine ids.
 */
export const PROTOCOL_CONSTANTS: ReadonlySet<string> = new Set<string>([
  // The Cohere/Bedrock constants went with their adapters in the beta's L2 (docs/beta.md §14).
  // Anthropic Messages API (beta L4, docs/beta.md §16): the message role, the content block and
  // document source types, the cache-control type and the effort levels.
  "user",
  "text",
  "document",
  "content",
  "ephemeral",
  "low",
  "medium",
  "high",
  // The platform's reviewed instruction texts: the profiles' system prompts, the output format
  // instructions and the fixed document context (src/lib/ai/core/instructions.ts). Never data.
  ...REVIEWED_INSTRUCTIONS,
]);

const MACHINE_ID = /^[a-z0-9][a-z0-9_.:-]{0,127}$/;

function stringLeaves(value: unknown, out: string[]): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const entry of value) stringLeaves(entry, out);
  else if (value && typeof value === "object") for (const entry of Object.values(value)) stringLeaves(entry, out);
  return out;
}

/**
 * The check every external transport makes before transmission: the request carries a
 * genuine authorization for this provider, the model id is a machine id, and every string in
 * the body is one of the authorized texts, a reviewed protocol constant or the (machine) model id
 * itself. Anything else is refused — nothing is sent.
 */
export function assertTransmittable(egress: AuthorizedEgress, expected: { provider: string; modelId: string; body: unknown; log?: EgressLog }): void {
  const fail = (): never => {
    const entry: EgressDenialLogEntry = {
      event: "external_ai_egress_denied",
      at: new Date().toISOString(),
      correlationId: egress && typeof egress === "object" && typeof egress.correlationId === "string" ? egress.correlationId : "none",
      module: "transport",
      provider: expected.provider,
      operation: egress && typeof egress === "object" && typeof egress.operation === "string" ? egress.operation : "unknown",
      reason: "unauthorized_transmission",
      category: null,
      role: null,
      partIndex: null,
    };
    (expected.log ?? defaultEgressLog)(entry);
    throw new EgressPolicyError(entry);
  };
  if (!egress || typeof egress !== "object" || !authorized.has(egress) || egress.provider !== expected.provider) fail();
  if (typeof expected.modelId !== "string" || !MACHINE_ID.test(expected.modelId)) fail();
  const allowed = new Set(egress.texts);
  for (const leaf of stringLeaves(expected.body, [])) {
    if (!allowed.has(leaf) && !PROTOCOL_CONSTANTS.has(leaf) && leaf !== expected.modelId) fail();
  }
}
