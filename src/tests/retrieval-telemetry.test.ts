import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_RETRIEVAL_CONFIG, runRetrieval, type RetrievalDeps, type RetrievalStep } from "@/lib/knowledge/retrieval-core";
import type { Alert } from "@/lib/observability/alerts";
import { ALERT_COOLDOWN_MS, createRetrievalTelemetry, resetTelemetryCooldowns } from "@/lib/observability/retrieval-telemetry";

import { FIXTURE_MODEL, fixtureContext, fixtureDb, fixtureQuery, fixtureRow, productionProviders } from "./fixtures/production-config";

/**
 * 8B-I7 — retrieval telemetry (docs/08b §12, §14): every step is timed through runRetrieval's
 * observe hook, the application logs one line per retrieval without any content, and raises the
 * alarms for unavailable retrieval and a configuration mismatch.
 */

const NOW = () => new Date("2026-10-05T10:00:00Z");

function deps(overrides: Partial<RetrievalDeps> = {}): RetrievalDeps {
  const providers = productionProviders();
  return {
    db: fixtureDb({ rows: [fixtureRow(1), fixtureRow(2)], context: fixtureContext() }),
    embedding: { embedder: providers.embedder, modelId: FIXTURE_MODEL.id },
    reranker: providers.reranker,
    config: DEFAULT_RETRIEVAL_CONFIG,
    now: NOW,
    ...overrides,
  };
}

beforeEach(() => resetTelemetryCooldowns());

describe("the observe hook of runRetrieval (§12 steps)", () => {
  it("times the whole chain, the query embedding, the database search and reranking", async () => {
    const seen: [RetrievalStep, boolean][] = [];
    await runRetrieval({ query: fixtureQuery() }, deps({ observe: (step, ms, ok) => { expect(ms).toBeGreaterThanOrEqual(0); seen.push([step, ok]); } }));
    expect(seen.map(([step]) => step).sort()).toEqual(["query_embedding", "rerank", "search", "total"]);
    expect(seen.every(([, ok]) => ok)).toBe(true);
  });

  it("reports a failing step as failed, and the failure still reaches the caller", async () => {
    const seen: [RetrievalStep, boolean][] = [];
    const failingDb = { rpc: async () => ({ data: null, error: { message: "nede" } }) };
    await expect(runRetrieval({ query: fixtureQuery() }, deps({ db: failingDb, observe: (step, _ms, ok) => seen.push([step, ok]) }))).rejects.toThrow();
    expect(seen).toContainEqual(["search", false]);
    expect(seen).toContainEqual(["total", false]);
  });

  it("an observer that throws can never change the result", async () => {
    const quiet = await runRetrieval({ query: fixtureQuery() }, deps());
    const loud = await runRetrieval({ query: fixtureQuery() }, deps({ observe: () => { throw new Error("måling fejlede"); } }));
    expect(loud.items.map((item) => item.chunkId)).toEqual(quiet.items.map((item) => item.chunkId));
    expect(loud.retrieval.grade).toBe(quiet.retrieval.grade);
  });
});

describe("the application's retrieval telemetry", () => {
  function harness(start = 0) {
    const lines: Record<string, unknown>[] = [];
    const alerts: Alert[] = [];
    let clock = start;
    const telemetry = () =>
      createRetrievalTelemetry({ sink: { send: async (alert) => void alerts.push(alert) }, write: (line) => lines.push(JSON.parse(line)), now: () => clock });
    return { lines, alerts, telemetry, advance: (ms: number) => (clock += ms) };
  }

  it("logs outcome, grade, unmet conditions and step durations — never the query or content", async () => {
    const h = harness();
    const t = h.telemetry();
    const set = await runRetrieval({ query: fixtureQuery() }, deps({ observe: t.observe }));
    await t.succeeded(set);
    expect(h.lines).toHaveLength(1);
    expect(h.lines[0]).toMatchObject({ event: "retrieval", outcome: "evidence", grade: set.retrieval.grade, items: set.items.length });
    expect(Object.keys(h.lines[0]!.steps_ms as object).sort()).toEqual(["query_embedding", "rerank", "search", "total"]);
    const text = JSON.stringify(h.lines);
    expect(text).not.toContain(fixtureQuery().text);
    for (const item of set.items) expect(text).not.toContain(item.excerpt.text);
    expect(h.alerts).toEqual([]);
  });

  it("raises the alarm for a configuration mismatch (P4 unmet while a configuration is in service)", async () => {
    const h = harness();
    const t = h.telemetry();
    // Another topK than the configuration's: the runtime fingerprint differs (P4).
    const set = await runRetrieval({ query: fixtureQuery(), topK: 3 }, deps());
    expect(set.retrieval.unmet).toContain("P4");
    await t.succeeded(set);
    expect(h.alerts.map((alert) => alert.code)).toEqual(["configuration_mismatch"]);
    expect(h.alerts[0]!.details).toMatchObject({ configuration_id: set.retrieval.configuration!.id });
  });

  it("an access or request error is logged, never an alarm", async () => {
    const h = harness();
    await h.telemetry().failed("denied");
    await h.telemetry().failed("invalid_request");
    expect(h.alerts).toEqual([]);
    expect(h.lines.map((line) => line.error_code)).toEqual(["denied", "invalid_request"]);
  });

  it("unavailable retrieval is an alarm — at most once per 10 minutes per process; access errors are not", async () => {
    const h = harness();
    await h.telemetry().failed("unavailable");
    await h.telemetry().failed("unavailable");
    expect(h.alerts.map((alert) => alert.code)).toEqual(["retrieval_unavailable"]);
    h.advance(ALERT_COOLDOWN_MS);
    await h.telemetry().failed("error");
    expect(h.alerts).toHaveLength(2);
    await h.telemetry().failed("denied");
    await h.telemetry().failed("invalid_request");
    expect(h.alerts).toHaveLength(2);
    expect(h.lines.map((line) => line.outcome)).toEqual(["error", "error", "error", "error", "error"]);
  });
});
