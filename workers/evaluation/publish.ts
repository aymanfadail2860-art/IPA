import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import postgres from "postgres";

import type { EvaluationMode } from "../../evals/engine/regression.ts";
import type { PerformanceMeasurement } from "../../evals/engine/performance.ts";
import type { EvaluationReport } from "../../evals/engine/runner.ts";
import { validateGateSet } from "../../evals/engine/schema.ts";
import { runtimeEnv } from "../../src/lib/knowledge/core/grade.ts";
import { createAlertSink } from "../../src/lib/observability/alerts.ts";

import { publishEvaluation } from "./publish-run.ts";

/**
 * `npm run eval:publish` — registers one evaluation run in production as evaluation_publisher
 * (docs/08b §4.5, D-7, D-18; 8B-I7). The separate step after `npm run eval:retrieval`:
 *
 *   --report       <dir>/<run-id>.json (the .md, .performance.json and .sha256 beside it are used)
 *   --gates        gate set name (evals/retrieval/gates/<name>.json), default "gates-v1"
 *   --mode         "baseline" or "regression"
 *
 * The connection (secure transport, I7): TLS with certificate verification against the Supabase
 * CA, as evaluation_publisher_login and nothing else. The credential is injected for this one job
 * (CI fetches it from Secrets Manager through a short-lived OIDC role; never a stored secret):
 *
 *   IPA_PUBLISHER_DB_HOST, IPA_PUBLISHER_DB_PORT (5432), IPA_PUBLISHER_DB_NAME (postgres),
 *   IPA_PUBLISHER_DB_USER (evaluation_publisher_login[.<project-ref>]), IPA_PUBLISHER_DB_PASSWORD,
 *   IPA_PUBLISHER_DB_CA_FILE (required outside local/test).
 *
 * No application credential (anon, service role, a user) is read or accepted. Exit codes: 0
 * published, 1 refused (alarm), 2 invalid input or configuration, 3 connection failure.
 */

const USER = /^evaluation_publisher_login(\.[a-z0-9]{20})?$/;
const FORBIDDEN = ["SUPABASE_SERVICE_ROLE_KEY", "IPA_EVAL_SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];

function fail(message: string, code: number): never {
  process.stderr.write(`${JSON.stringify({ event: "eval_publish_failed", reason: message })}\n`);
  process.exit(code);
}

const { values } = parseArgs({ options: { report: { type: "string" }, gates: { type: "string", default: "gates-v1" }, mode: { type: "string", default: "baseline" } } });
if (!values.report) fail("--report mangler.", 2);
if (values.mode !== "baseline" && values.mode !== "regression") fail("--mode skal være baseline eller regression.", 2);
const local = ["local", "test"].includes(runtimeEnv(process.env.IPA_RUNTIME_ENV));
// The publisher's job holds no application credential at all (separation, D-18).
for (const name of FORBIDDEN) if (process.env[name] && !local) fail(`${name} må ikke være sat i publiceringsjobbet.`, 2);

const env = process.env;
const user = env.IPA_PUBLISHER_DB_USER ?? "";
const password = env.IPA_PUBLISHER_DB_PASSWORD ?? "";
const caFile = env.IPA_PUBLISHER_DB_CA_FILE ?? "";
if (!env.IPA_PUBLISHER_DB_HOST || !USER.test(user) || password.length < 16) fail("Forbindelsen som evaluation_publisher_login er ikke konfigureret.", 2);
if (!local && (!caFile || !fs.existsSync(caFile))) fail("IPA_PUBLISHER_DB_CA_FILE (Supabases CA) kræves: TLS med certifikatkontrol.", 2);

const reportPath = path.resolve(values.report);
const base = reportPath.replace(/\.json$/, "");
const read = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);
const reportText = read(reportPath) ?? fail("Rapporten findes ikke.", 2);
const performanceText = read(`${base}.performance.json`);
const markdown = read(`${base}.md`);
const files: Record<string, string> = { [path.basename(reportPath)]: reportText };
if (markdown !== null) files[path.basename(`${base}.md`)] = markdown;
if (performanceText !== null) files[path.basename(`${base}.performance.json`)] = performanceText;
const gates = validateGateSet(JSON.parse(fs.readFileSync(path.resolve("evals/retrieval/gates", `${values.gates}.json`), "utf8")));

const sql = postgres({
  host: env.IPA_PUBLISHER_DB_HOST,
  port: Number(env.IPA_PUBLISHER_DB_PORT ?? 5432),
  database: env.IPA_PUBLISHER_DB_NAME || "postgres",
  username: user,
  password,
  ssl: caFile ? { ca: fs.readFileSync(caFile, "utf8"), rejectUnauthorized: true, servername: env.IPA_PUBLISHER_DB_HOST } : false,
  prepare: false,
  fetch_types: false,
  max: 1,
  connect_timeout: 15,
  connection: { application_name: "ipa-evaluation-publisher" },
  onnotice: () => {},
});
const log = (event: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(event)}\n`);

try {
  const outcome = await publishEvaluation(
    {
      report: JSON.parse(reportText) as EvaluationReport,
      gates,
      performance: performanceText ? (JSON.parse(performanceText) as PerformanceMeasurement) : null,
      mode: values.mode as EvaluationMode,
      files,
      checksums: read(`${base}.sha256`),
    },
    sql,
    createAlertSink(env, "evaluation-publisher"),
    log,
  );
  await sql.end({ timeout: 5 });
  process.exit(outcome.status === "published" ? 0 : 1);
} catch (error) {
  await sql.end({ timeout: 5 }).catch(() => {});
  fail(error instanceof Error ? error.name : "unknown", 3);
}
