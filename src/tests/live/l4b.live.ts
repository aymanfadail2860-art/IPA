import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createEvaluationPublisher, sqlPublisherConnection } from "../../../evals/engine/publication.ts";
import { runGateway, type AiCallLogEntry, type GatewayDeps } from "@/lib/ai/core/gateway-core";
import type { Model } from "@/lib/ai/core/model";
import { createModel } from "@/lib/ai/core/registry";
import type { AiRequest } from "@/lib/ai/core/types";
import { createGatewayDbDeps } from "@/lib/ai/gateway-deps";
import type { AiOutcome } from "@/lib/ai/outcome";
import { ANTHROPIC_TIMEOUT_MS, readAnthropicConfig } from "@/lib/ai/providers/anthropic/config";
import { createAnthropicModel } from "@/lib/ai/providers/anthropic/model";
import { configuredAnthropicModel } from "@/lib/ai/providers/anthropic/server";
import { createAnthropicTransport } from "@/lib/ai/providers/anthropic/transport";
import { createUsageLedger } from "@/lib/ai/usage-ledger";
import type { PermissionKey, PermissionScope } from "@/lib/auth/permissions";
import { runtimeEnv } from "@/lib/knowledge/core/grade";
import { readRetrievalContext, runProductDocumentRetrieval } from "@/lib/knowledge/retrieval-core";

import { buildDocumentReport, PRODUCT_DOCUMENTS_GATES_V1 } from "../fixtures/evaluation-report";
import { citingAnswer, FAKE_API_KEY, fakeAnthropic, type FakeAnthropic } from "../fixtures/fake-anthropic";
import { buildPdf, type PdfLine } from "../fixtures/knowledge-pdfs";
import { fixtureDocumentMaterial } from "../fixtures/production-config";
import { integrationConfigured, signedInClient, userIdOf } from "../integration/helpers";
import { runWorkerOnce, uploadVersion, workerConfigured } from "../integration/knowledge-helpers";

/**
 * Beta L4b — the first controlled test with a real Claude model (docs/beta.md §17). NOT part of any
 * test suite: no vitest configuration but vitest.l4b.config.mts includes this file, and it does
 * nothing unless IPA_L4B_STEP names a step. Run one step at a time:
 *
 *   IPA_L4B_STEP=setup    the synthetic document through the normal path (quarantine, scan, worker,
 *                         review, approval), the advisor's grant, and an active, registered
 *                         product_documents configuration. Local database only. Idempotent.
 *   IPA_L4B_STEP=dry      the four cases and the ceiling test through the real gateway, the real
 *                         ledger and the real database — with a FAKE transport and a fictional
 *                         model id. No network. Cleans up its own rows.
 *   IPA_L4B_STEP=price    approves IPA_AI_MODEL with the verified prices (IPA_L4B_PRICE …), the
 *                         narrow data-category rows and the L4b limits.
 *   IPA_L4B_STEP=live     ONE paid case (IPA_L4B_CASE=1–4), with IPA_L4B_CONFIRM=ja.
 *   IPA_L4B_STEP=ceiling  the input-ceiling test: the provider's (free) token count only — a
 *                         message can never be sent. IPA_L4B_CONFIRM=ja.
 *   IPA_L4B_STEP=teardown deactivates the model and restores the limits.
 *
 * Every live guard is checked against the DATABASE, so a rerun can never exceed the plan: at most
 * four messages ever sent for the model, a case is never repeated (a failed call is not replaced),
 * the summed maximum cost of everything sent stays ≤ 1.84 USD, and a critical error writes a halt
 * file that stops every later live step. The texts are synthetic; the report (with the answers)
 * goes to .l4b/ (git-ignored), never to the repository or a log.
 */

const STEP = process.env.IPA_L4B_STEP ?? "";
const ROOT = path.resolve(__dirname, "../../..");
const OUT = path.join(ROOT, ".l4b");
const STATE_FILE = path.join(OUT, "state.json");
const HALT_FILE = path.join(OUT, "halted");

/** The approved plan (docs/beta.md §17.2). */
export const L4B_PLAN = Object.freeze({
  maxMessages: 4,
  maxTotalReservedUsd: 1.84,
  maxOutputTokens: 3000,
  maxAttempts: 1,
  effort: "low",
});
const DRY_MODEL = "claude-l4b-dry-run";
const ADVISOR = "advisorA" as const;
const MATRIX = [
  ["knowledge", "allow"],
  ["user_question", "allow_redacted"],
  ["training_fictional", "allow"],
  ["customer_identifiable", "deny"],
  ["audit_access", "deny"],
] as const;

const adminUrl = process.env.IPA_TEST_DB_ADMIN_URL ?? "";
const local = /@(127\.0\.0\.1|localhost):/.test(adminUrl);
const configured = Boolean(STEP) && integrationConfigured && workerConfigured && local;

// ---------------------------------------------------------------------------------------------
// The synthetic document and the cases. Fictional throughout.
// ---------------------------------------------------------------------------------------------

const PRODUCT_NAME = "Syntetisk erhvervsansvar L4b (fiktiv)";
const DOCUMENT_TITLE = "Syntetiske testbetingelser for erhvervsansvar (L4b, fiktive)";
const EXCLUSION_ANCHOR = "modtaget til reparation";

const h = (text: string): PdfLine => ({ text, size: 13, bold: true, spaceBefore: 10 });
const p = (text: string, first = false): PdfLine => (first ? { text, spaceBefore: 4 } : { text });
const DOCUMENT_PAGES = [
  {
    lines: [
      { text: DOCUMENT_TITLE, size: 15, bold: true },
      p("Fiktivt testdokument. Det beskriver ikke en rigtig forsikring.", true),
      h("§ 1 Hvem er sikret"),
      p("Sikret er den virksomhed, der er nævnt i policen, og virksomhedens ansatte under", true),
      p("arbejdet for virksomheden."),
      h("§ 2 Hvad dækker forsikringen"),
      p("2.1 Forsikringen dækker sikredes erstatningsansvar for skade på personer og ting, som", true),
      p("sikrede forvolder under udøvelsen af den virksomhed, der er nævnt i policen."),
      p("2.2 Forsikringen dækker skader, der sker i Danmark."),
      h("§ 3 Hvad dækker forsikringen ikke"),
      p("3.1 Forsikringen dækker ikke skade på ting, som sikrede eller nogen på sikredes vegne", true),
      p("har lånt, lejet eller opbevarer, eller som sikrede har modtaget til reparation,"),
      p("bearbejdning eller anden behandling."),
      p("3.2 Forsikringen dækker ikke ansvar for skade, som sikrede har forvoldt med forsæt."),
      h("§ 4 Forsikringssum og selvrisiko"),
      p("4.1 Forsikringssummen er 10.000.000 kr. pr. skade for personskade og 5.000.000 kr.", true),
      p("pr. skade for tingskade."),
      p("4.2 Selvrisikoen er 5.000 kr. pr. skade."),
    ],
  },
];

type CaseId = "1" | "2" | "3" | "4";
interface L4bCase {
  id: CaseId;
  name: string;
  profile: "practice" | "copilot";
  input: string;
  /** What the case must show — checked here; the answer itself is reviewed by a person. */
  expect: string;
}
export const L4B_CASES: Readonly<Record<CaseId, L4bCase>> = Object.freeze({
  "1": {
    id: "1",
    name: "Practice: en kort rollespilsreplik",
    profile: "practice",
    input: "Goddag, jeg ringer fra Insurance Partners. Har I et øjeblik til at tale om jeres erhvervsansvarsforsikring?",
    expect: "En kort, afsluttet replik fra den fiktive kunde. Ingen citationer.",
  },
  "2": {
    id: "2",
    name: "Copilot: klart dækket",
    profile: "copilot",
    input:
      "En ansat vælter ved et uheld en reol hos en kunde, så kundens kaffemaskine går i stykker. Er kundens krav på erstatning dækket af erhvervsansvarsforsikringen?",
    expect: "Svar (ikke utilstrækkeligt) med citationer til § 2.1; selvrisikoen i § 4.2 må gerne nævnes.",
  },
  "3": {
    id: "3",
    name: "Copilot: tydelig undtagelse",
    profile: "copilot",
    input:
      "Virksomheden har modtaget en kundes maskine til reparation på sit værksted, og maskinen bliver beskadiget under reparationen. Er skaden på maskinen dækket af erhvervsansvarsforsikringen?",
    expect: "Svaret siger, at skaden ikke er dækket, og citerer undtagelsen i § 3.1. Det må ikke fremstille skaden som dækket.",
  },
  "4": {
    id: "4",
    name: "Copilot: kan ikke besvares",
    profile: "copilot",
    input: "Hvad koster erhvervsansvarsforsikringen om året for en virksomhed med 12 ansatte?",
    expect: "Utilstrækkeligt grundlag. Ingen opfundet pris, dækning eller citation.",
  },
});

// ---------------------------------------------------------------------------------------------
// State, halt and report (.l4b/, git-ignored)
// ---------------------------------------------------------------------------------------------

interface L4bState {
  productId?: string;
  documentId?: string;
  versionId?: string;
  configurationId?: string;
  cases: Partial<Record<CaseId, { requestId: string; at: string; critical: string[] }>>;
  case2CountedInputTokens?: number;
  ceiling?: { at: string; result: string };
  originalLimits?: Record<string, number>;
}

function readState(): L4bState {
  return fs.existsSync(STATE_FILE) ? (JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as L4bState) : { cases: {} };
}
function writeState(state: L4bState): void {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}
function writeReport(name: string, report: unknown): string {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${name}.json`);
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  return file;
}
function halt(reason: string): never {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(HALT_FILE, `${new Date().toISOString()} ${reason}\n`, { flag: "a" });
  throw new Error(`L4b STANDSET: ${reason}. Ingen flere live-trin, før en person har vurderet fejlen.`);
}

// ---------------------------------------------------------------------------------------------
// Database access
// ---------------------------------------------------------------------------------------------

let db: Sql;
const knowledge = (client: SupabaseClient) => client.schema("knowledge");

async function rpc(client: SupabaseClient, schema: "knowledge" | "ai" | "practice", fn: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const { data, error } = await client.schema(schema).rpc(fn, args);
  if (error) throw new Error(`${schema}.${fn}: ${error.message}`);
  return data;
}

const LIMIT_KEYS = ["max_input_tokens", "max_output_tokens", "user_calls_per_minute", "user_calls_per_day", "global_calls_per_minute", "user_active_calls", "global_active_calls", "global_daily_budget_usd", "global_monthly_budget_usd", "user_daily_budget_usd", "reservation_ttl_seconds", "max_attempts"] as const;

async function readLimits(): Promise<Record<string, number>> {
  const [row] = await db<Record<string, unknown>[]>`select * from ai.usage_limits`;
  return Object.fromEntries(LIMIT_KEYS.map((key) => [key, Number(row![key])]));
}

interface Price {
  input: number;
  output: number;
  cacheWrite: number;
  active: boolean;
  verifiedSource: string;
  verifiedOn: string;
}
async function readPrice(modelId: string): Promise<Price | null> {
  const [row] = await db<{ input_usd_per_mtok: string; output_usd_per_mtok: string; cache_write_usd_per_mtok: string; active: boolean; verified_source: string; verified_on: Date }[]>`
    select input_usd_per_mtok, output_usd_per_mtok, cache_write_usd_per_mtok, active, verified_source, verified_on from ai.model_prices where model_id = ${modelId}`;
  return row
    ? { input: Number(row.input_usd_per_mtok), output: Number(row.output_usd_per_mtok), cacheWrite: Number(row.cache_write_usd_per_mtok), active: row.active, verifiedSource: row.verified_source, verifiedOn: row.verified_on.toISOString().slice(0, 10) }
    : null;
}

async function setMatrix(admin: SupabaseClient, modelId: string): Promise<void> {
  for (const [category, rule] of MATRIX) await rpc(admin, "ai", "set_data_category_rule", { p_model_id: modelId, p_category: category, p_rule: rule });
}

/** Exactly the narrow rows: nothing else may be allowed for the model. */
async function assertMatrix(modelId: string): Promise<void> {
  const rows = await db<{ category: string; rule: string }[]>`select category, rule from ai.data_category_policy where model_id = ${modelId} order by category`;
  expect(rows.map((row) => [row.category, row.rule])).toEqual([...MATRIX].map(([c, r]) => [c, r]).sort((a, b) => a[0]!.localeCompare(b[0]!)));
}

/** Everything ever SENT as a message for the model (an attempt was opened), from the database. */
async function sentSoFar(modelId: string): Promise<{ messages: number; reservedUsd: number }> {
  const [row] = await db<{ messages: string; reserved: string | null }[]>`
    select count(*) as messages, sum(reserved_cost_usd) as reserved from ai.usage_reservations where model_id = ${modelId} and attempts >= 1`;
  return { messages: Number(row!.messages), reservedUsd: Number(row!.reserved ?? 0) };
}

async function reservationOf(requestId: string): Promise<Record<string, unknown> | null> {
  const [row] = await db<Record<string, unknown>[]>`
    select status, attempts, outcome_code, reserved_input_tokens, reserved_output_tokens, reserved_cost_usd, counted_input_tokens,
      input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, actual_cost_usd, created_at, finished_at
    from ai.usage_reservations where request_id = ${requestId}`;
  return row ?? null;
}

// ---------------------------------------------------------------------------------------------
// The gateway as the advisor — the application's own chain (runGateway, RLS, ledger, retrieval)
// ---------------------------------------------------------------------------------------------

async function gatewayAs(client: SupabaseClient, model: Model, logs: AiCallLogEntry[]): Promise<GatewayDeps> {
  const { data: me } = await client.schema("identity").rpc("current_user_id");
  const { data: permissions } = await client.schema("identity").rpc("my_permissions");
  const grants = (permissions ?? []) as { permission: string; scope: string }[];
  return {
    ...createGatewayDbDeps(client),
    user: async () => ({ id: me as string, name: "L4b-testrådgiver (fiktiv)" }),
    hasPermission: async (permission: PermissionKey, scope?: PermissionScope) => grants.some((g) => g.permission === permission && (!scope || g.scope === scope)),
    // As retrieveEvidence (src/lib/knowledge/retrieval.ts): the configuration in service decides.
    retrieve: async (request) => {
      const context = await readRetrievalContext(knowledge(client));
      const configuration = context?.configuration;
      if (!configuration || configuration.method !== "product_documents" || !("maxChars" in configuration.params)) throw new Error("Ingen aktiv product_documents-konfiguration.");
      return runProductDocumentRetrieval(request, { db: knowledge(client), params: configuration.params });
    },
    model: () => model,
    usage: createUsageLedger(client),
    log: (entry) => void logs.push(entry),
    environment: runtimeEnv(),
  };
}

function requestFor(c: L4bCase, state: L4bState, roleplaySessionId: string | null): AiRequest {
  return c.profile === "practice"
    ? { profile: "practice", action: "roleplay_turn", input: c.input, context: { roleplaySessionId: roleplaySessionId ?? undefined } }
    : { profile: "copilot", action: "answer_question", input: c.input, context: { productIds: [state.productId!] } };
}

/** The answer as text with its citations resolved to the (synthetic) sources — for the person who reviews it. */
function describe_(outcome: AiOutcome): Record<string, unknown> {
  if (outcome.kind !== "answer") return { kind: outcome.kind, ...("message" in outcome ? { message: outcome.message } : {}), ...("reason" in outcome ? { reason: outcome.reason } : {}) };
  const byId = new Map(outcome.evidence.map((item) => [item.evidenceId, item]));
  const output = outcome.output as unknown as Record<string, unknown>;
  const paragraphs = Array.isArray(output.paragraphs)
    ? (output.paragraphs as ({ text: string } | { cite: string })[][]).map((segments) => segments.map((s) => ("text" in s ? s.text : `[kilde: ${s.cite}]`)).join(""))
    : null;
  return {
    kind: outcome.kind,
    contractKind: output.kind ?? null,
    historical: output.historical ?? null,
    reply: output.reply ?? null,
    paragraphs,
    cited: outcome.cited.map((id) => {
      const item = byId.get(id);
      return { id, documentVersionId: item?.documentVersionId ?? null, title: item?.document.title ?? null, excerpt: item?.excerpt.text ?? null };
    }),
    evidenceVersions: [...new Set(outcome.evidence.map((item) => item.documentVersionId))],
  };
}

/** The technical checks after every case. A failure is critical: it halts L4b. */
function technicalProblems(c: L4bCase, outcome: AiOutcome, log: AiCallLogEntry | undefined, reservation: Record<string, unknown> | null, expectedMaxUsd: number, state: L4bState): string[] {
  const problems: string[] = [];
  const allowed = c.id === "4" ? ["answer", "insufficient"] : ["answer"];
  if (!allowed.includes(outcome.kind)) problems.push(`udfald ${outcome.kind}`);
  if (!log) problems.push("ingen logline");
  if (log?.usage?.attempts !== 1) problems.push(`forsøg ${log?.usage?.attempts ?? "ukendt"} (skal være 1)`);
  if (!reservation) problems.push("ingen reservation i databasen");
  if (reservation) {
    if (reservation.status !== "settled") problems.push(`reservationen er ${String(reservation.status)} (${String(reservation.outcome_code)})`);
    if (Number(reservation.attempts) !== 1) problems.push(`databasens forsøg ${String(reservation.attempts)}`);
    if (Math.abs(Number(reservation.reserved_cost_usd) - expectedMaxUsd) > 1e-6) problems.push(`reserveret ${String(reservation.reserved_cost_usd)} USD, forventet ${expectedMaxUsd}`);
    if (reservation.actual_cost_usd !== null && Number(reservation.actual_cost_usd) > Number(reservation.reserved_cost_usd)) problems.push("faktisk omkostning over den reserverede");
    if (Number(reservation.output_tokens ?? 0) > L4B_PLAN.maxOutputTokens) problems.push("output over loftet");
  }
  if (outcome.kind === "answer") {
    const evidenceVersions = new Set(outcome.evidence.map((item) => item.documentVersionId));
    if (c.profile === "copilot" && (evidenceVersions.size !== 1 || !evidenceVersions.has(state.versionId!))) problems.push("grundlaget er ikke kun den syntetiske, godkendte version");
    if (c.profile === "copilot" && outcome.evidence.some((item) => item.product.id !== state.productId)) problems.push("grundlaget rummer et andet produkt");
    const known = new Set(outcome.evidence.map((item) => item.evidenceId));
    if (outcome.cited.some((id) => !known.has(id))) problems.push("en citation peger uden for grundlaget");
  }
  return problems;
}

/** What the person must look at; never decided automatically (the answer's professional quality). */
function qualityNotes(c: L4bCase, outcome: AiOutcome): string[] {
  const notes: string[] = [];
  const output = outcome.kind === "answer" ? (outcome.output as unknown as Record<string, unknown>) : null;
  if (c.id === "1" && (!output || typeof output.reply !== "string" || output.reply.trim() === "")) notes.push("ingen replik");
  if (c.id === "2" && (output?.kind !== "answer" || outcome.kind !== "answer" || outcome.cited.length === 0)) notes.push("forventede et citeret svar");
  if (c.id === "3") {
    if (output?.kind !== "answer" || outcome.kind !== "answer") notes.push("forventede et citeret svar om undtagelsen");
    else if (!outcome.evidence.some((item) => outcome.cited.includes(item.evidenceId) && item.excerpt.text.includes(EXCLUSION_ANCHOR))) notes.push("undtagelsen i § 3.1 er ikke citeret");
  }
  if (c.id === "4" && outcome.kind !== "insufficient") notes.push("forventede utilstrækkeligt grundlag");
  return notes;
}

/** Runs one case through the gateway and reports. Returns the critical problems. */
async function runCase(c: L4bCase, model: Model, state: L4bState, expectedMaxUsd: number, label: string) {
  const client = await signedInClient(ADVISOR);
  let session: string | null = null;
  if (c.profile === "practice") session = (await rpc(client, "practice", "start_roleplay")) as string;
  const logs: AiCallLogEntry[] = [];
  const deps = await gatewayAs(client, model, logs);
  const started = Date.now();
  let outcome: AiOutcome;
  try {
    outcome = await runGateway(requestFor(c, state, session), deps);
  } finally {
    // The roleplay ends at once: Copilot is locked while one is active.
    if (session) await rpc(client, "practice", "end_roleplay", { p_id: session });
  }
  const wallMs = Date.now() - started;
  const log = logs[0];
  const reservation = log ? await reservationOf(log.requestId) : null;
  const critical = technicalProblems(c, outcome, log, reservation, expectedMaxUsd, state);
  const quality = qualityNotes(c, outcome);
  const report = {
    label,
    case: c,
    at: new Date().toISOString(),
    modelId: model.id,
    wallMs,
    gatewayLatencyMs: log?.latencyMs ?? null,
    outcome: describe_(outcome),
    log,
    reservation,
    critical,
    qualityNotesForReview: quality,
  };
  return { outcome, log, report, critical };
}

// ---------------------------------------------------------------------------------------------
// The steps
// ---------------------------------------------------------------------------------------------

describe.skipIf(!configured)(`L4b — ${STEP}`, () => {
  let admin: SupabaseClient;

  beforeAll(async () => {
    expect(runtimeEnv(), "L4b runs only in IPA_RUNTIME_ENV=local (vitest.l4b.config.mts)").toBe("local");
    db = postgres(adminUrl, { max: 2, onnotice: () => {} });
    admin = await signedInClient("admin");
  });
  afterAll(async () => {
    await db?.end();
  });

  it.runIf(STEP === "setup")("setup: the synthetic document, the grant and an active product_documents configuration", async () => {
    const state = readState();
    // A lost state file is recovered from the database: the synthetic product's name is unique.
    if (!state.versionId) {
      const [found] = await db<{ product_id: string; document_id: string; version_id: string }[]>`
        select p.id as product_id, d.id as document_id, v.id as version_id from knowledge.products p
        join knowledge.documents d on d.product_id = p.id and d.title = ${DOCUMENT_TITLE}
        join knowledge.document_versions v on v.document_id = d.id and v.status = 'published'
        where p.name = ${PRODUCT_NAME} order by v.created_at desc limit 1`;
      if (found) Object.assign(state, { productId: found.product_id, documentId: found.document_id, versionId: found.version_id });
      const [active] = await db<{ id: string }[]>`select id from knowledge.retrieval_configurations where status = 'active' and embedding_model_id is null`;
      if (found && active) state.configurationId = active.id;
      writeState(state);
    }
    if (!state.versionId) {
      const product = await knowledge(admin).from("products").insert({ name: PRODUCT_NAME }).select("id").single();
      if (product.error) throw product.error;
      state.productId = (product.data as { id: string }).id;
      const uploaded = await uploadVersion(admin, await buildPdf(DOCUMENT_PAGES), {
        title: DOCUMENT_TITLE, productId: state.productId, documentType: "terms", validFrom: "2026-01-01", filename: "syntetiske-testbetingelser.pdf",
      });
      state.documentId = uploaded.documentId;
      state.versionId = uploaded.versionId;
      writeState(state);
      // The normal path: the security examination (quarantine, scan) and processing.
      await runWorkerOnce();
      await rpc(admin, "knowledge", "start_review", { p_version_id: state.versionId });
      await rpc(admin, "knowledge", "approve_version", { p_version_id: state.versionId, p_acknowledged_warnings: ["predecessor_superseded", "no_grants"] });
      const grant = await knowledge(admin).from("document_access_grants").insert({ document_id: state.documentId, permission_key: "knowledge.document.read", grantee_type: "user", user_id: await userIdOf(ADVISOR) });
      if (grant.error) throw grant.error;
      writeState(state);
    }
    const [version] = await db<{ status: string; security_state: string }[]>`select status, security_state from knowledge.document_versions where id = ${state.versionId!}`;
    expect(version, "the version is published and released by the security examination").toMatchObject({ status: "published", security_state: "released" });

    if (!state.configurationId) {
      // Any configuration in service is retired: exactly one, ours, will be active.
      for (const row of await db<{ id: string; status: string }[]>`select id, status from knowledge.retrieval_configurations where status in ('active', 'suspended', 'approved')`) {
        if (row.status === "active") await rpc(admin, "knowledge", "suspend_retrieval_configuration", { p_configuration_id: row.id, p_reason: "L4b: erstattes af L4b-konfigurationen" });
        await rpc(admin, "knowledge", "retire_retrieval_configuration", { p_configuration_id: row.id, p_reason: "L4b: erstattes af L4b-konfigurationen" });
      }
      const password = randomBytes(24).toString("hex");
      await db`select ops.evaluation_publisher_prepare()`;
      await db.unsafe(`alter role evaluation_publisher_login password '${password}'`);
      const target = new URL(adminUrl);
      const publisherSql = postgres({ host: target.hostname, port: Number(target.port), database: target.pathname.slice(1), username: "evaluation_publisher_login", password, max: 1, prepare: false, onnotice: () => {} });
      try {
        const gateSetId = await sqlPublisherConnection(publisherSql).registerGateSet(PRODUCT_DOCUMENTS_GATES_V1);
        const [gate] = await db<{ approved_at: Date | null }[]>`select approved_at from knowledge.evaluation_gate_sets where id = ${gateSetId}`;
        if (!gate!.approved_at) await rpc(admin, "knowledge", "approve_evaluation_gate_set", { p_gate_set_id: gateSetId });
        // ⚠ The registered report is the engine's FIXTURE report for the document gate set: it
        // exercises the register's mechanics, not the method's quality (docs/beta.md §5.1, §17.4).
        const material = fixtureDocumentMaterial({ params: { maxChars: 300_000 + (randomBytes(2).readUInt16BE(0) % 50_000) } });
        const scope = [{ documentType: "terms", productId: state.productId!, productName: PRODUCT_NAME }];
        const report = buildDocumentReport({ runId: randomUUID(), label: "l4b-syntetisk", scope, configuration: material, runtime: material });
        await createEvaluationPublisher(sqlPublisherConnection(publisherSql)).publish(report, PRODUCT_DOCUMENTS_GATES_V1);
        const [row] = await db<{ id: string }[]>`select id from knowledge.retrieval_configurations where fingerprint = ${report.configuration.declaredFingerprint}`;
        const [run] = await db<{ id: string }[]>`select id from knowledge.evaluation_runs where configuration_id = ${row!.id} order by registered_at desc limit 1`;
        await rpc(admin, "knowledge", "approve_retrieval_configuration", { p_configuration_id: row!.id, p_run_id: run!.id, p_root_cause_notes: [] });
        await rpc(admin, "knowledge", "activate_retrieval_configuration", { p_configuration_id: row!.id });
        state.configurationId = row!.id;
        writeState(state);
      } finally {
        await db`select ops.evaluation_publisher_deactivate('retired')`;
        await publisherSql.end();
      }
    }

    // The advisor gets production evidence: exactly the synthetic version, in full.
    const advisor = await signedInClient(ADVISOR);
    const context = await readRetrievalContext(knowledge(advisor));
    expect(context?.configuration?.method).toBe("product_documents");
    const { userText } = await import("@/lib/egress/classification");
    const set = await runProductDocumentRetrieval(
      { query: userText("Hvad dækker forsikringen?", { caseBound: false, redacted: true }), productIds: [state.productId!] },
      { db: knowledge(advisor), params: (context!.configuration as { params: { maxChars: number } }).params as never },
    );
    expect(set.retrieval.grade).toBe("production");
    expect(new Set(set.items.map((item) => item.documentVersionId))).toEqual(new Set([state.versionId]));
    expect(set.items.map((item) => item.excerpt.text).join(" ")).toContain(EXCLUSION_ANCHOR);
    // Another advisor without a grant gets nothing.
    const other = await runProductDocumentRetrieval(
      { query: userText("Hvad dækker forsikringen?", { caseBound: false, redacted: true }), productIds: [state.productId!] },
      { db: knowledge(await signedInClient("advisorB")), params: (context!.configuration as { params: { maxChars: number } }).params as never },
    );
    expect(other.items).toEqual([]);
    writeReport("setup", { at: new Date().toISOString(), state, chunks: set.items.length, grade: set.retrieval.grade });
  }, 600_000);

  it.runIf(STEP === "dry")("dry run: the four cases and the ceiling test with a FAKE transport through the real chain", async () => {
    const state = readState();
    expect(state.configurationId, "run IPA_L4B_STEP=setup first").toBeTruthy();
    const original = await readLimits();
    const price = { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.4 };
    await rpc(admin, "ai", "set_model_price", {
      p_model_id: DRY_MODEL, p_provider: "anthropic", p_input: price.input, p_output: price.output, p_cache_write: price.cacheWrite, p_cache_read: price.cacheRead,
      p_context_window: 1_000_000, p_max_output: 128_000, p_price_input_token_limit: null,
      p_verified_source: "L4b tør prøve (fiktiv model, ingen rigtige kald)", p_verified_on: new Date().toISOString().slice(0, 10), p_active: true,
    });
    await setMatrix(admin, DRY_MODEL);
    await rpc(admin, "ai", "set_usage_limits", { p_limits: { max_output_tokens: L4B_PLAN.maxOutputTokens, max_attempts: L4B_PLAN.maxAttempts, user_calls_per_minute: 10 } });
    const results: Record<string, unknown>[] = [];
    try {
      await assertMatrix(DRY_MODEL);
      const limits = await readLimits();
      const expectedMaxUsd = (limits.max_input_tokens! * price.input + limits.max_output_tokens! * price.output) / 1_000_000;
      const reply = (body: Record<string, unknown>) => {
        const system = JSON.stringify(body.system ?? "");
        if (/rollespil|kunde/i.test(system) && !JSON.stringify(body.messages).includes('"document"')) return { kind: "message" as const, content: [{ type: "text", text: "Goddag. Jeg har et par minutter. Hvad drejer det sig om?" }] };
        if (JSON.stringify(body.messages).includes("Hvad koster")) return { kind: "message" as const, content: [{ type: "text", text: "[UTILSTRÆKKELIGT]\nDokumentet oplyser ikke prisen." }] };
        return { kind: "message" as const, content: citingAnswer(body) };
      };
      let fake: FakeAnthropic = fakeAnthropic({ reply });
      const dryModel = () => {
        fake = fakeAnthropic({ reply });
        const transport = createAnthropicTransport({ modelId: DRY_MODEL, apiKey: FAKE_API_KEY, timeoutMs: 5_000, fetch: fake.fetch });
        return createAnthropicModel({ config: { modelId: DRY_MODEL, apiKey: FAKE_API_KEY, effort: "low" }, transport });
      };
      for (const id of ["1", "2", "3", "4"] as const) {
        const { report, critical, log } = await runCase(L4B_CASES[id], dryModel(), state, expectedMaxUsd, "tør prøve");
        expect(fake.messages(), `case ${id}: one message`).toHaveLength(1);
        expect(fake.messages()[0]!.body).toMatchObject({ max_tokens: L4B_PLAN.maxOutputTokens, output_config: { effort: "low" } });
        if (id === "2") state.case2CountedInputTokens = log?.usage?.countedInputTokens ?? undefined;
        results.push(report);
        expect(critical, `case ${id}`).toEqual([]);
      }
      // The ceiling: the same request as case 2, the ceiling one token under its count.
      const ceiling = await ceilingTest(state, () => {
        fake = fakeAnthropic({ reply });
        return { transport: createAnthropicTransport({ modelId: DRY_MODEL, apiKey: FAKE_API_KEY, timeoutMs: 5_000, fetch: fake.fetch }), config: { modelId: DRY_MODEL, apiKey: FAKE_API_KEY, effort: "low" as const }, sent: () => fake.messages().length };
      });
      results.push(ceiling);
      expect(ceiling.result).toBe("refused_by_provider_count");
      writeReport("dry-run", { at: new Date().toISOString(), results });
    } finally {
      await rpc(admin, "ai", "set_usage_limits", { p_limits: original });
      // The fictional model and its rows go again (no delete policy exists for them).
      await db`delete from ai.usage_reservations where model_id = ${DRY_MODEL}`;
      await db`delete from ai.data_category_policy where model_id = ${DRY_MODEL}`;
      await db`delete from ai.model_prices where model_id = ${DRY_MODEL}`;
      delete state.case2CountedInputTokens;
      writeState(state);
    }
  }, 300_000);

  it.runIf(STEP === "price")("price: the verified price, the narrow matrix and the L4b limits", async () => {
    const modelId = process.env.IPA_AI_MODEL ?? "";
    const [input, output, cacheWrite, cacheRead, contextWindow, maxOutput] = (process.env.IPA_L4B_PRICE ?? "").split(",").map(Number);
    const source = process.env.IPA_L4B_PRICE_SOURCE ?? "";
    expect(modelId, "IPA_AI_MODEL").toMatch(/^claude-/);
    for (const value of [input, output, cacheWrite, cacheRead, contextWindow, maxOutput]) expect(Number.isFinite(value) && value! > 0, "IPA_L4B_PRICE=input,output,cache_write,cache_read,context_window,max_output").toBe(true);
    expect(source.length, "IPA_L4B_PRICE_SOURCE: where the price was verified").toBeGreaterThan(10);
    const state = readState();
    state.originalLimits ??= await readLimits();
    writeState(state);
    await rpc(admin, "ai", "set_model_price", {
      p_model_id: modelId, p_provider: "anthropic", p_input: input, p_output: output, p_cache_write: cacheWrite, p_cache_read: cacheRead,
      p_context_window: contextWindow, p_max_output: maxOutput, p_price_input_token_limit: null,
      p_verified_source: source, p_verified_on: new Date().toISOString().slice(0, 10), p_active: true,
    });
    await setMatrix(admin, modelId);
    await assertMatrix(modelId);
    await rpc(admin, "ai", "set_usage_limits", { p_limits: { max_output_tokens: L4B_PLAN.maxOutputTokens, max_attempts: L4B_PLAN.maxAttempts, global_daily_budget_usd: L4B_PLAN.maxTotalReservedUsd } });
    const limits = await readLimits();
    const maxPerCall = (limits.max_input_tokens! * input! + limits.max_output_tokens! * output!) / 1_000_000;
    writeReport("price", { at: new Date().toISOString(), price: await readPrice(modelId), limits, maxPerCallUsd: maxPerCall, planMaxUsd: L4B_PLAN.maxTotalReservedUsd, messagesAffordable: Math.floor(L4B_PLAN.maxTotalReservedUsd / maxPerCall + 1e-9) });
    expect(maxPerCall * L4B_PLAN.maxMessages, "four calls at the maximum stay within 1.84 USD").toBeLessThanOrEqual(L4B_PLAN.maxTotalReservedUsd + 1e-9);
  });

  /** The live preconditions — every one from the environment and the DATABASE, before anything is sent. */
  async function livePreflight(forMessage: boolean): Promise<{ modelId: string; expectedMaxUsd: number; state: L4bState }> {
    expect(fs.existsSync(HALT_FILE), `L4b er standset (${HALT_FILE}); en person skal vurdere fejlen først`).toBe(false);
    expect(process.env.IPA_L4B_CONFIRM, "IPA_L4B_CONFIRM=ja").toBe("ja");
    const modelId = process.env.IPA_AI_MODEL ?? "";
    const config = readAnthropicConfig(modelId, process.env); // throws without a key; the key is never printed
    expect(config.effort, "IPA_AI_EFFORT=low").toBe(L4B_PLAN.effort);
    const state = readState();
    expect(state.configurationId, "run IPA_L4B_STEP=setup first").toBeTruthy();
    const price = await readPrice(modelId);
    expect(price?.active, "the model is approved with a verified price (IPA_L4B_STEP=price)").toBe(true);
    await assertMatrix(modelId);
    const limits = await readLimits();
    expect(limits.max_output_tokens).toBe(L4B_PLAN.maxOutputTokens);
    expect(limits.max_attempts).toBe(L4B_PLAN.maxAttempts);
    expect(limits.global_daily_budget_usd).toBeLessThanOrEqual(L4B_PLAN.maxTotalReservedUsd);
    const expectedMaxUsd = (limits.max_input_tokens! * price!.input + limits.max_output_tokens! * price!.output) / 1_000_000;
    if (forMessage) {
      const sent = await sentSoFar(modelId);
      expect(sent.messages, "at most four messages in all").toBeLessThan(L4B_PLAN.maxMessages);
      expect(sent.reservedUsd + expectedMaxUsd, "the summed maximum cost stays ≤ 1.84 USD").toBeLessThanOrEqual(L4B_PLAN.maxTotalReservedUsd + 1e-9);
    }
    // Nothing uncertain or open from before.
    const [open] = await db<{ n: string }[]>`select count(*) as n from ai.usage_reservations where model_id = ${modelId} and status in ('pending', 'uncertain')`;
    expect(Number(open!.n), "no pending or uncertain reservation").toBe(0);
    return { modelId, expectedMaxUsd, state };
  }

  it.runIf(STEP === "live")("live: ONE paid case", async () => {
    const id = process.env.IPA_L4B_CASE as CaseId;
    const c = L4B_CASES[id];
    expect(c, "IPA_L4B_CASE=1, 2, 3 or 4").toBeDefined();
    const { modelId, expectedMaxUsd, state } = await livePreflight(true);
    expect(state.cases[id], `case ${id} has run before — a case is never repeated`).toBeUndefined();
    // Recorded BEFORE the call: an interrupted run can never repeat the case.
    const placeholder = { requestId: "pending", at: new Date().toISOString(), critical: ["afbrudt før afslutning"] };
    state.cases[id] = placeholder;
    writeState(state);
    // The application's own factory (src/lib/ai/gateway.ts): IPA_AI_MODEL, the key from the environment.
    const model = createModel(modelId, runtimeEnv(), { anthropic: configuredAnthropicModel });
    let ran: Awaited<ReturnType<typeof runCase>>;
    try {
      ran = await runCase(c, model, state, expectedMaxUsd, "live");
    } catch (error) {
      halt(`case ${id}: ${(error as Error).name}`);
    }
    const { report, critical, log } = ran;
    const sent = await sentSoFar(modelId);
    const file = writeReport(`live-case-${id}`, { ...report, totals: { messagesSent: sent.messages, reservedUsdOfSent: sent.reservedUsd } });
    state.cases[id] = { requestId: log?.requestId ?? "ukendt", at: report.at, critical };
    if (id === "2") state.case2CountedInputTokens = log?.usage?.countedInputTokens ?? undefined;
    writeState(state);
    console.info(`L4b case ${id}: rapport i ${path.relative(ROOT, file)}`);
    if (critical.length > 0) halt(`case ${id}: ${critical.join("; ")}`);
  }, 300_000);

  /** The input ceiling with the provider's own count; a guarded fetch makes a message impossible. */
  async function ceilingTest(state: L4bState, build: () => { transport: ReturnType<typeof createAnthropicTransport>; config: { modelId: string; apiKey: string; effort: "low" }; sent: () => number }) {
    const counted = state.case2CountedInputTokens;
    expect(counted, "case 2 must have run (its provider count sets the ceiling)").toBeGreaterThan(0);
    const before = await readLimits();
    const { transport, config, sent } = build();
    const model = createAnthropicModel({ config, transport });
    await rpc(admin, "ai", "set_usage_limits", { p_limits: { max_input_tokens: counted! - 1 } });
    try {
      const { report: full } = await runCase(L4B_CASES["2"], model, state, 0, "loftstest");
      // The case checks do not apply: this call must be refused before any message.
      const report = { ...full, critical: undefined, qualityNotesForReview: undefined };
      const reservation = report.reservation;
      const refusedByCount = report.outcome.kind === "invalid_request" && reservation?.status === "released" && reservation?.outcome_code === "input_token_budget_exceeded" && Number(reservation?.attempts) === 0;
      const refusedLocally = report.log?.reasonCode === "document_basis_too_large";
      const result = sent() > 0 ? "message_attempted" : refusedByCount ? "refused_by_provider_count" : refusedLocally ? "refused_by_local_estimate" : "unexpected";
      return { ...report, ceiling: { maxInputTokens: counted! - 1, case2CountedInputTokens: counted, countedNow: reservation?.counted_input_tokens ?? null }, result };
    } finally {
      await rpc(admin, "ai", "set_usage_limits", { p_limits: { max_input_tokens: before.max_input_tokens } });
    }
  }

  it.runIf(STEP === "ceiling")("ceiling: the provider's token count refuses an input over the ceiling — nothing is sent", async () => {
    // Nothing billable is sent (the count is free), so the message limits do not apply here.
    const { modelId, state } = await livePreflight(false);
    expect(state.ceiling, "the ceiling test has run before").toBeUndefined();
    const config = readAnthropicConfig(modelId, process.env);
    // The count goes to the real API; a message is answered locally with a refusal and never sent.
    let messageAttempts = 0;
    const guard = {
      fetch: (async (input: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (new URL(url).pathname === "/v1/messages/count_tokens") return globalThis.fetch(input, init);
        messageAttempts += 1;
        return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "L4b: blocked locally" } }), { status: 400, headers: { "content-type": "application/json" } });
      }) as typeof globalThis.fetch,
    };
    const ceiling = await ceilingTest(state, () => ({
      transport: createAnthropicTransport({ modelId, apiKey: config.apiKey, timeoutMs: ANTHROPIC_TIMEOUT_MS, fetch: guard.fetch }),
      config: { modelId, apiKey: config.apiKey, effort: "low" as const },
      sent: () => messageAttempts,
    }));
    state.ceiling = { at: new Date().toISOString(), result: ceiling.result };
    writeState(state);
    const file = writeReport("ceiling", ceiling);
    console.info(`L4b loftstest: ${ceiling.result} (rapport i ${path.relative(ROOT, file)})`);
    // Refused by the local estimate first: nothing sent either, but the provider's ceiling is not
    // proven — reported, not halted. Anything else is critical.
    if (ceiling.result !== "refused_by_provider_count" && ceiling.result !== "refused_by_local_estimate") halt(`loftstest: ${ceiling.result}`);
  }, 300_000);

  it.runIf(STEP === "teardown")("teardown: the model is deactivated and the limits restored", async () => {
    const modelId = process.env.IPA_AI_MODEL ?? "";
    const state = readState();
    const price = await readPrice(modelId);
    if (price) {
      const [row] = await db<Record<string, unknown>[]>`select * from ai.model_prices where model_id = ${modelId}`;
      await rpc(admin, "ai", "set_model_price", {
        p_model_id: modelId, p_provider: "anthropic", p_input: Number(row!.input_usd_per_mtok), p_output: Number(row!.output_usd_per_mtok),
        p_cache_write: Number(row!.cache_write_usd_per_mtok), p_cache_read: Number(row!.cache_read_usd_per_mtok), p_context_window: row!.context_window_tokens,
        p_max_output: row!.max_output_tokens, p_price_input_token_limit: row!.price_input_token_limit, p_verified_source: row!.verified_source,
        p_verified_on: (row!.verified_on as Date).toISOString().slice(0, 10), p_active: false,
      });
    }
    if (state.originalLimits) await rpc(admin, "ai", "set_usage_limits", { p_limits: state.originalLimits });
    const sent = await sentSoFar(modelId);
    const all = await db<Record<string, unknown>[]>`
      select profile_id, action, status, attempts, outcome_code, counted_input_tokens, input_tokens, output_tokens, reserved_cost_usd, actual_cost_usd, created_at
      from ai.usage_reservations where model_id = ${modelId} order by created_at`;
    writeReport("teardown", { at: new Date().toISOString(), messagesSent: sent.messages, reservedUsdOfSent: sent.reservedUsd, actualUsd: all.reduce((sum, r) => sum + Number(r.actual_cost_usd ?? 0), 0), reservations: all, modelActive: (await readPrice(modelId))?.active ?? null });
  });
});
