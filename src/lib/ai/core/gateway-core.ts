import type { EvidenceItem, EvidenceSet } from "@/lib/knowledge/core/evidence";
import { combinedGrade, runtimeEnv, type Grade, type RuntimeEnv } from "@/lib/knowledge/core/grade";
import type { RetrievalRequest } from "@/lib/knowledge/retrieval-core";
import type { PermissionKey, PermissionScope } from "@/lib/auth/permissions";

import type { AiOutcome } from "../outcome";
import { validateOutput, type ContractOutput } from "./contracts";
import { decideGating, type GatingState } from "./gating";
import { invokeModel } from "./invoke";
import type { Model } from "./model";
import { buildMatrix, effectiveRule, type PolicyRow } from "./policy";
import { profileFor, type WorkflowProfile } from "./profiles";
import { createRedactor, reidentify, type KnownName } from "./redaction";
import { createContractBreakingStub } from "./registry";
import type { AiContext, AiRequest, DataCategory, ModelInput, SentPart } from "./types";

/**
 * The AI Gateway pipeline (docs/08 §1). One entry, a fixed order of steps; a step that refuses
 * stops the flow, so a refused call never reaches the model. Every call by a signed-in user is
 * logged — refused ones too (§11).
 *
 * The pipeline takes its dependencies as parameters so it can be tested; application code calls
 * runAiRequest (gateway.ts), which wires the real database, retrieval and registry.
 */

export const MAX_INPUT_CHARS = 1000;
export const MAX_LABEL_CHARS = 200;

export interface GatewayUser {
  id: string;
  name: string;
}

export interface CallRecord {
  call: {
    profile_id: string;
    profile_version: string;
    action: string;
    model_id: string | null;
    model_version: string | null;
    model_grade: Grade | null;
    evidence_grade: Grade | null;
    answer_grade: Grade | null;
    outcome: AiOutcome["kind"];
    reason_code: string | null;
    case_id: string | null;
    timings: Record<string, number>;
    redactions: Record<string, number>;
    removed_fields: number;
    error_code: string | null;
  };
  sources: { evidence_id: string; chunk_id: string; document_version_id: string; score: number; sent: boolean; cited: boolean }[];
  /** Content: what was sent and what came back. Only when the model was called. */
  payload: { sent: unknown; returned: unknown } | null;
  /** The redacted question for a knowledge gap (dropped by the database for a case-bound call). */
  gapQuestion: string | null;
}

export interface GatewayDeps {
  /** The active platform user of this session, or null. */
  user(): Promise<GatewayUser | null>;
  hasPermission(key: PermissionKey, scope?: PermissionScope): Promise<boolean>;
  /** A customer case the user can access (RLS), or null. */
  loadCase(caseId: string): Promise<{ id: string; companyName: string } | null>;
  /** Throws when the state cannot be read — the call then fails closed. */
  gatingState(): Promise<GatingState>;
  policyRows(modelId: string): Promise<PolicyRow[]>;
  /** retrieveEvidence as the user. Throws RetrievalError. */
  retrieve(request: RetrievalRequest, dev: { devForceInsufficient?: boolean }): Promise<EvidenceSet>;
  /** The configured model. Throws when it may not be used here (fail-closed registry). */
  model(): Model;
  record(entry: CallRecord): Promise<void>;
  environment?: RuntimeEnv;
  now?: () => number;
}

/** Development tools for ONE call — refused outside IPA_RUNTIME_ENV=local/test (like B-009). */
export interface AiDevOptions {
  forceUnverifiable?: boolean;
  forceInsufficient?: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

class Stop extends Error {
  readonly outcome: AiOutcome;
  readonly reasonCode: string | null;
  constructor(outcome: AiOutcome, reasonCode: string | null = null) {
    super(outcome.kind);
    this.outcome = outcome;
    this.reasonCode = reasonCode;
  }
}

const invalid = (message: string, code: string) => new Stop({ kind: "invalid_request", message }, code);
const denied = (message: string, code: string) => new Stop({ kind: "denied", message }, code);
const unavailable = (message: string, code: string) => new Stop({ kind: "unavailable", message }, code);

/** Applies a function to every string in a JSON value (used for re-identification). */
function mapStrings<T>(value: T, fn: (text: string) => string): T {
  if (typeof value === "string") return fn(value) as T;
  if (Array.isArray(value)) return value.map((entry) => mapStrings(entry, fn)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, mapStrings(entry, fn)])) as T;
  }
  return value;
}

/** Keeps only allowlisted context keys (docs/08 §6). */
function minimizeContext(context: AiContext | undefined, profile: WorkflowProfile): { context: AiContext; removed: number } {
  const kept: AiContext = {};
  let removed = 0;
  for (const [key, value] of Object.entries(context ?? {})) {
    if (value === undefined) continue;
    if (profile.context.includes(key)) kept[key] = value;
    else removed += 1;
  }
  return { context: kept, removed };
}

function evidencePart(item: EvidenceItem, maxChars: number): SentPart {
  const text = [item.excerpt.leadIn, item.excerpt.text].filter(Boolean).join("\n");
  return Object.freeze({
    kind: "evidence" as const,
    category: "knowledge" as const,
    text: text.slice(0, maxChars),
    evidence: Object.freeze({
      evidenceId: item.evidenceId,
      label: item.sourceReference.label,
      temporalStatus: item.validity.temporalStatus,
      inConflict: item.conflicts.length > 0,
    }),
  });
}

function permissionsFor(profile: WorkflowProfile): { key: PermissionKey; scope: PermissionScope }[] {
  switch (profile.id) {
    case "learn":
      return [{ key: "learning.progress.read", scope: "own" }];
    case "practice":
      return [{ key: "practice.session.write", scope: "own" }];
    case "advise":
      return [{ key: "advise.case.read", scope: "own" }];
    default:
      return [];
  }
}

export async function runGateway(request: AiRequest, deps: GatewayDeps, dev: AiDevOptions = {}): Promise<AiOutcome> {
  const now = deps.now ?? (() => performance.now());
  const environment = deps.environment ?? runtimeEnv();
  const started = now();
  const timings: Record<string, number> = {};
  let mark = started;
  const step = (name: string) => {
    const at = now();
    timings[name] = Math.round(at - mark);
    mark = at;
  };

  const profile = profileFor(request.profile);
  const actionSpec = profile && Object.hasOwn(profile.actions, request.action) ? profile.actions[request.action] : null;

  let user: GatewayUser | null = null;
  let model: Model | null = null;
  let evidence: EvidenceSet | null = null;
  let caseId: string | null = null;
  let redactions: Record<string, number> = {};
  let removedFields = 0;
  let sent: ModelInput | null = null;
  let returned: unknown = null;
  let cited: string[] = [];
  let sentEvidenceIds = new Set<string>();
  let gapQuestion: string | null = null;
  let outcome: AiOutcome;
  let reasonCode: string | null = null;
  let errorCode: string | null = null;

  try {
    // 1. Authn — an active platform user (identity.users.status).
    user = await deps.user();
    if (!user) throw denied("Du skal være logget ind.", "not_signed_in");
    step("authn");

    // 2. Profile and action.
    if (!profile || !actionSpec) throw invalid("Ukendt AI-funktion.", "unknown_profile_or_action");
    if (!profile.userCallable) throw denied("Funktionen kan ikke kaldes af en bruger.", "not_user_callable");
    const input = typeof request.input === "string" ? request.input.trim() : "";
    if (input.length === 0) throw invalid("Skriv et spørgsmål.", "empty_input");
    if (input.length > MAX_INPUT_CHARS) throw invalid(`Spørgsmålet må højst være ${MAX_INPUT_CHARS} tegn.`, "input_too_long");
    if ((dev.forceUnverifiable || dev.forceInsufficient) && environment === "production") {
      throw invalid("Udviklingsværktøjer kan kun bruges lokalt og i test.", "dev_tool_refused");
    }

    // 8 (early): data minimisation of the context — only allowlisted keys go on.
    const minimized = minimizeContext(request.context, profile);
    removedFields = minimized.removed;
    const context = minimized.context;

    // 3. Permissions — verified again here, against the database, as the user.
    for (const requirement of permissionsFor(profile)) {
      if (!(await deps.hasPermission(requirement.key, requirement.scope))) throw denied("Du har ikke adgang til denne funktion.", "missing_permission");
    }
    const knownNames: KnownName[] = [{ type: "person", value: user.name }];
    if (profile.id === "advise" && !context.caseId) throw invalid("Forslag kræver en kundesag.", "case_required");
    if (context.caseId !== undefined) {
      if (typeof context.caseId !== "string" || !UUID.test(context.caseId)) throw denied("Sagen findes ikke.", "case_not_found");
      if (!(await deps.hasPermission("advise.case.read", "own"))) throw denied("Sagen findes ikke.", "case_not_found");
      const found = await deps.loadCase(context.caseId);
      if (!found) throw denied("Sagen findes ikke.", "case_not_found");
      caseId = found.id;
      knownNames.push({ type: "virksomhed", value: found.companyName });
    }
    step("permissions");

    // 4. Gating — from the session state in the database. Unreadable state fails closed.
    let state: GatingState;
    try {
      state = await deps.gatingState();
    } catch {
      throw unavailable("Det kunne ikke afgøres, om AI er tilladt lige nu. Prøv igen.", "gating_state_unreadable");
    }
    const gating = decideGating(profile.id, request.action, state, typeof context.roleplaySessionId === "string" ? context.roleplaySessionId : undefined);
    if (!gating.allowed) {
      if (gating.kind === "locked") throw new Stop({ kind: "locked", reason: gating.reason }, gating.reason);
      throw invalid("Rollespillet er ikke i gang.", gating.reason);
    }
    step("gating");

    // Redaction of the user's own text — before retrieval, so the search runs on the
    // professional question and not on identities (docs/03 §9).
    const redactor = createRedactor(knownNames);
    const question = redactor.redact(input);
    const label = typeof context.label === "string" ? redactor.redact(context.label.slice(0, MAX_LABEL_CHARS)) : null;
    redactions = redactor.counts;
    gapQuestion = question;

    // The model — fail-closed registry; a breaking stub only via the development tool.
    try {
      model = dev.forceUnverifiable ? createContractBreakingStub(environment) : deps.model();
    } catch (error) {
      throw unavailable((error as Error).message, "model_unavailable");
    }

    // 6. Retrieval with the profile's retrieval profile.
    if (actionSpec.retrieval) {
      const mode = context.mode === "as_of" ? "as_of" : "current";
      if (mode === "as_of" && !profile.retrieval.allowHistorical) throw invalid("Historisk opslag er ikke muligt her.", "historical_not_allowed");
      if (mode === "as_of" && (typeof context.asOf !== "string" || !DATE.test(context.asOf))) throw invalid("Vælg en gyldig dato.", "invalid_as_of");
      const requested = Array.isArray(context.documentTypes) ? context.documentTypes.filter((type): type is string => typeof type === "string") : undefined;
      const documentTypes = profile.retrieval.documentTypes
        ? requested
          ? requested.filter((type) => profile.retrieval.documentTypes!.includes(type))
          : profile.retrieval.documentTypes
        : requested;
      const productIds = Array.isArray(context.productIds) ? context.productIds.filter((id): id is string => typeof id === "string") : undefined;
      try {
        evidence = await deps.retrieve(
          { query: question, mode, asOf: mode === "as_of" ? (context.asOf as string) : undefined, productIds, documentTypes, topK: profile.retrieval.topK },
          { devForceInsufficient: dev.forceInsufficient === true },
        );
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "denied") throw denied("Du har ikke adgang til vidensgrundlaget.", "retrieval_denied");
        if (code === "invalid_request") throw invalid((error as Error).message, "retrieval_invalid");
        throw unavailable(code === "unavailable" ? (error as Error).message : "Søgningen kunne ikke gennemføres.", "retrieval_unavailable");
      }
    }
    step("retrieval");

    // 7. Evidence requirement — no evidence: the model is NOT called.
    if (actionSpec.requiresEvidence && (!evidence || evidence.items.length === 0)) {
      throw new Stop(
        { kind: "insufficient", profile: profile.id, grade: evidence?.retrieval.grade ?? "development", evidence: [], forced: Boolean(evidence?.retrieval.devOverride) },
        evidence?.retrieval.devOverride ? "forced_insufficient" : "no_evidence",
      );
    }

    // 8. Data minimisation of the content: allowlisted parts and limits only.
    const parts: SentPart[] = [Object.freeze({ kind: "question" as const, category: "user_question" as const, text: question })];
    if (label) parts.push(Object.freeze({ kind: "context" as const, category: "user_question" as const, text: label }));
    let total = parts.reduce((sum, part) => sum + part.text.length, 0);
    for (const item of evidence?.items.slice(0, profile.limits.maxEvidence) ?? []) {
      const part = evidencePart(item, profile.limits.maxCharsPerPart);
      if (total + part.text.length > profile.limits.maxTotalChars) break;
      total += part.text.length;
      parts.push(part);
    }
    sentEvidenceIds = new Set(parts.flatMap((part) => (part.evidence ? [part.evidence.evidenceId] : [])));
    step("minimize");

    // 9–10. Classification, redaction and the matrix (model × category). Fail-closed.
    const matrix = buildMatrix(await deps.policyRows(model.id), model.id);
    for (const part of parts) {
      if (effectiveRule(matrix, part.category, profile.categories) === "deny") {
        throw new Stop(
          { kind: "blocked_policy", category: part.category, message: "Oplysningerne må ikke sendes til AI-modellen efter platformens politik." },
          `policy_deny_${part.category}`,
        );
      }
    }
    // Identifiers in the user's text were replaced above (customer_identifiable is never sent
    // in phase 8: no profile lists it, and the matrix denies it by default).
    step("policy");

    // 11. The model call — only through invokeModel (pairing rule, B-012).
    sent = Object.freeze({
      profile: { id: profile.id, version: profile.version },
      action: request.action,
      system: profile.system,
      parts: Object.freeze(parts),
      outputContract: actionSpec.outputContract,
    });
    try {
      const output = await (model.grade === "development"
        ? invokeModel(model as Model<"development">, evidence, sent)
        : invokeModel(model as Model<"production">, evidence as never, sent));
      returned = output.raw;
    } catch (error) {
      if ((error as Error).name === "EvidenceGradeError" || (error as Error).name === "EvidencePairingError") {
        throw unavailable("Svaret kan ikke dannes på et udviklingsgrundlag.", "evidence_pairing_refused");
      }
      throw unavailable("AI-modellen svarede ikke. Prøv igen.", "model_error");
    }
    step("model");

    // 12. Output contract — a breach is never shown (B-016).
    const evidenceItems = evidence ? evidence.items.filter((item) => sentEvidenceIds.has(item.evidenceId)) : [];
    const validated = validateOutput(actionSpec.outputContract, returned, parts);
    step("contract");
    if (!validated.ok) {
      throw new Stop({ kind: "unverifiable", profile: profile.id, reason: validated.reason, evidence: structuredClone(evidenceItems) }, validated.reason);
    }
    cited = validated.cited;
    const modelGrade: Grade = model.grade === "development" ? "development" : "production";
    const answerGrade = evidence ? combinedGrade(modelGrade, evidence.retrieval.grade) : modelGrade;

    if ("kind" in validated.output && validated.output.kind === "insufficient") {
      outcome = { kind: "insufficient", profile: profile.id, grade: answerGrade, evidence: structuredClone(evidenceItems), forced: false };
      reasonCode = "model_declared";
    } else {
      // 13. Re-identification — only in the answer to the user, never in the log.
      const output = mapStrings(validated.output, (text) => reidentify(text, redactor.mapping)) as ContractOutput;
      outcome = { kind: "answer", profile: profile.id, grade: answerGrade, output, evidence: structuredClone(evidenceItems), cited };
    }
  } catch (error) {
    if (error instanceof Stop) {
      outcome = error.outcome;
      reasonCode = error.reasonCode;
    } else {
      outcome = { kind: "unavailable", message: "AI-funktionen kunne ikke gennemføres." };
      errorCode = "internal_error";
    }
  }
  timings.total = Math.round(now() - started);

  // 14. Logging — every call by a signed-in user, refused ones too. A call that cannot be
  // logged is not shown (fail-closed): what left the platform must always be traceable.
  if (user) {
    const evidenceGrade: Grade | null = evidence ? evidence.retrieval.grade : null;
    const modelGrade: Grade | null = model ? (model.grade === "development" ? "development" : "production") : null;
    const entry: CallRecord = {
      call: {
        profile_id: profile?.id ?? "unknown",
        profile_version: profile?.version ?? "0",
        action: actionSpec ? request.action : "unknown",
        model_id: sent ? model!.id : null,
        model_version: sent ? model!.version : null,
        model_grade: sent ? modelGrade : null,
        evidence_grade: evidenceGrade,
        answer_grade: outcome.kind === "answer" || outcome.kind === "insufficient" ? outcome.grade : null,
        outcome: outcome.kind,
        reason_code: reasonCode,
        case_id: caseId,
        timings,
        redactions,
        removed_fields: removedFields,
        error_code: errorCode,
      },
      sources: (evidence?.items ?? []).map((item) => ({
        evidence_id: item.evidenceId,
        chunk_id: item.chunkId,
        document_version_id: item.documentVersionId,
        score: item.relevance.score,
        sent: sentEvidenceIds.has(item.evidenceId),
        cited: cited.includes(item.evidenceId),
      })),
      payload: sent ? { sent, returned } : null,
      gapQuestion: outcome.kind === "insufficient" ? gapQuestion : null,
    };
    try {
      await deps.record(entry);
    } catch {
      return { kind: "unavailable", message: "Kaldet kunne ikke logges og vises derfor ikke." };
    }
  }
  return outcome;
}

export type { DataCategory };
