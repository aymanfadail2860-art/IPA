import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { writeVersionedReport } from "../../evals/engine/operations.ts";
import { buildPerformanceMeasurement } from "../../evals/engine/performance.ts";
import type { SqlClient } from "../../evals/engine/publication.ts";
import { classificationAlerts, parseRunEvent, type EvaluationMode, type RegisteredRunEvent, type RunClassification } from "../../evals/engine/regression.ts";
import { checkFileSums, publishEvaluation } from "../../workers/evaluation/publish-run.ts";
import type { Alert } from "@/lib/observability/alerts";

import { FIXTURE_PERFORMANCE } from "./fixtures/evaluation-performance";
import { fixtureMaterial } from "./fixtures/production-config";
import { buildReport, GATES_V1, qualityRegressionReport } from "./fixtures/evaluation-report";

/**
 * 8B-I7 — evaluation operations: versioned output with a SHA-256 list, publication as
 * evaluation_publisher (verified before anything is sent) and the regression alarms with the
 * evaluation set, the gate set and the runtime fingerprint.
 *
 * 8B-I7.1 — the DATABASE classifies a registered run; the CI job's mode is diagnostics only and
 * never decides the alarm code, the severity or suspension.
 */

const hardBreach = () => buildReport({ violations: [{ gate: "H1", caseId: null, explanation: "Fiktivt brud." }] });

const quality = qualityRegressionReport();
function runEvent(classification: RunClassification, requestedMode: EvaluationMode | null, overrides: Partial<RegisteredRunEvent> = {}): RegisteredRunEvent {
  return {
    id: "61000000-0000-4000-8000-0000000000e1",
    runId: quality.runId,
    registeredAt: "2026-10-09T08:00:00.000Z",
    classification,
    requestedMode,
    registeredWhile: classification === "baseline" ? "candidate" : "active",
    outcome: classification === "regression" || classification === "baseline" ? "pass" : "fail",
    configurationId: "c0ffee00-0000-4000-8000-000000000001",
    configurationStatus: classification === "hard_gate_regression" ? "suspended" : classification === "baseline" ? "candidate" : "active",
    suspended: classification === "hard_gate_regression",
    evalSet: { id: quality.evalSet.setId, version: quality.evalSet.version, checksum: quality.evalSet.checksum },
    gateSet: { id: quality.gateSet.id, version: quality.gateSet.version, checksum: quality.gateSet.checksum },
    runtimeFingerprint: quality.configuration.runtimeFingerprint,
    corpusChecksum: quality.corpus.checksumAfter,
    failedHardGates: classification === "hard_gate_regression" ? ["H1"] : [],
    failedQualityGates: classification === "quality_regression" ? ["Q1", "Q2", "Q3"] : [],
    replayed: false,
    ...overrides,
  };
}
const codes = (alerts: Alert[]) => alerts.map((alert) => [alert.code, alert.severity]);

describe("regression control: the database classifies, the CI job's mode is diagnostics (§4.4, §10.2, 8B-I7.1)", () => {
  it("CI says baseline, the database finds a regression → the regression's alarm, with the mismatch shown", () => {
    const alerts = classificationAlerts(runEvent("quality_regression", "baseline"));
    expect(codes(alerts)).toEqual([["quality_regression", "warning"]]);
    expect(alerts[0]!.details).toMatchObject({ classification: "quality_regression", requested_mode: "baseline", requested_mode_matches: "false" });
  });

  it("CI says regression, the database finds a baseline → no false regression", () => {
    expect(classificationAlerts(runEvent("baseline", "regression"))).toEqual([]);
    // Even a hard breach in a candidate's run is a failed baseline, not a regression.
    expect(classificationAlerts(runEvent("baseline", "regression", { failedHardGates: ["H1"], outcome: "fail" }))).toEqual([]);
  });

  it("a hard-gate regression is critical, with the suspension, whatever the requested mode", () => {
    for (const mode of ["baseline", "regression", null] as const) {
      const alerts = classificationAlerts(runEvent("hard_gate_regression", mode));
      expect(codes(alerts)).toEqual([["hard_gate_regression", "critical"]]);
      expect(alerts[0]!.details).toMatchObject({ suspended: "true", configuration_status: "suspended", failed_hard_gates: "H1", requested_mode: mode ?? "none" });
    }
  });

  it("a quality regression is a warning for review, whatever the requested mode", () => {
    for (const mode of ["baseline", "regression", null] as const) {
      expect(codes(classificationAlerts(runEvent("quality_regression", mode)))).toEqual([["quality_regression", "warning"]]);
    }
    expect(classificationAlerts(runEvent("quality_regression", "regression"))[0]!.details).toEqual({
      run_id: quality.runId,
      classification: "quality_regression",
      requested_mode: "regression",
      requested_mode_matches: "true",
      outcome: "fail",
      configuration_id: "c0ffee00-0000-4000-8000-000000000001",
      configuration_status: "active",
      suspended: "false",
      eval_set: `${quality.evalSet.setId}@${quality.evalSet.version}`,
      eval_set_checksum: quality.evalSet.checksum,
      gate_set: `${quality.gateSet.id}@${quality.gateSet.version}`,
      gate_set_checksum: quality.gateSet.checksum,
      runtime_fingerprint: quality.configuration.runtimeFingerprint,
      corpus_checksum: quality.corpus.checksumAfter,
      failed_quality_gates: "Q1,Q2,Q3",
    });
  });

  it("a passing regression and a baseline raise nothing", () => {
    expect(classificationAlerts(runEvent("regression", "regression"))).toEqual([]);
    expect(classificationAlerts(runEvent("baseline", "baseline"))).toEqual([]);
  });

  it("an unknown or missing classification is an error — never read as a baseline", () => {
    const raw = JSON.parse(JSON.stringify(runEvent("baseline", null))) as Record<string, unknown>;
    expect(parseRunEvent(raw).classification).toBe("baseline");
    expect(parseRunEvent(JSON.stringify(raw)).classification).toBe("baseline");
    expect(() => parseRunEvent({ ...raw, classification: "pass" })).toThrow();
    expect(() => parseRunEvent({ ...raw, classification: undefined })).toThrow();
    expect(() => parseRunEvent(null)).toThrow();
    // A requested mode outside the two is not carried along.
    expect(parseRunEvent({ ...raw, requestedMode: "hard_gate_regression" }).requestedMode).toBeNull();
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
  function fakeSql(options: { failWith?: { code: string; message?: string }; classification?: RunClassification; replayed?: boolean } = {}) {
    const calls: string[] = [];
    const parameters: unknown[][] = [];
    const sql: SqlClient = {
      async unsafe(query, params = []) {
        calls.push(query.replace(/\s+/g, " ").match(/knowledge\.[a-z_]+/)![0]);
        parameters.push(params);
        if (options.failWith && query.includes("publish_evaluation_run")) throw Object.assign(new Error(options.failWith.message ?? "afvist"), { code: options.failWith.code });
        if (query.includes("register_evaluation_gate_set")) return [{ id: "g" }];
        if (query.includes("publish_evaluation_run")) {
          const requested = (params[1] ?? null) as EvaluationMode | null;
          return [{ event: { ...runEvent(options.classification ?? "baseline", requested), id: "r", replayed: options.replayed ?? false } }];
        }
        return [{ id: "m" }];
      },
    };
    return { sql, calls, parameters };
  }
  function input(report = buildReport(), requestedMode: EvaluationMode | null = "baseline", tamper = false) {
    const performance = buildPerformanceMeasurement({ ...FIXTURE_PERFORMANCE, runId: report.runId, configurationFingerprint: report.configuration.runtimeFingerprint });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ipa-eval-"));
    const written = writeVersionedReport(dir, report, performance);
    const files = Object.fromEntries(written.filter((f) => !f.endsWith(".sha256")).map((f) => [path.basename(f), fs.readFileSync(f, "utf8")]));
    if (tamper) files[`${report.runId}.json`] += " ";
    return { report, gates: GATES_V1, performance, requestedMode, files, checksums: fs.readFileSync(written.at(-1)!, "utf8") };
  }
  const sinkOf = (alerts: Alert[]) => ({ send: async (alert: Alert) => void alerts.push(alert) });

  it("verifies, registers the gate set, the run and the measurement — in that order", async () => {
    const { sql, calls } = fakeSql();
    const alerts: Alert[] = [];
    const outcome = await publishEvaluation(input(), sql, sinkOf(alerts), () => {});
    expect(outcome).toEqual({ status: "published", runId: "r", classification: "baseline", performanceId: "m" });
    expect(calls).toEqual(["knowledge.register_evaluation_gate_set", "knowledge.publish_evaluation_run", "knowledge.record_performance_measurement"]);
    expect(alerts).toEqual([]);
  });

  it("the requested mode reaches the database as diagnostics; the alarm follows the database's classification", async () => {
    // CI says baseline about a passing report — the database finds a hard-gate regression of the
    // configuration in service (it registered, suspended and classified it): critical alarm.
    const hard = fakeSql({ classification: "hard_gate_regression" });
    const alerts: Alert[] = [];
    const logged: Record<string, unknown>[] = [];
    const outcome = await publishEvaluation(input(buildReport(), "baseline"), hard.sql, sinkOf(alerts), (event) => void logged.push(event));
    expect(hard.parameters[1]![1]).toBe("baseline");
    expect(outcome).toMatchObject({ status: "published", classification: "hard_gate_regression" });
    expect(codes(alerts)).toEqual([["hard_gate_regression", "critical"]]);
    expect(logged.find((event) => event.event === "eval_published")).toMatchObject({ classification: "hard_gate_regression", requested_mode: "baseline", requested_mode_matches: false, suspended: true });

    // CI says regression about a report with a hard breach — the database finds a baseline (a
    // candidate's failed run): no regression alarm, nothing suspended.
    const baseline = fakeSql({ classification: "baseline" });
    const none: Alert[] = [];
    expect(await publishEvaluation(input(hardBreach(), "regression"), baseline.sql, sinkOf(none), () => {})).toMatchObject({ classification: "baseline" });
    expect(none).toEqual([]);

    // A quality regression is a warning whatever was requested.
    for (const mode of ["baseline", "regression", null] as const) {
      const q = fakeSql({ classification: "quality_regression" });
      const warnings: Alert[] = [];
      await publishEvaluation(input(buildReport(), mode), q.sql, sinkOf(warnings), () => {});
      expect(codes(warnings)).toEqual([["quality_regression", "warning"]]);
    }
  });

  it("H6 in service (runtime ≠ declared) reaches the database, which suspends; its times are not recorded (8B-I8 C4)", async () => {
    const runtime = fixtureMaterial({ params: { ...fixtureMaterial().params, topK: 3 } });
    const { sql, calls } = fakeSql({ classification: "hard_gate_regression" });
    const alerts: Alert[] = [];
    const logged: Record<string, unknown>[] = [];
    const outcome = await publishEvaluation(input(buildReport({ runtime }), "regression"), sql, sinkOf(alerts), (event) => void logged.push(event));
    expect(outcome).toMatchObject({ status: "published", classification: "hard_gate_regression", performanceId: null });
    expect(calls).toEqual(["knowledge.register_evaluation_gate_set", "knowledge.publish_evaluation_run"]);
    expect(codes(alerts)).toEqual([["hard_gate_regression", "critical"]]);
    expect(logged.map((event) => event.event)).toContain("eval_performance_skipped");
  });

  it("a replay changes nothing in the database and is logged as one; the alarm is sent again, marked (8B-I8 C4)", async () => {
    const { sql } = fakeSql({ classification: "hard_gate_regression", replayed: true });
    const alerts: Alert[] = [];
    const logged: Record<string, unknown>[] = [];
    await publishEvaluation(input(buildReport(), "regression"), sql, sinkOf(alerts), (event) => void logged.push(event));
    expect(logged.map((event) => event.event)).toContain("eval_publication_replayed");
    expect(logged.map((event) => event.event)).not.toContain("eval_published");
    expect(codes(alerts)).toEqual([["hard_gate_regression", "critical"]]);
    expect(alerts[0]!.details).toMatchObject({ replayed: "true" });
  });

  it("an invalid run refused by the database is neither a baseline nor a pass — whatever was requested", async () => {
    for (const mode of ["baseline", "regression"] as const) {
      const { sql } = fakeSql({ failWith: { code: "23514", message: "Afvist (invalid_run): kørslen er ikke foretaget isoleret i evalueringsmiljøet (H7)" } });
      const alerts: Alert[] = [];
      const outcome = await publishEvaluation(input(buildReport(), mode), sql, sinkOf(alerts), () => {});
      expect(outcome).toEqual({ status: "refused", invalidRun: true, problems: ["Databasen afviste rapporten (23514)."] });
      expect(codes(alerts)).toEqual([["evaluation_invalid", "warning"]]);
      expect(alerts[0]!.details).toMatchObject({ requested_mode: mode, reason: "invalid_run" });
    }
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
    const { sql } = fakeSql({ failWith: { code: "23514" } });
    const alerts: Alert[] = [];
    const outcome = await publishEvaluation(input(), sql, sinkOf(alerts), () => {});
    expect(outcome).toMatchObject({ status: "refused", invalidRun: false, problems: ["Databasen afviste rapporten (23514)."] });
    expect(alerts.map((alert) => alert.code)).toEqual(["publication_refused"]);
  });

  it("a connection failure is not mistaken for a refusal", async () => {
    const { sql } = fakeSql({ failWith: { code: "ECONNREFUSED" } });
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

  it("the two credentials never meet in code: the evaluation reads only IPA_EVAL_*, the publication only IPA_PUBLISHER_DB_* (beta L2)", () => {
    // 8B-I7 kept them apart in two CI jobs, two environments and two AWS roles. L2 removed that
    // workflow and its IAM (docs/beta.md §14); the separation the code itself enforces stays.
    const engine = fs.readdirSync(path.join(root, "evals/engine")).filter((file) => file.endsWith(".ts")).map((file) => read(`evals/engine/${file}`)).join("\n");
    // publication.ts is the publisher's library: it takes a connection, never a credential.
    expect(engine).not.toMatch(/IPA_PUBLISHER_DB/);
    expect(engine).toMatch(/IPA_EVAL_SUPABASE_SERVICE_ROLE_KEY/);
    const publish = read("workers/evaluation/publish.ts").replace(/\/\*[\s\S]*?\*\//g, "");
    const readsEnv = [...publish.matchAll(/env\.([A-Z_]+)/g)].map((match) => match[1]!);
    expect(readsEnv.length).toBeGreaterThan(0);
    // Every credential or connection value it reads is the publisher's own (IPA_RUNTIME_ENV is not one).
    expect(readsEnv.filter((name) => /DB|KEY|SECRET|PASSWORD|TOKEN|URL|USER/.test(name) && !name.startsWith("IPA_PUBLISHER_DB_"))).toEqual([]);
    expect(readsEnv).toEqual(expect.arrayContaining(["IPA_PUBLISHER_DB_HOST", "IPA_PUBLISHER_DB_USER", "IPA_PUBLISHER_DB_PASSWORD"]));
    // The application's and the evaluation project's keys are refused outside local/test.
    expect(publish).toMatch(/const FORBIDDEN = \["SUPABASE_SERVICE_ROLE_KEY", "IPA_EVAL_SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"\];/);
    expect(publish).toMatch(/for \(const name of FORBIDDEN\) if \(process\.env\[name\] && !local\) fail\(/);
  });
});
