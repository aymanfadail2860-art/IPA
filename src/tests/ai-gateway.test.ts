import { describe, expect, it } from "vitest";

import { validateOutput, CONTRACTS } from "@/lib/ai/core/contracts";
import { decideGating } from "@/lib/ai/core/gating";
import { runGateway, type CallRecord, type GatewayDeps } from "@/lib/ai/core/gateway-core";
import type { Model } from "@/lib/ai/core/model";
import { buildMatrix, effectiveRule, type PolicyRow } from "@/lib/ai/core/policy";
import { PROFILES } from "@/lib/ai/core/profiles";
import { createRedactor, reidentify } from "@/lib/ai/core/redaction";
import { createModel } from "@/lib/ai/core/registry";
import type { AiRequest, ModelInput, ProfileId } from "@/lib/ai/core/types";
import { presentAi, type AiOutcome } from "@/lib/ai/outcome";
import type { EvidenceItem, EvidenceSet } from "@/lib/knowledge/core/evidence";
import { RetrievalError } from "@/lib/knowledge/retrieval-core";

import { evidenceItem, issueEvidence } from "./fixtures/ai-evidence";

/** Phase 8 — the AI Gateway pipeline and its policy layers (docs/08), with a fake database. */

const STUB_ROWS: PolicyRow[] = [
  { model_id: "stub", category: "knowledge", rule: "allow" },
  { model_id: "stub", category: "user_question", rule: "allow_redacted" },
  { model_id: "stub", category: "learning", rule: "allow" },
  { model_id: "stub", category: "training_fictional", rule: "allow" },
  { model_id: "stub", category: "customer_identifiable", rule: "deny" },
  { model_id: "stub", category: "audit_access", rule: "deny" },
];

const CASE_ID = "11111111-1111-4111-8111-111111111111";

interface Harness {
  deps: GatewayDeps;
  records: CallRecord[];
  received: () => readonly ModelInput[];
  retrievals: { query: string }[];
}

function harness(options: {
  items?: EvidenceItem[];
  evidence?: () => EvidenceSet;
  permissions?: string[];
  gating?: { assessmentActive: boolean; roleplaySessionId: string | null } | "error";
  rows?: PolicyRow[];
  model?: Model;
  user?: { id: string; name: string } | null;
  recordFails?: boolean;
  retrieveError?: RetrievalError;
} = {}): Harness {
  const records: CallRecord[] = [];
  const retrievals: { query: string }[] = [];
  const model = options.model ?? createModel("stub", "test");
  const permissions = options.permissions ?? ["learning.progress.read:own", "practice.session.write:own", "advise.case.read:own"];
  const deps: GatewayDeps = {
    user: async () => (options.user === undefined ? { id: "u1", name: "Anne Rådgiver" } : options.user),
    hasPermission: async (key, scope) => permissions.some((entry) => entry === `${key}:${scope}` || (!scope && entry.startsWith(`${key}:`))),
    loadCase: async (id) => (id === CASE_ID ? { id, companyName: "Nordjysk Tømrer ApS" } : null),
    gatingState: async () => {
      if (options.gating === "error") throw new Error("down");
      return options.gating ?? { assessmentActive: false, roleplaySessionId: null };
    },
    policyRows: async () => options.rows ?? STUB_ROWS,
    retrieve: async (request, dev) => {
      retrievals.push({ query: request.query });
      if (options.retrieveError) throw options.retrieveError;
      if (dev.devForceInsufficient) return issueEvidence([], { devOverride: "force_insufficient" });
      return options.evidence ? options.evidence() : issueEvidence(options.items ?? [evidenceItem(1), evidenceItem(2)]);
    },
    model: () => model,
    record: async (entry) => {
      if (options.recordFails) throw new Error("db down");
      records.push(structuredClone(entry));
    },
    environment: "test",
  };
  return { deps, records, retrievals, received: () => (model as unknown as { received: readonly ModelInput[] }).received ?? [] };
}

const ask = (input: string, context: AiRequest["context"] = {}): AiRequest => ({ profile: "copilot", action: "answer_question", input, context });

describe("the answer path", () => {
  it("answers with citations, logs exactly one call, and marks the answer as development grade", async () => {
    const h = harness();
    const outcome = await runGateway(ask("Dækker Erhvervsansvar droner?"), h.deps);
    expect(outcome.kind).toBe("answer");
    if (outcome.kind !== "answer") return;
    expect(outcome.grade).toBe("development");
    expect(outcome.cited).toEqual(["e1", "e2"]);
    expect(outcome.evidence.map((item) => item.evidenceId)).toEqual(["e1", "e2"]);
    expect(h.records).toHaveLength(1);
    expect(h.records[0]!.call).toMatchObject({ outcome: "answer", model_id: "stub", model_grade: "development", evidence_grade: "development", answer_grade: "development" });
    expect(h.records[0]!.sources.map((source) => [source.evidence_id, source.sent, source.cited])).toEqual([["e1", true, true], ["e2", true, true]]);
    expect(Object.keys(h.records[0]!.call.timings)).toEqual(expect.arrayContaining(["authn", "permissions", "gating", "retrieval", "policy", "model", "contract", "total"]));
  });

  it("never sends identifiers or the user's identity — and puts them back only in the answer", async () => {
    const h = harness({ items: [evidenceItem(1, { excerpt: { text: "Nordjysk Tømrer ApS er nævnt i kilden.", leadIn: null } })] });
    const question = "Kunden Nordjysk Tømrer ApS, CVR 12345678, cpr 010180-1234, anne@firma.dk, tlf. 12345678 — Anne Rådgiver spørger: dækker vi droner?";
    const outcome = await runGateway(ask(question, { caseId: CASE_ID }), h.deps);
    expect(outcome.kind).toBe("answer");
    const sent = JSON.stringify(h.received());
    for (const value of ["12345678", "010180-1234", "anne@firma.dk", "Anne Rådgiver", "u1"]) expect(sent, value).not.toContain(value);
    expect(sent).toContain("[CVR-1]");
    expect(sent).toContain("[CPR-1]");
    expect(sent).toContain("[PERSON-1]");
    expect(h.retrievals[0]!.query).not.toContain("12345678");
    const payload = JSON.stringify(h.records[0]!.payload);
    expect(payload).not.toContain("12345678");
    expect(payload).not.toContain("Anne Rådgiver");
    expect(h.records[0]!.call.redactions).toMatchObject({ cvr: 1, cpr: 1, email: 1, telefon: 1, person: 1, virksomhed: 1 });
    expect(h.records[0]!.call.case_id).toBe(CASE_ID);
  });

  it("re-identifies placeholders in the answer to the user — the log keeps the placeholder", async () => {
    const echo: Model<"development"> = {
      id: "stub",
      version: "1",
      grade: "development",
      async generate(input) {
        const question = input.parts.find((part) => part.kind === "question")!.text;
        const evidence = input.parts.find((part) => part.evidence)!.evidence!.evidenceId;
        return { raw: { kind: "answer", historical: false, paragraphs: [[{ text: `Du spurgte: ${question} ` }, { cite: evidence }]] } };
      },
    };
    const h = harness({ model: echo });
    const outcome = await runGateway(ask("Gælder det for Nordjysk Tømrer ApS?", { caseId: CASE_ID }), h.deps);
    expect(JSON.stringify(outcome)).toContain("Nordjysk Tømrer ApS");
    expect(JSON.stringify(h.records[0]!.payload)).toContain("[VIRKSOMHED-1]");
    expect(JSON.stringify(h.records[0]!.payload)).not.toContain("Nordjysk Tømrer ApS");
  });

  it("removes context keys outside the profile's allowlist and counts them", async () => {
    const h = harness();
    await runGateway(ask("Dækker vi droner?", { productIds: ["p"], secret: "kundens hele sag", notes: "x" }), h.deps);
    expect(JSON.stringify(h.received())).not.toContain("kundens hele sag");
    expect(h.records[0]!.call.removed_fields).toBe(2);
  });

  it("limits the evidence sent to the profile's maximum", async () => {
    const h = harness({ items: Array.from({ length: 9 }, (_, i) => evidenceItem(i + 1)) });
    await runGateway(ask("Dækker vi droner?"), h.deps);
    const parts = h.received()[0]!.parts.filter((part) => part.kind === "evidence");
    expect(parts).toHaveLength(PROFILES.copilot.limits.maxEvidence);
    expect(h.records[0]!.sources.filter((source) => !source.sent)).toHaveLength(1);
  });
});

describe("steps that refuse stop the flow — the model is never called", () => {
  it("insufficient: no evidence → no model call, a knowledge gap with the REDACTED question", async () => {
    const h = harness({ items: [] });
    const outcome = await runGateway(ask("Dækker vi droner for CVR 12345678?"), h.deps);
    expect(outcome.kind).toBe("insufficient");
    expect(h.received()).toHaveLength(0);
    expect(h.records[0]!.payload).toBeNull();
    expect(h.records[0]!.gapQuestion).toBe("Dækker vi droner for CVR [CVR-1]?");
  });

  it("the development tool can force insufficient — and is refused in production", async () => {
    const h = harness();
    const forced = await runGateway(ask("Dækker vi droner?"), h.deps, { forceInsufficient: true });
    expect(forced).toMatchObject({ kind: "insufficient", forced: true });
    const prod = harness();
    prod.deps.environment = "production";
    expect(await runGateway(ask("Dækker vi droner?"), prod.deps, { forceInsufficient: true })).toMatchObject({ kind: "invalid_request" });
    expect(await runGateway(ask("Dækker vi droner?"), prod.deps, { forceUnverifiable: true })).toMatchObject({ kind: "invalid_request" });
  });

  it("blocked_policy when the matrix has no rule for the model (fail-closed)", async () => {
    const h = harness({ rows: [] });
    const outcome = await runGateway(ask("Dækker vi droner?"), h.deps);
    expect(outcome.kind).toBe("blocked_policy");
    expect(h.received()).toHaveLength(0);
    expect(h.records[0]!.call.reason_code).toMatch(/^policy_deny_/);
  });

  it("blocked_policy when knowledge is denied — the part is not silently dropped", async () => {
    const h = harness({ rows: STUB_ROWS.map((row) => (row.category === "knowledge" ? { ...row, rule: "deny" } : row)) });
    const outcome = await runGateway(ask("Dækker vi droner?"), h.deps);
    expect(outcome).toMatchObject({ kind: "blocked_policy", category: "knowledge" });
    expect(h.received()).toHaveLength(0);
  });

  it("denied: not signed in (not logged — no user), missing permission, unknown case, Assessment profile", async () => {
    const anonymous = harness({ user: null });
    expect((await runGateway(ask("x"), anonymous.deps)).kind).toBe("denied");
    expect(anonymous.records).toHaveLength(0);

    const noLearn = harness({ permissions: [] });
    expect((await runGateway({ profile: "learn", action: "explain", input: "Forklar droner" }, noLearn.deps)).kind).toBe("denied");
    expect(noLearn.received()).toHaveLength(0);
    expect(noLearn.records).toHaveLength(1);

    const unknownCase = harness();
    expect(await runGateway(ask("x", { caseId: "22222222-2222-4222-8222-222222222222" }), unknownCase.deps)).toMatchObject({ kind: "denied", message: "Sagen findes ikke." });

    const assessment = harness();
    expect((await runGateway({ profile: "assessment", action: "evaluate", input: "svar" }, assessment.deps)).kind).toBe("denied");
    expect(assessment.received()).toHaveLength(0);
  });

  it("invalid: unknown profile or action, another profile's action, empty or too long input, Advise without a case", async () => {
    const h = harness();
    for (const request of [
      { profile: "copilot", action: "explain", input: "x" },
      { profile: "nope" as ProfileId, action: "x", input: "x" },
      ask(""),
      ask("x".repeat(1001)),
      { profile: "advise", action: "suggest", input: "x" },
    ] as AiRequest[]) {
      expect((await runGateway(request, h.deps)).kind, JSON.stringify(request).slice(0, 60)).toBe("invalid_request");
    }
    expect(h.received()).toHaveLength(0);
  });

  it("retrieval failures are system errors, never insufficient (B-007)", async () => {
    const h = harness({ retrieveError: new RetrievalError("unavailable", "Retrieval er utilgængelig") });
    const outcome = await runGateway(ask("x"), h.deps);
    expect(outcome.kind).toBe("unavailable");
    expect(presentAi(outcome)).toBe("error");
  });

  it("a call that cannot be logged is not shown (fail-closed)", async () => {
    const h = harness({ recordFails: true });
    expect(await runGateway(ask("Dækker vi droner?"), h.deps)).toMatchObject({ kind: "unavailable", message: "Kaldet kunne ikke logges og vises derfor ikke." });
  });

  it("an unavailable model makes the gateway unavailable", async () => {
    const h = harness();
    h.deps.model = () => createModel("stub", "production");
    expect((await runGateway(ask("x"), h.deps)).kind).toBe("unavailable");
  });
});

describe("gating (docs/08 §9, B-015) — enforced in the gateway from the database state", () => {
  const ALL: [ProfileId, string, Record<string, unknown>][] = [
    ["copilot", "answer_question", {}],
    ["learn", "explain", {}],
    ["advise", "suggest", { caseId: CASE_ID }],
    ["practice", "feedback", {}],
    ["practice", "roleplay_turn", { roleplaySessionId: "r1" }],
  ];

  it("an active Assessment locks ALL user-facing AI", async () => {
    for (const [profile, action, context] of ALL) {
      const h = harness({ gating: { assessmentActive: true, roleplaySessionId: null } });
      const outcome = await runGateway({ profile, action, input: "hjælp", context }, h.deps);
      expect(outcome, `${profile}.${action}`).toEqual({ kind: "locked", reason: "assessment_active" });
      expect(h.received()).toHaveLength(0);
      expect(h.records[0]!.call.outcome).toBe("locked");
    }
  });

  it("an active roleplay locks all AI except the roleplay itself", async () => {
    for (const [profile, action, context] of ALL) {
      const h = harness({ gating: { assessmentActive: false, roleplaySessionId: "r1" } });
      const outcome = await runGateway({ profile, action, input: "hjælp", context }, h.deps);
      if (profile === "practice" && action === "roleplay_turn") expect(outcome.kind).toBe("answer");
      else expect(outcome, `${profile}.${action}`).toEqual({ kind: "locked", reason: "roleplay_active" });
    }
    const other = harness({ gating: { assessmentActive: false, roleplaySessionId: "r1" } });
    expect(await runGateway({ profile: "practice", action: "roleplay_turn", input: "hej", context: { roleplaySessionId: "r2" } }, other.deps)).toEqual({
      kind: "locked",
      reason: "roleplay_active",
    });
  });

  it("an unreadable state is a system error, never insufficient", async () => {
    const h = harness({ gating: "error" });
    const outcome = await runGateway(ask("x"), h.deps);
    expect(outcome.kind).toBe("unavailable");
    expect(h.received()).toHaveLength(0);
  });

  it("decideGating covers every rule", () => {
    const free = { assessmentActive: false, roleplaySessionId: null };
    expect(decideGating("copilot", "answer_question", free)).toEqual({ allowed: true });
    expect(decideGating("practice", "roleplay_turn", free)).toMatchObject({ allowed: false, kind: "invalid_request" });
    expect(decideGating("learn", "explain", { assessmentActive: false, roleplaySessionId: "r" })).toMatchObject({ reason: "roleplay_active" });
    expect(decideGating("practice", "roleplay_turn", { assessmentActive: true, roleplaySessionId: "r" }, "r")).toMatchObject({ reason: "assessment_active" });
  });
});

describe("output contracts — a breach is never shown (B-016)", () => {
  const breaking = async (behaviour: "uncited" | "unknown_citation" | "missing_historical" | "unflagged_conflict", items: EvidenceItem[]) => {
    const { createContractBreakingStub } = await import("@/lib/ai/core/registry");
    const h = harness({ items, model: createContractBreakingStub("test", behaviour) });
    return { outcome: await runGateway(ask("Dækker vi droner?"), h.deps), h };
  };

  it.each([
    ["uncited", [evidenceItem(1)], "uncited_paragraph"],
    ["unknown_citation", [evidenceItem(1)], "unknown_citation"],
    ["missing_historical", [evidenceItem(1, { validity: { validFrom: "2023-01-01", validTo: "2024-01-01", temporalStatus: "historical" } })], "missing_historical_marker"],
    ["unflagged_conflict", [evidenceItem(1, { conflicts: [{ visibility: "visible", conflictId: "c", status: "open", counterpartEvidenceId: "e2" }] }), evidenceItem(2)], "conflict_not_flagged"],
  ] as const)("%s → unverifiable with the found sources and no model text", async (behaviour, items, reason) => {
    const { outcome, h } = await breaking(behaviour, [...items]);
    expect(outcome).toMatchObject({ kind: "unverifiable", reason });
    if (outcome.kind !== "unverifiable") return;
    expect(outcome.evidence.length).toBeGreaterThan(0);
    expect(JSON.stringify(outcome)).not.toContain("En påstand uden kilde");
    expect(presentAi(outcome)).toBe("unverifiable");
    expect(h.records[0]!.call).toMatchObject({ outcome: "unverifiable", reason_code: reason });
    expect(h.records[0]!.payload?.returned).toBeTruthy();
  });

  it("the development tool forces unverifiable in local/test", async () => {
    const h = harness();
    expect((await runGateway(ask("Dækker vi droner?"), h.deps, { forceUnverifiable: true })).kind).toBe("unverifiable");
  });

  it("validates the other profiles' contracts", () => {
    const parts = [{ kind: "evidence" as const, category: "knowledge" as const, text: "x", evidence: { evidenceId: "e1", label: "L", temporalStatus: "current" as const, inConflict: false } }];
    expect(validateOutput(CONTRACTS.learnExplain, { paragraphs: [[{ text: "a" }, { cite: "e1" }]], examples: [{ text: "x", fictional: false }] }, parts)).toEqual({ ok: false, reason: "example_not_marked" });
    expect(validateOutput(CONTRACTS.practiceTurn, { reply: "hej", cite: "e1" }, parts)).toEqual({ ok: false, reason: "unexpected_citation" });
    expect(validateOutput(CONTRACTS.adviseSuggest, { suggestions: [{ status: "final", segments: [{ cite: "e1" }] }] }, parts)).toEqual({ ok: false, reason: "malformed" });
    expect(validateOutput(CONTRACTS.assessmentEvaluate, { criteria: [{ criterion: "c", verdict: "met", cites: [] }] }, parts)).toEqual({ ok: false, reason: "uncited_paragraph" });
    expect(validateOutput(CONTRACTS.copilotAnswer, "not json", parts)).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("the four states can never look alike (presentAi)", () => {
  it("maps each outcome to exactly one presentation", () => {
    const outcomes: [AiOutcome, string][] = [
      [{ kind: "insufficient", profile: "copilot", grade: "development", evidence: [], forced: false }, "insufficient"],
      [{ kind: "unverifiable", profile: "copilot", reason: "uncited_paragraph", evidence: [] }, "unverifiable"],
      [{ kind: "unavailable", message: "x" }, "error"],
      [{ kind: "locked", reason: "assessment_active" }, "locked"],
      [{ kind: "blocked_policy", category: "knowledge", message: "x" }, "blocked"],
    ];
    for (const [outcome, presentation] of outcomes) expect(presentAi(outcome)).toBe(presentation);
  });
});

describe("redaction (docs/08 §7)", () => {
  const redact = (text: string, names: { type: "virksomhed" | "person"; value: string }[] = []) => createRedactor(names).redact(text);

  it("finds the identifiers it is meant to find", () => {
    expect(redact("cpr 010180-1234 og 3112991234")).toBe("cpr [CPR-1] og [CPR-2]");
    expect(redact("CVR 12 34 56 78, cvr-nr.: 87654321")).toBe("CVR [CVR-1], cvr-nr.: [CVR-2]");
    expect(redact("skriv til a.b-c@firma.dk")).toBe("skriv til [EMAIL-1]");
    expect(redact("ring +45 12 34 56 78 eller 87 65 43 21 eller tlf. 11223344")).toBe("ring [TELEFON-1] eller [TELEFON-2] eller tlf. [TELEFON-3]");
    expect(redact("konto 1234-1234567890 og DK50 0040 0440 1162 43")).toBe("konto [KONTO-1] og [KONTO-2]");
    expect(redact("Nordjysk Tømrer ApS og nordjysk tømrer aps", [{ type: "virksomhed", value: "Nordjysk Tømrer ApS" }])).toBe("[VIRKSOMHED-1] og [VIRKSOMHED-1]");
  });

  it("does not hit amounts, section references, dates or 8-digit numbers without CVR", () => {
    for (const text of [
      "Omsætning på 25.000.000 kr. og 12345678 kr.",
      "Se § 4.2 og pkt. 12.3.1",
      "Gældende fra 01-01-2024 til 31.12.2025",
      "Policenummer 12345678",
      "Selvrisiko 10 000 kr. og 2.500 kr.",
      "Antal ansatte: 40, omsætning 120 mio.",
    ]) {
      expect(redact(text), text).toBe(text);
    }
  });

  it("an invalid date is not a CPR number", () => {
    expect(redact("nummer 3213991234")).toBe("nummer 3213991234");
  });

  it("re-identifies only known placeholders", () => {
    const redactor = createRedactor();
    const text = redactor.redact("cpr 010180-1234");
    expect(reidentify(`${text} og [CPR-9]`, redactor.mapping)).toBe("cpr 010180-1234 og [CPR-9]");
  });
});

describe("the matrix (docs/08 §5) is fail-closed", () => {
  it("missing rows are deny, audit_access is always deny, and a profile only narrows", () => {
    const matrix = buildMatrix([...STUB_ROWS, { model_id: "stub", category: "audit_access", rule: "allow" }, { model_id: "other", category: "knowledge", rule: "allow" }], "stub");
    expect(effectiveRule(matrix, "audit_access", ["audit_access"])).toBe("deny");
    expect(effectiveRule(buildMatrix([], "stub"), "knowledge", ["knowledge"])).toBe("deny");
    expect(effectiveRule(matrix, "knowledge", ["knowledge"])).toBe("allow");
    expect(effectiveRule(matrix, "learning", ["knowledge"])).toBe("deny");
    expect(effectiveRule(buildMatrix([{ model_id: "stub", category: "knowledge", rule: "maybe" }], "stub"), "knowledge", ["knowledge"])).toBe("deny");
  });

  it("no profile may send customer data or audit data in phase 8", () => {
    for (const profile of Object.values(PROFILES)) {
      expect(profile.categories).not.toContain("customer_identifiable");
      expect(profile.categories).not.toContain("audit_access");
    }
  });
});
