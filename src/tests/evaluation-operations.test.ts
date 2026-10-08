import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { writeVersionedReport } from "../../evals/engine/operations.ts";
import { buildPerformanceMeasurement } from "../../evals/engine/performance.ts";
import type { SqlClient } from "../../evals/engine/publication.ts";
import { regressionAlerts } from "../../evals/engine/regression.ts";
import { checkFileSums, publishEvaluation } from "../../workers/evaluation/publish-run.ts";
import type { Alert } from "@/lib/observability/alerts";

import { FIXTURE_PERFORMANCE } from "./fixtures/evaluation-performance";
import { buildReport, GATES_V1, qualityRegressionReport } from "./fixtures/evaluation-report";

/**
 * 8B-I7 — evaluation operations: versioned output with a SHA-256 list, publication as
 * evaluation_publisher (verified before anything is sent) and the regression alarms with the
 * evaluation set, the gate set and the runtime fingerprint.
 */

const hardBreach = () => buildReport({ violations: [{ gate: "H1", caseId: null, explanation: "Fiktivt brud." }] });

describe("regression control (§4.4, §10.2)", () => {
  it("a baseline run raises no regression alarm, whatever its result", () => {
    expect(regressionAlerts(hardBreach(), "baseline")).toEqual([]);
    expect(regressionAlerts(qualityRegressionReport(), "baseline")).toEqual([]);
  });

  it("a hard-gate breach is critical; a failed quality gate is a warning; a pass is silent", () => {
    const hard = regressionAlerts(hardBreach(), "regression");
    expect(hard.map((alert) => [alert.code, alert.severity])).toEqual([["hard_gate_regression", "critical"]]);
    expect(hard[0]!.details).toMatchObject({ failed_hard_gates: "H1" });
    const quality = qualityRegressionReport();
    const warning = regressionAlerts(quality, "regression");
    expect(warning.map((alert) => [alert.code, alert.severity])).toEqual([["quality_regression", "warning"]]);
    expect(warning[0]!.details).toEqual({
      run_id: quality.runId,
      verdict: "fail",
      eval_set: `${quality.evalSet.setId}@${quality.evalSet.version}`,
      eval_set_checksum: quality.evalSet.checksum,
      gate_set: `${quality.gateSet.id}@${quality.gateSet.version}`,
      gate_set_checksum: quality.gateSet.checksum,
      runtime_fingerprint: quality.configuration.runtimeFingerprint,
      corpus_checksum: quality.corpus.checksumAfter,
      failed_quality_gates: "Q1,Q2,Q3",
    });
    expect(regressionAlerts(buildReport(), "regression")).toEqual([]);
  });
});

describe("versioned output", () => {
  it("writes the report, Markdown, the measurement and a sha256sum list that matches them", () => {
    const report = buildReport();
    const performance = buildPerformanceMeasurement({ ...FIXTURE_PERFORMANCE, runId: report.runId });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ipa-eval-"));
    const written = writeVersionedReport(dir, report, performance);
    expect(written.map((file) => path.basename(file))).toEqual([`${report.runId}.json`, `${report.runId}.md`, `${report.runId}.performance.json`, `${report.runId}.sha256`]);
    const sums = fs.readFileSync(written.at(-1)!, "utf8").trim().split("\n");
    for (const line of sums) {
      const [hex, name] = line.split(/\s+/);
      expect(createHash("sha256").update(fs.readFileSync(path.join(dir, name!))).digest("hex")).toBe(hex);
    }
    expect(JSON.parse(fs.readFileSync(written[0]!, "utf8"))).toEqual(JSON.parse(JSON.stringify(report)));
  });

  it("a file that is missing from the list, changed or unlisted is found", () => {
    const content = "{}\n";
    const hex = createHash("sha256").update(content).digest("hex");
    expect(checkFileSums({ "a.json": content }, `${hex}  a.json\n`)).toEqual([]);
    expect(checkFileSums({ "a.json": content }, null)).toEqual(["Filernes SHA-256-liste mangler."]);
    expect(checkFileSums({ "a.json": "{ }\n" }, `${hex}  a.json\n`)).toEqual(["a.json stemmer ikke med sin SHA-256."]);
    expect(checkFileSums({ "b.json": content }, `${hex}  a.json\n`)).toEqual(["b.json står ikke i SHA-256-listen."]);
  });
});

describe("publication as evaluation_publisher", () => {
  function fakeSql(failWith?: { code: string }) {
    const calls: string[] = [];
    const sql: SqlClient = {
      async unsafe(query) {
        calls.push(query.replace(/\s+/g, " ").match(/knowledge\.[a-z_]+/)![0]);
        if (failWith && query.includes("record_evaluation_run")) throw Object.assign(new Error("afvist"), failWith);
        if (query.includes("register_evaluation_gate_set")) return [{ id: "g" }];
        if (query.includes("record_evaluation_run")) return [{ id: "r", registered_at: new Date("2026-10-08T08:00:00Z") }];
        return [{ id: "m" }];
      },
    };
    return { sql, calls };
  }
  function input(report = buildReport(), mode: "baseline" | "regression" = "baseline", tamper = false) {
    const performance = buildPerformanceMeasurement({ ...FIXTURE_PERFORMANCE, runId: report.runId, configurationFingerprint: report.configuration.runtimeFingerprint });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ipa-eval-"));
    const written = writeVersionedReport(dir, report, performance);
    const files = Object.fromEntries(written.filter((f) => !f.endsWith(".sha256")).map((f) => [path.basename(f), fs.readFileSync(f, "utf8")]));
    if (tamper) files[`${report.runId}.json`] += " ";
    return { report, gates: GATES_V1, performance, mode, files, checksums: fs.readFileSync(written.at(-1)!, "utf8") };
  }
  const sinkOf = (alerts: Alert[]) => ({ send: async (alert: Alert) => void alerts.push(alert) });

  it("verifies, registers the gate set, the run and the measurement — in that order", async () => {
    const { sql, calls } = fakeSql();
    const alerts: Alert[] = [];
    const outcome = await publishEvaluation(input(), sql, sinkOf(alerts), () => {});
    expect(outcome).toEqual({ status: "published", runId: "r", performanceId: "m" });
    expect(calls).toEqual(["knowledge.register_evaluation_gate_set", "knowledge.record_evaluation_run", "knowledge.record_performance_measurement"]);
    expect(alerts).toEqual([]);
  });

  it("a regression raises its alarm after the registration (which is what suspends)", async () => {
    const { sql } = fakeSql();
    const alerts: Alert[] = [];
    await publishEvaluation(input(hardBreach(), "regression"), sql, sinkOf(alerts), () => {});
    expect(alerts.map((alert) => alert.code)).toEqual(["hard_gate_regression"]);
  });

  it("a changed file, a forged measurement or a measurement of another run is refused before anything is sent — with an alarm", async () => {
    for (const bad of [
      input(buildReport(), "baseline", true),
      { ...input(), performance: { ...input().performance, retrieval: { ...input().performance.retrieval, total: [1] } } },
      (() => { const i = input(); return { ...i, performance: buildPerformanceMeasurement({ ...FIXTURE_PERFORMANCE, runId: "another-run" }), files: i.files }; })(),
    ]) {
      const { sql, calls } = fakeSql();
      const alerts: Alert[] = [];
      const outcome = await publishEvaluation(bad, sql, sinkOf(alerts), () => {});
      expect(outcome.status).toBe("refused");
      expect(calls).toEqual([]);
      expect(alerts.map((alert) => alert.code)).toEqual(["publication_refused"]);
    }
  });

  it("a refusal by the database (it recomputes everything) is a refusal with an alarm, not a crash", async () => {
    const { sql } = fakeSql({ code: "23514" });
    const alerts: Alert[] = [];
    const outcome = await publishEvaluation(input(), sql, sinkOf(alerts), () => {});
    expect(outcome).toMatchObject({ status: "refused", problems: ["Databasen afviste rapporten (23514)."] });
    expect(alerts.map((alert) => alert.code)).toEqual(["publication_refused"]);
  });

  it("a connection failure is not mistaken for a refusal", async () => {
    const { sql } = fakeSql({ code: "ECONNREFUSED" });
    await expect(publishEvaluation(input(), sql, sinkOf([]), () => {})).rejects.toThrow();
  });
});

describe("separation (D-7, D-18): the evaluation and the publication never share a credential", () => {
  const root = path.resolve(__dirname, "../..");
  const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

  it("the publication step reads no application credential and refuses one outside local/test", () => {
    const publish = read("workers/evaluation/publish.ts");
    expect(publish).not.toMatch(/@supabase\/supabase-js|createClient/);
    for (const name of ["SUPABASE_SERVICE_ROLE_KEY", "IPA_EVAL_SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) expect(publish).toContain(`"${name}"`);
    expect(publish).toMatch(/rejectUnauthorized: true/);
    expect(publish).toMatch(/evaluation_publisher_login/);
  });

  it("the workflow keeps the two credentials in two jobs, two environments and two roles", () => {
    const workflow = read(".github/workflows/retrieval-evaluation.yml");
    const [evaluate, publish] = workflow.split(/\n  publish:\n/);
    expect(evaluate).toMatch(/environment: evaluation\n/);
    expect(evaluate).toMatch(/ipa-evaluation-runner/);
    expect(evaluate).toMatch(/ipa\/evaluation\/supabase/);
    expect(evaluate).not.toMatch(/evaluation-publisher\/db|IPA_PUBLISHER_DB/);
    expect(publish).toMatch(/environment: evaluation-publication/);
    expect(publish).toMatch(/ipa-evaluation-publisher/);
    expect(publish).not.toMatch(/ipa\/evaluation\/supabase|IPA_EVAL_SUPABASE/);
    expect(workflow).toMatch(/cron: /);
    expect(workflow).not.toMatch(/AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.|postgres(ql)?:\/\/[^\s"]*:[^\s"]*@/);
  });

  it("each OIDC role can read exactly one secret", () => {
    const runner = JSON.parse(read("deploy/evaluation/iam/runner-policy.json"));
    const publisher = JSON.parse(read("deploy/evaluation/iam/publisher-policy.json"));
    const secrets = (policy: { Statement: { Action: string; Resource: string | string[] }[] }) =>
      policy.Statement.filter((s) => s.Action === "secretsmanager:GetSecretValue").flatMap((s) => [s.Resource].flat());
    expect(secrets(runner)).toEqual(["arn:aws:secretsmanager:eu-central-1:${EVAL_AWS_ACCOUNT_ID}:secret:ipa/evaluation/supabase-*"]);
    expect(secrets(publisher)).toEqual(["arn:aws:secretsmanager:eu-central-1:${AWS_ACCOUNT_ID}:secret:ipa/production/evaluation-publisher/db-*"]);
    expect(publisher.Statement).toHaveLength(1);
  });
});
