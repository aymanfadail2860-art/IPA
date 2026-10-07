import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  createEvaluationPublisher,
  isDevelopmentConfiguration,
  PublicationRefusedError,
  PublisherUnavailableError,
  sqlPublisherConnection,
  unavailablePublisher,
  verifyForPublication,
  type PublisherConnection,
} from "../../evals/engine/publication.ts";
import { REPORT_SCHEMA_VERSION, type EvaluationReport } from "../../evals/engine/runner.ts";

import { buildReport, GATES_V1, reseal } from "./fixtures/evaluation-report";
import { fixtureMaterial } from "./fixtures/production-config";

/**
 * 8B-I6 — the evaluation publisher (docs/08b §4.5, D-18). A local report is not a registered
 * run: the publisher re-verifies the REAL I1 report (checksums, fingerprint, metrics, gates,
 * environment, development implementations) before it sends anything, and the database verifies
 * it again (pgTAP, integration). Nothing here approves or activates.
 */

function recordingConnection() {
  const calls: string[] = [];
  const connection: PublisherConnection = {
    async registerGateSet() {
      calls.push("registerGateSet");
      return "gate";
    },
    async recordRun() {
      calls.push("recordRun");
      return { id: "f6000000-0000-4000-8000-0000000000b1", registeredAt: "2026-10-05T09:00:00.000Z" };
    },
  };
  return { connection, calls };
}

const refusal = async (report: EvaluationReport) => {
  const { connection, calls } = recordingConnection();
  const error = await createEvaluationPublisher(connection).publish(report, GATES_V1).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(PublicationRefusedError);
  // Nothing reaches the database when the report does not verify.
  expect(calls).toEqual([]);
  return (error as PublicationRefusedError).problems.join("\n");
};

describe("a passing report for a production-grade configuration", () => {
  it("is the real I1 format and verifies", () => {
    const report = buildReport();
    expect(report.reportSchema).toBe(REPORT_SCHEMA_VERSION);
    expect(report.verdict).toBe("pass");
    expect(report.tier).toBe("pilot");
    expect(report.production.eligible).toBe(false);
    expect(verifyForPublication(report, GATES_V1)).toEqual({ ok: true });
  });

  it("is published through exactly the two publisher functions and yields a PublishedEvaluationRun", async () => {
    const { connection, calls } = recordingConnection();
    const published = await createEvaluationPublisher(connection).publish(buildReport(), GATES_V1);
    expect(calls).toEqual(["registerGateSet", "recordRun"]);
    expect(published.reportChecksum).toBe(buildReport().checksums.report);
    expect(Object.isFrozen(published)).toBe(true);
  });

  it("without a publisher connection nothing can be published", async () => {
    await expect(unavailablePublisher.publish(buildReport(), GATES_V1)).rejects.toBeInstanceOf(PublisherUnavailableError);
  });
});

describe("the publisher refuses before anything is sent", () => {
  it("a report changed after the run (checksum)", async () => {
    const report = buildReport();
    report.metrics.mrr_at_k.value = 0.5;
    expect(await refusal(report)).toMatch(/checksum stemmer ikke/);
  });

  it("a forged report with recomputed checksums (metrics, verdict)", async () => {
    const forgedMetric = buildReport();
    forgedMetric.metrics.source_recall_at_k.value = 0.99;
    expect(await refusal(reseal(forgedMetric))).toMatch(/Metrikkerne kan ikke genberegnes/);
    const forgedVerdict = buildReport({ counts: { direct: 20, historical: 3, conflict: 2, distractor: 3, unanswerable: 5, permission: 3 } });
    expect(forgedVerdict.verdict).toBe("uncertain");
    forgedVerdict.verdict = "pass";
    expect(await refusal(reseal(forgedVerdict))).toMatch(/Afgørelsen stemmer ikke/);
  });

  it("a report that claims to be production eligible", async () => {
    const report = buildReport();
    (report.production as { eligible: boolean }).eligible = true;
    expect(await refusal(reseal(report))).toMatch(/aldrig selv erklære sig production-egnet/);
  });

  it("development or fixture evidence: never a production approval", async () => {
    expect(await refusal(buildReport({ environment: "fixture" }))).toMatch(/evalueringsmiljøet/);
    const none = fixtureMaterial();
    none.reranker = { ...none.reranker, id: "none", model: "none" };
    expect(isDevelopmentConfiguration(none)).toBe(true);
    expect(await refusal(buildReport({ configuration: none }))).toMatch(/udviklingsimplementering/);
    expect(await refusal(buildReport({ configuration: { ...fixtureMaterial(), embedding: null } }))).toMatch(/udviklingsimplementering/);
  });

  it("evaluated as A, runtime B: the runtime is not the declared configuration", async () => {
    const runtime = fixtureMaterial({ params: { ...fixtureMaterial().params, topK: 3 } });
    expect(await refusal(buildReport({ runtime }))).toMatch(/Runtime er ikke den erklærede konfiguration/);
  });

  it("a fingerprint claim that is not the material's", async () => {
    const report = buildReport();
    report.configuration.declaredFingerprint = "0".repeat(64);
    report.configuration.runtimeFingerprint = "0".repeat(64);
    expect(await refusal(reseal(report))).toMatch(/fingeraftryk stemmer ikke/);
  });

  it("another gate set than the one the report was made with", async () => {
    const other = { ...GATES_V1, quality: { ...GATES_V1.quality, Q1: { ...GATES_V1.quality.Q1, threshold: 0.5 } } };
    const { connection, calls } = recordingConnection();
    await expect(createEvaluationPublisher(connection).publish(buildReport(), other)).rejects.toBeInstanceOf(PublicationRefusedError);
    expect(calls).toEqual([]);
  });

  it("a report without the evaluated corpus's document types (pilot scope)", async () => {
    const report = buildReport();
    report.corpus.documentTypes = [];
    expect(await refusal(reseal(report))).toMatch(/dokumenttyper mangler/);
  });
});

describe("uncertain is not pass, and small sets are uncertain", () => {
  it("a 36-question pilot set at 100 % is 'uncertain' under the locked thresholds (Wilson 95 %)", () => {
    const report = buildReport({ counts: { direct: 20, historical: 3, conflict: 2, distractor: 3, unanswerable: 5, permission: 3 } });
    expect(report.valid).toBe(true);
    expect(report.verdict).toBe("uncertain");
    expect(report.qualityGates.find((gate) => gate.id === "Q1")).toMatchObject({ status: "pass", uncertain: true });
    // It can be published (a registered result), but the database will not approve it (pgTAP/integration).
    expect(verifyForPublication(report, GATES_V1)).toEqual({ ok: true });
  });
});

describe("the SQL transport", () => {
  it("calls only knowledge.register_evaluation_gate_set and knowledge.record_evaluation_run, with JSON parameters", async () => {
    const queries: { query: string; parameters: unknown[] }[] = [];
    const connection = sqlPublisherConnection({
      unsafe(query, parameters = []) {
        queries.push({ query, parameters });
        return Promise.resolve([{ id: "x", registered_at: new Date("2026-10-05T09:00:00Z") }]);
      },
    });
    await connection.registerGateSet(GATES_V1);
    const row = await connection.recordRun(buildReport());
    expect(queries.map((entry) => entry.query)).toEqual([
      "select knowledge.register_evaluation_gate_set($1::text::jsonb) as id",
      "select knowledge.record_evaluation_run($1::text::jsonb) as id, now() as registered_at",
    ]);
    expect(JSON.parse(queries[1]!.parameters[0] as string)).toEqual(buildReport());
    expect(row).toEqual({ id: "x", registeredAt: "2026-10-05T09:00:00.000Z" });
  });
});

describe("the pgTAP fixture is the generated report (no drift between TypeScript and SQL tests)", () => {
  const sql = fs.readFileSync(path.resolve(__dirname, "../../supabase/tests/database/retrieval_configuration_registry.test.sql"), "utf8");
  const literal = (tag: string) => JSON.parse(sql.slice(sql.indexOf(`$${tag}$`) + tag.length + 2, sql.lastIndexOf(`$${tag}$`))) as unknown;

  it("the report and the gate set in the pgTAP file equal buildReport() and gates-v1", () => {
    expect(literal("report")).toEqual(JSON.parse(JSON.stringify(buildReport())));
    expect(literal("gates")).toEqual(JSON.parse(JSON.stringify(GATES_V1)));
  });
});
