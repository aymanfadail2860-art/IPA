import fs from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { configurationActions, operationsView, RUNS_PER_CONFIGURATION, type OperationsConfiguration, type OperationsRows } from "@/lib/knowledge/operations-view";

/**
 * 8B-I8 C2 — Drift af retrieval in Admin: the human decisions of the 8B lifecycle as server
 * actions over the existing database functions. Each needs system.settings.manage, an explicit
 * confirmation and a justification where the database takes one; nothing writes a table, and
 * nothing can submit an evaluation result (the publisher's functions are not reachable).
 */

const state = vi.hoisted(() => ({
  demo: false,
  authorized: true,
  calls: [] as { schema: string; fn: string; args: Record<string, unknown> }[],
  tables: [] as string[],
  error: null as { code?: string; message: string } | null,
  revalidated: [] as string[],
}));

vi.mock("@/dev/demo/demo-mode", () => ({ isDemoMode: () => state.demo }));
vi.mock("@/lib/auth/server-session", () => ({ authorize: async (requirement: unknown) => (state.authorized ? { requirement } : null) }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => state.revalidated.push(p) }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    schema: (schema: string) => ({
      rpc: async (fn: string, args: Record<string, unknown>) => {
        state.calls.push({ schema, fn, args });
        return { data: null, error: state.error };
      },
      from: (table: string) => {
        state.tables.push(table);
        throw new Error("no table access from the operations actions");
      },
    }),
  }),
}));

const actions = await import("@/lib/knowledge/operations-actions");

const ID = "c2000000-0000-4000-8000-000000000001";
const RUN = "c2000000-0000-4000-8000-000000000002";
const JUSTIFICATION = "Pilotens usikkerhed er gennemgået af fagansvarlig og accepteret.";

beforeEach(() => {
  state.demo = false;
  state.authorized = true;
  state.calls.length = 0;
  state.tables.length = 0;
  state.error = null;
  state.revalidated.length = 0;
});

type Case = { name: string; run: () => Promise<{ ok: boolean }>; fn: string; args: Record<string, unknown> };

const CASES: Case[] = [
  { name: "approveGateSet", run: () => actions.approveGateSet({ confirmed: true, gateSetId: ID }), fn: "approve_evaluation_gate_set", args: { p_gate_set_id: ID } },
  {
    name: "acceptUncertainty",
    run: () => actions.acceptUncertainty({ confirmed: true, runId: RUN, justification: `  ${JUSTIFICATION}  ` }),
    fn: "accept_evaluation_uncertainty",
    args: { p_run_id: RUN, p_justification: JUSTIFICATION },
  },
  {
    name: "approveConfiguration",
    run: () => actions.approveConfiguration({ confirmed: true, configurationId: ID, runId: RUN, rootCauseNotes: ["Kendt afvigelse i fixture-teksten."] }),
    fn: "approve_retrieval_configuration",
    args: { p_configuration_id: ID, p_run_id: RUN, p_root_cause_notes: ["Kendt afvigelse i fixture-teksten."] },
  },
  { name: "activateConfiguration", run: () => actions.activateConfiguration({ confirmed: true, configurationId: ID }), fn: "activate_retrieval_configuration", args: { p_configuration_id: ID } },
  {
    name: "suspendConfiguration",
    run: () => actions.suspendConfiguration({ confirmed: true, configurationId: ID, reason: "Udbyderen svarer forkert." }),
    fn: "suspend_retrieval_configuration",
    args: { p_configuration_id: ID, p_reason: "Udbyderen svarer forkert." },
  },
  {
    name: "retireConfiguration",
    run: () => actions.retireConfiguration({ confirmed: true, configurationId: ID, reason: "Erstattet af ny kandidat." }),
    fn: "retire_retrieval_configuration",
    args: { p_configuration_id: ID, p_reason: "Erstattet af ny kandidat." },
  },
  {
    name: "acceptPerformanceDeviation",
    run: () => actions.acceptPerformanceDeviation({ confirmed: true, measurementId: ID, justification: JUSTIFICATION }),
    fn: "accept_performance_deviation",
    args: { p_measurement_id: ID, p_justification: JUSTIFICATION },
  },
  { name: "requestReembedding", run: () => actions.requestReembedding({ confirmed: true, modelId: ID }), fn: "request_reembedding", args: { p_model_id: ID } },
];

describe("each action calls exactly its database function as the signed-in user", () => {
  for (const { name, run, fn, args } of CASES) {
    it(name, async () => {
      expect(await run()).toEqual({ ok: true });
      expect(state.calls).toEqual([{ schema: "knowledge", fn, args }]);
      expect(state.tables).toEqual([]);
      expect(state.revalidated).toEqual(["/admin/settings"]);
    });
  }

  it("the database's refusal reaches the user; a missing permission in the database is 'no access'", async () => {
    state.error = { code: "23514", message: "Afvist (scope): korpusset indeholder dokumenttyper, kørslen ikke evaluerede" };
    expect(await actions.activateConfiguration({ confirmed: true, configurationId: ID })).toEqual({ ok: false, error: state.error.message });
    state.error = { code: "42501", message: "permission denied" };
    expect(await actions.activateConfiguration({ confirmed: true, configurationId: ID })).toEqual({ ok: false, error: "Du har ikke adgang til denne handling." });
    state.error = { code: "XX000", message: "internal detail" };
    const result = await actions.activateConfiguration({ confirmed: true, configurationId: ID });
    expect(result).toEqual({ ok: false, error: "Konfigurationen kunne ikke aktiveres." });
  });
});

describe("refused before the database", () => {
  it("without system.settings.manage", async () => {
    state.authorized = false;
    for (const { name, run } of CASES) expect(await run(), name).toEqual({ ok: false, error: "Du har ikke adgang til denne handling." });
    expect(state.calls).toEqual([]);
  });

  it("in the demo without a database", async () => {
    state.demo = true;
    for (const { name, run } of CASES) expect((await run()).ok, name).toBe(false);
    expect(state.calls).toEqual([]);
  });

  it("without an explicit confirmation", async () => {
    const unconfirmed = { confirmed: false } as unknown as { confirmed: true };
    const results = await Promise.all([
      actions.approveGateSet({ ...unconfirmed, gateSetId: ID }),
      actions.activateConfiguration({ ...unconfirmed, configurationId: ID }),
      actions.suspendConfiguration({ ...unconfirmed, configurationId: ID, reason: "Udbyderen svarer forkert." }),
      actions.requestReembedding({ ...unconfirmed, modelId: ID }),
      actions.acceptUncertainty({ configurationId: ID, runId: RUN, justification: JUSTIFICATION } as never),
    ]);
    for (const result of results) expect(result).toEqual({ ok: false, error: "Handlingen er ikke bekræftet." });
    expect(state.calls).toEqual([]);
  });

  it("without the justification the database requires (same minimums)", async () => {
    const results = await Promise.all([
      actions.acceptUncertainty({ confirmed: true, runId: RUN, justification: "for kort" }),
      actions.acceptPerformanceDeviation({ confirmed: true, measurementId: ID, justification: "                         " }),
      actions.suspendConfiguration({ confirmed: true, configurationId: ID, reason: "kort" }),
      actions.retireConfiguration({ confirmed: true, configurationId: ID, reason: "" }),
      actions.approveConfiguration({ confirmed: true, configurationId: ID, runId: RUN, rootCauseNotes: ["ok note her", "kort"] }),
      actions.acceptUncertainty({ confirmed: true, runId: RUN, justification: "x".repeat(2001) }),
    ]);
    for (const result of results) expect(result.ok).toBe(false);
    expect(state.calls).toEqual([]);
  });

  it("with an id that is not a uuid", async () => {
    expect(await actions.activateConfiguration({ confirmed: true, configurationId: "1 or 1=1" })).toEqual({ ok: false, error: "Findes ikke." });
    expect(await actions.approveConfiguration({ confirmed: true, configurationId: ID, runId: "x", rootCauseNotes: [] })).toEqual({ ok: false, error: "Findes ikke." });
    expect(state.calls).toEqual([]);
  });
});

describe("guardrails", () => {
  const root = path.resolve(__dirname, "../..");
  const source = fs.readFileSync(path.join(root, "src/lib/knowledge/operations-actions.ts"), "utf8");

  it("the actions are server actions that only call the lifecycle functions — never a table", () => {
    expect(source).toMatch(/^"use server";/);
    expect(source).not.toMatch(/\.from\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
    expect(source).not.toMatch(/service_role|SERVICE_ROLE/i);
    const called = [...source.matchAll(/call\(\s*"([a-z_]+)"/g)].map((match) => match[1]).sort();
    expect(called).toEqual(CASES.map((entry) => entry.fn).sort());
    expect(source.match(/await guard\(input\)/g)).toHaveLength(CASES.length);
  });

  it("no application code can reach the evaluation publisher's functions (an administrator cannot fabricate a result)", () => {
    const walk = (dir: string): string[] =>
      fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) return rel === "src/tests" ? [] : walk(rel);
        return /\.(ts|tsx)$/.test(entry.name) ? [rel] : [];
      });
    const offenders = walk("src").filter((file) =>
      /record_evaluation_run|register_evaluation_gate_set|record_performance_measurement|publish_evaluation_run|evaluation_publisher/.test(fs.readFileSync(path.join(root, file), "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});

describe("the view (what waits for a person)", () => {
  const rows = (): OperationsRows => ({
    gateSets: [
      { id: "g1", gate_set_id: "gates", version: 1, decision: "B-030", checksum: "a".repeat(64), registered_at: "2026-10-01T00:00:00Z", approved_at: "2026-10-02T00:00:00Z" },
      { id: "g2", gate_set_id: "gates", version: 2, decision: "B-033", checksum: "b".repeat(64), registered_at: "2026-10-03T00:00:00Z", approved_at: null },
    ],
    configurations: [
      { id: "c1", label: "bedrock", version: 1, fingerprint: "f".repeat(64), status: "candidate", tier: null, status_changed_at: "2026-10-01T00:00:00Z", suspension_reason: null },
      { id: "c2", label: "old", version: 1, fingerprint: "e".repeat(64), status: "bogus", tier: null, status_changed_at: "2026-10-01T00:00:00Z", suspension_reason: null },
    ],
    runs: Array.from({ length: RUNS_PER_CONFIGURATION + 2 }, (_, i) => ({
      id: `r${i}`,
      run_id: `run-${i}`,
      configuration_id: "c1",
      gate_set_id: i === 0 ? "g2" : "g1",
      outcome: i === 0 ? "pass_with_uncertainty" : "fail",
      tier: "pilot",
      registered_at: `2026-10-0${i + 1}T00:00:00Z`,
      registered_while: "candidate",
      failures: [{ gate: "Q1", caseId: "case-1", explanation: "x".repeat(400), rootCauseNote: null }],
    })),
    acceptedRuns: [],
    measurements: [
      { id: "m1", measurement_id: "perf-1", configuration_id: "c1", deviations: ["query_embedding_p95"], measured_at: "2026-10-04T00:00:00Z" },
      { id: "m2", measurement_id: "perf-2", configuration_id: "c1", deviations: [], measured_at: "2026-10-04T00:00:00Z" },
    ],
    acceptedMeasurements: ["m1"],
    models: [
      { id: "e1", label: "aws-bedrock:cohere.embed-v4:0@eu-1024-v1", status: "candidate", embeddings: 3, publishedChunks: 0 } as never,
      { id: "e2", label: "test:test-hash-embedder@1", status: "active", embeddings: 9 },
    ],
    publishedChunks: 9,
  });

  it("shows pending gate sets first, the newest runs per configuration and only open deviations and candidate models", () => {
    const view = operationsView(rows());
    expect(view.gateSets.map((gate) => [gate.label, gate.approved])).toEqual([
      ["gates v2", false],
      ["gates v1", true],
    ]);
    expect(view.configurations.map((configuration) => configuration.id)).toEqual(["c1"]);
    const runs = view.configurations[0]!.runs;
    expect(runs).toHaveLength(RUNS_PER_CONFIGURATION);
    expect(runs[0]!.runId).toBe("run-6");
    expect(runs.find((run) => run.id === "r0")).toBeUndefined();
    expect(runs[0]!.failures[0]!.explanation).toHaveLength(300);
    expect(view.measurements).toEqual([{ id: "m1", measurementId: "perf-1", configurationLabel: "bedrock v1", deviations: ["query_embedding_p95"], measuredAt: "2026-10-04T00:00:00Z", accepted: true }]);
    expect(view.candidateModels).toEqual([{ id: "e1", label: "aws-bedrock:cohere.embed-v4:0@eu-1024-v1", embeddings: 3, publishedChunks: 9 }]);
  });

  it("offers only the decisions the status allows; approval needs a passed (or accepted) run", () => {
    const base: OperationsConfiguration = { id: "c", label: "c", version: 1, fingerprint: "f", status: "candidate", tier: null, statusChangedAt: "", suspensionReason: null, runs: [] };
    const run = (outcome: "pass" | "pass_with_uncertainty" | "fail", accepted = false) => ({
      id: "r",
      runId: "r",
      outcome,
      tier: "pilot" as const,
      registeredAt: "",
      registeredWhile: "candidate",
      gateSetApproved: true,
      uncertaintyAccepted: accepted,
      failures: [],
    });
    expect(configurationActions(base)).toEqual({ approve: false, activate: false, suspend: false, retire: true });
    expect(configurationActions({ ...base, runs: [run("fail")] }).approve).toBe(false);
    expect(configurationActions({ ...base, runs: [run("pass_with_uncertainty")] }).approve).toBe(false);
    expect(configurationActions({ ...base, runs: [run("pass_with_uncertainty", true)] }).approve).toBe(true);
    expect(configurationActions({ ...base, runs: [run("pass")] }).approve).toBe(true);
    expect(configurationActions({ ...base, status: "approved" })).toEqual({ approve: false, activate: true, suspend: false, retire: true });
    expect(configurationActions({ ...base, status: "active", runs: [run("pass")] })).toEqual({ approve: false, activate: false, suspend: true, retire: false });
    expect(configurationActions({ ...base, status: "suspended", runs: [run("pass")] })).toEqual({ approve: true, activate: false, suspend: false, retire: true });
    expect(configurationActions({ ...base, status: "retired" })).toEqual({ approve: false, activate: false, suspend: false, retire: false });
  });
});
