import type { SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { runGateway, type AiCallLogEntry, type GatewayDeps } from "@/lib/ai/core/gateway-core";
import { MODEL_CALL_MESSAGES, UsageLimitError } from "@/lib/ai/core/usage";
import { createGatewayDbDeps } from "@/lib/ai/gateway-deps";
import { createAnthropicModel } from "@/lib/ai/providers/anthropic/model";
import { createAnthropicTransport } from "@/lib/ai/providers/anthropic/transport";
import { createUsageLedger } from "@/lib/ai/usage-ledger";
import type { PermissionKey, PermissionScope } from "@/lib/auth/permissions";

import { FAKE_API_KEY, fakeAnthropic, type FakeReply } from "../fixtures/fake-anthropic";

import { integrationConfigured, signedInClient, type SeedUserKey } from "./helpers";

/**
 * Beta L4 — the usage limits in the REAL database (docs/beta.md §16.7–§16.8), through the real
 * gateway pipeline, the real ledger (ai.reserve_usage …) and the Claude adapter with a FAKE
 * transport. No network, no key, no paid call. A fictional model id is approved with fictional
 * prices for the test and removed afterwards; the limits are restored after each test.
 *
 * The test rig's LOCAL database owner reads and removes the test's own rows (the users cannot —
 * that is the point); IPA_TEST_DB_ADMIN_URL must point at 127.0.0.1/localhost.
 */

const MODEL = "claude-fake-l4-integration";
const ROWS = [
  ["knowledge", "allow"],
  ["user_question", "allow_redacted"],
  ["learning", "allow"],
  ["training_fictional", "allow"],
  ["customer_identifiable", "deny"],
  ["audit_access", "deny"],
] as const;

const adminUrl = process.env.IPA_TEST_DB_ADMIN_URL ?? "";
const configured = integrationConfigured && Boolean(adminUrl) && /@(127\.0\.0\.1|localhost):/.test(adminUrl);
let db: postgres.Sql;

let originalLimits: Record<string, unknown>;

async function setLimits(limits: Record<string, number>) {
  const admin = await signedInClient("admin");
  const { error } = await admin.schema("ai").rpc("set_usage_limits", { p_limits: limits });
  if (error) throw error;
}

async function reservations(): Promise<Record<string, unknown>[]> {
  return db`select * from ai.usage_reservations where model_id = ${MODEL} order by created_at, attempts`;
}

/** The real pipeline as a seed user, with the Claude adapter on a fake transport. */
async function gatewayAs(key: SeedUserKey, replies: FakeReply[] = [], count?: number) {
  const client = await signedInClient(key);
  const fake = fakeAnthropic({ replies, count });
  const transport = createAnthropicTransport({ modelId: MODEL, apiKey: FAKE_API_KEY, timeoutMs: 200, fetch: fake.fetch });
  const model = createAnthropicModel({ config: { modelId: MODEL, apiKey: FAKE_API_KEY, effort: null }, transport, sleep: async () => {} });
  const { data: me } = await client.schema("identity").rpc("current_user_id");
  const { data: permissions } = await client.schema("identity").rpc("my_permissions");
  const grants = (permissions ?? []) as { permission: string; scope: string }[];
  const logs: AiCallLogEntry[] = [];
  const deps: GatewayDeps = {
    ...createGatewayDbDeps(client),
    user: async () => ({ id: me as string, name: "Integrationstest" }),
    hasPermission: async (permission: PermissionKey, scope?: PermissionScope) => grants.some((g) => g.permission === permission && (!scope || g.scope === scope)),
    retrieve: async () => {
      throw new Error("Ingen retrieval i rollespillet");
    },
    model: () => model,
    usage: createUsageLedger(client),
    log: (entry) => void logs.push(entry),
    environment: "production",
  };
  return { client, deps, fake, logs };
}

async function startRoleplay(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.schema("practice").rpc("start_roleplay");
  if (error) throw error;
  return data as string;
}

const turn = (session: string) => ({ profile: "practice" as const, action: "roleplay_turn", input: "Goddag, jeg ringer om jeres erhvervsforsikring.", context: { roleplaySessionId: session } });
const roleplayReply: FakeReply = { kind: "message", content: [{ type: "text", text: "Goddag. Jeg er en fiktiv kunde." }], usage: { input_tokens: 900, output_tokens: 40 } };

describe.skipIf(!configured)("AI usage limits in the database (beta L4)", () => {
  const sessions: [SupabaseClient, string][] = [];

  beforeAll(async () => {
    db = postgres(adminUrl, { max: 2, onnotice: () => {} });
    const admin = await signedInClient("admin");
    const ai = admin.schema("ai");
    const { data, error } = await ai.from("usage_limits").select("*").single();
    if (error) throw error;
    originalLimits = data as Record<string, unknown>;
    await db`delete from ai.usage_reservations where model_id = ${MODEL}`;
    const price = await ai.rpc("set_model_price", {
      p_model_id: MODEL, p_provider: "anthropic", p_input: 4, p_output: 20, p_cache_write: 5, p_cache_read: 0.4,
      p_context_window: 1_000_000, p_max_output: 128_000, p_price_input_token_limit: null,
      p_verified_source: "integrationstest (fiktive priser)", p_verified_on: "2026-10-14", p_active: true,
    });
    if (price.error) throw price.error;
    for (const [category, rule] of ROWS) {
      const { error: ruleError } = await ai.rpc("set_data_category_rule", { p_model_id: MODEL, p_category: category, p_rule: rule });
      if (ruleError) throw ruleError;
    }
  });

  afterEach(async () => {
    const keys = ["max_input_tokens", "max_output_tokens", "user_calls_per_minute", "user_calls_per_day", "global_calls_per_minute", "user_active_calls", "global_active_calls", "global_daily_budget_usd", "global_monthly_budget_usd", "user_daily_budget_usd", "reservation_ttl_seconds", "max_attempts"];
    await setLimits(Object.fromEntries(keys.map((key) => [key, Number(originalLimits[key])])));
    for (const [client, id] of sessions.splice(0)) await client.schema("practice").rpc("end_roleplay", { p_id: id });
    await db`delete from ai.usage_reservations where model_id = ${MODEL}`;
  });

  // Test rig only: the fictional model and its rows go again (no delete policy exists for them).
  afterAll(async () => {
    if (!db) return;
    await db`delete from ai.usage_reservations where model_id = ${MODEL}`;
    await db`delete from ai.data_category_policy where model_id = ${MODEL}`;
    await db`delete from ai.model_prices where model_id = ${MODEL}`;
    await db.end();
  });

  it("a roleplay turn passes the gateway, reserves, counts, answers and settles at the actual cost", async () => {
    const { client, deps, fake, logs } = await gatewayAs("advisorA", [roleplayReply]);
    const session = await startRoleplay(client);
    sessions.push([client, session]);
    const outcome = await runGateway(turn(session), deps);
    expect(outcome).toMatchObject({ kind: "answer", output: { reply: "Goddag. Jeg er en fiktiv kunde." } });
    expect(fake.counts()).toHaveLength(1);
    expect(fake.messages()).toHaveLength(1);
    const [row] = await reservations();
    expect(row).toMatchObject({ status: "settled", attempts: 1, input_tokens: 900, output_tokens: 40, profile_id: "practice", action: "roleplay_turn" });
    expect(Number(row!.reserved_cost_usd)).toBeCloseTo(0.46, 8);
    expect(Number(row!.actual_cost_usd)).toBeCloseTo((900 * 4 + 40 * 20) / 1_000_000, 10);
    expect(logs[0]).toMatchObject({ outcome: "answer", usage: { status: "settled" }, budgetStatus: "ok" });
  });

  it("the user's rate limit: the fourth turn within the minute is refused by the database — nothing sent", async () => {
    const { client, deps, fake } = await gatewayAs("advisorB", Array.from({ length: 4 }, () => roleplayReply));
    const session = await startRoleplay(client);
    sessions.push([client, session]);
    const kinds: string[] = [];
    for (let i = 0; i < 4; i++) kinds.push((await runGateway(turn(session), deps)).kind);
    expect(kinds).toEqual(["answer", "answer", "answer", "unavailable"]);
    expect(fake.messages()).toHaveLength(3);
    expect((await reservations()).map((row) => row.status)).toEqual(["settled", "settled", "settled"]);
  });

  it("the global rate limit holds across users", async () => {
    await setLimits({ global_calls_per_minute: 2 });
    const outcomes: string[] = [];
    for (const key of ["advisorA", "advisorB", "advisorC"] as const) {
      const { client, deps } = await gatewayAs(key, [roleplayReply]);
      const session = await startRoleplay(client);
      sessions.push([client, session]);
      const outcome = await runGateway(turn(session), deps);
      outcomes.push(outcome.kind === "unavailable" ? outcome.message : outcome.kind);
    }
    expect(outcomes).toEqual(["answer", "answer", MODEL_CALL_MESSAGES.rate_limit]);
  });

  it("concurrent reservations from many users cannot pass the global daily budget (one transaction, one lock)", async () => {
    // 0.46 USD per reservation: 1.00 admits exactly two, whatever the interleaving.
    await setLimits({ global_daily_budget_usd: 1, global_active_calls: 10, global_calls_per_minute: 100 });
    const users = ["advisorA", "advisorB", "advisorC", "leaderNord", "leaderSyd", "admin"] as const;
    const ledgers = await Promise.all(users.map(async (key) => createUsageLedger(await signedInClient(key))));
    const results = await Promise.allSettled(
      ledgers.map((ledger) => ledger.reserve({ requestId: crypto.randomUUID(), modelId: MODEL, profileId: "copilot", action: "answer_question", maxOutputTokens: 3000, cacheWrites: false })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    const refusals = results.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => (r.reason as UsageLimitError).code);
    expect(refusals).toEqual(["budget_global_day", "budget_global_day", "budget_global_day", "budget_global_day"]);
    expect(await reservations()).toHaveLength(2);
  });

  it("concurrent calls by one user: one active call, the rest refused", async () => {
    await setLimits({ user_calls_per_minute: 100 });
    const ledger = createUsageLedger(await signedInClient("advisorC"));
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => ledger.reserve({ requestId: crypto.randomUUID(), modelId: MODEL, profileId: "copilot", action: "answer_question", maxOutputTokens: 3000, cacheWrites: false })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => (r.reason as UsageLimitError).code)).toEqual(["active_user", "active_user", "active_user", "active_user"]);
  });

  it("retries run under the one reservation and stop at the database's attempt limit", async () => {
    await setLimits({ max_attempts: 2 });
    const { client, deps, fake } = await gatewayAs("advisorA", [{ kind: "error", status: 529 }, { kind: "error", status: 529 }, roleplayReply]);
    const session = await startRoleplay(client);
    sessions.push([client, session]);
    expect((await runGateway(turn(session), deps)).kind).toBe("unavailable");
    expect(fake.messages()).toHaveLength(2);
    expect(await reservations()).toEqual([expect.objectContaining({ status: "released", attempts: 2, outcome_code: "provider_overloaded" })]);
  });

  it("a timeout keeps the reservation in full (uncertain) — and it counts against the next call's budget", async () => {
    await setLimits({ user_daily_budget_usd: 0.9 });
    const { client, deps, fake } = await gatewayAs("advisorB", [{ kind: "hang" }, roleplayReply, roleplayReply]);
    const session = await startRoleplay(client);
    sessions.push([client, session]);
    expect(await runGateway(turn(session), deps)).toEqual({ kind: "unavailable", message: MODEL_CALL_MESSAGES.provider_uncertain });
    expect(await reservations()).toEqual([expect.objectContaining({ status: "uncertain", outcome_code: "provider_timeout" })]);
    // 0.46 is still counted: another 0.46 would exceed 0.90.
    expect(await runGateway(turn(session), deps)).toEqual({ kind: "unavailable", message: MODEL_CALL_MESSAGES.budget });
    expect(fake.messages()).toHaveLength(1);
  });

  it("over the input ceiling by the provider's count: released, the message never sent", async () => {
    const { client, deps, fake } = await gatewayAs("advisorC", [roleplayReply], 100_001);
    const session = await startRoleplay(client);
    sessions.push([client, session]);
    expect((await runGateway(turn(session), deps)).kind).toBe("invalid_request");
    expect(fake.messages()).toHaveLength(0);
    expect(await reservations()).toEqual([expect.objectContaining({ status: "released", counted_input_tokens: 100001, outcome_code: "input_token_budget_exceeded" })]);
  });

  it("a model without an approved price is refused by the database before anything is sent", async () => {
    const ledger = createUsageLedger(await signedInClient("advisorA"));
    await expect(ledger.reserve({ requestId: crypto.randomUUID(), modelId: "claude-not-approved", profileId: "copilot", action: "answer_question", maxOutputTokens: 3000, cacheWrites: false })).rejects.toMatchObject({ code: "model_not_approved" });
  });

  it("a user cannot read, settle or release the gateway's reservations, nor raise the limits", async () => {
    const owner = createUsageLedger(await signedInClient("advisorA"));
    const reservation = await owner.reserve({ requestId: crypto.randomUUID(), modelId: MODEL, profileId: "copilot", action: "answer_question", maxOutputTokens: 3000, cacheWrites: false });
    const other = await signedInClient("advisorB");
    expect((await other.schema("ai").from("usage_reservations").select("id")).error).not.toBeNull();
    const settle = await other.schema("ai").rpc("settle_usage", { p_reservation: reservation.id, p_token: reservation.token, p_counted_input_tokens: 1, p_input_tokens: 1, p_output_tokens: 1, p_cache_creation_input_tokens: 0, p_cache_read_input_tokens: 0, p_outcome_code: "x" });
    expect(settle.error?.message).toBe("ai_limit:reservation_unknown");
    const forged = await (await signedInClient("advisorA")).schema("ai").rpc("release_usage", { p_reservation: reservation.id, p_token: "gættet", p_counted_input_tokens: null, p_outcome_code: "x" });
    expect(forged.error?.message).toBe("ai_limit:reservation_unknown");
    const raise = await other.schema("ai").rpc("set_usage_limits", { p_limits: { user_daily_budget_usd: 1000 } });
    expect(raise.error?.code).toBe("42501");
    expect((await reservations())[0]).toMatchObject({ status: "pending" });
  });
});
